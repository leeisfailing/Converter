#include "ffmpeg_worker.h"
#include "log_buffer.h"
#include "temp_output.h"
#include <chrono>
#include <filesystem>
#include <cstdlib>
#include <cerrno>

#ifdef _WIN32
#include <windows.h>
#else
#include <sys/wait.h>
#include <unistd.h>
#include <signal.h>
#endif

namespace engine {

static const std::regex DURATION_RE(R"(Duration:\s*(\d+):(\d+):(\d+\.?\d*))");
static const std::regex TIME_RE(R"(time=\s*(\d+):(\d+):(\d+\.?\d*))");

FfmpegWorker::FfmpegWorker() = default;
FfmpegWorker::~FfmpegWorker() { stop(); }

void FfmpegWorker::init_process() {
    is_running_ = true;
    last_pct_ = 0;
    last_progress_time_ = 0.0;
}

void FfmpegWorker::check_cancelled() {
    if (!is_running_.load()) {
        throw std::runtime_error(operation + " was cancelled");
    }
}

double FfmpegWorker::seconds_from_match(const std::smatch& m) {
    double h = std::stod(m[1].str());
    double mi = std::stod(m[2].str());
    double s = std::stod(m[3].str());
    return h * 3600.0 + mi * 60.0 + s;
}

void FfmpegWorker::parse_progress(const std::string& line, double& duration) {
    std::smatch match;
    if (duration == 0.0 && line.find("Duration:") != std::string::npos &&
        std::regex_search(line, match, DURATION_RE)) {
        duration = seconds_from_match(match);
    }
    if (duration <= 0 || line.find("time=") == std::string::npos ||
        !std::regex_search(line, match, TIME_RE)) return;
    const double fraction = seconds_from_match(match) / duration;
    const int pct = 10 + static_cast<int>(std::clamp(fraction, 0.0, 1.0) * 89);
    if (pct <= last_pct_) return;
    const double now = std::chrono::duration<double>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    if (now - last_progress_time_ >= 0.1) {
        last_pct_ = pct;
        last_progress_time_ = now;
        if (on_progress) on_progress(pct);
    }
}

#ifdef _WIN32
void FfmpegWorker::execute(const std::vector<std::string>& cmd, bool report_progress) {
    check_cancelled();
    last_pct_ = 0;
    last_progress_time_ = 0.0;
    double duration = 0.0;
    if (report_progress && on_progress) on_progress(10);
    check_cancelled();

    LogBuffer lines;
    auto consume = [&](const std::string& line) {
        if (report_progress) parse_progress(line, duration);
    };
    std::string cmd_str;
    size_t capacity = 0;
    for (const auto& arg : cmd) capacity += arg.size() + 3;
    cmd_str.reserve(capacity);
    for (size_t i = 0; i < cmd.size(); ++i) {
        if (i > 0) cmd_str += " ";
        if (cmd[i].find(' ') != std::string::npos) {
            cmd_str += "\"" + cmd[i] + "\"";
        } else {
            cmd_str += cmd[i];
        }
    }

    HANDLE hReadPipe, hWritePipe;
    SECURITY_ATTRIBUTES sa = { sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE };
    if (!CreatePipe(&hReadPipe, &hWritePipe, &sa, 0)) {
        throw FfmpegError("Failed to create pipe");
    }
    SetHandleInformation(hReadPipe, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOA si = { sizeof(STARTUPINFOA) };
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    si.hStdError = hWritePipe;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);

    PROCESS_INFORMATION pi = {};
    BOOL created = CreateProcessA(
        nullptr, cmd_str.data(), nullptr, nullptr, TRUE,
        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi
    );

    CloseHandle(hWritePipe);

    if (!created) {
        CloseHandle(hReadPipe);
        throw FfmpegError("Failed to start ffmpeg");
    }

    CloseHandle(pi.hThread);
    {
        std::lock_guard<std::mutex> lock(process_mutex_);
        process_handle_ = pi.hProcess;
        // stop() may have run between the pre-launch check and publication.
        if (!is_running_.load()) TerminateProcess(pi.hProcess, 1);
    }

    char read_buf[4096];
    DWORD bytes_read;

    try {
        while (ReadFile(hReadPipe, read_buf, sizeof(read_buf) - 1, &bytes_read, nullptr) && bytes_read > 0) {
            check_cancelled();
            lines.feed(std::string_view(read_buf, bytes_read), consume);
        }
        lines.flush(consume);
    } catch (...) {
        CloseHandle(hReadPipe);
        TerminateProcess(pi.hProcess, 1);
        WaitForSingleObject(pi.hProcess, 5000);
        {
            std::lock_guard<std::mutex> lock(process_mutex_);
            process_handle_ = nullptr;
            CloseHandle(pi.hProcess);
        }
        throw;
    }

    CloseHandle(hReadPipe);
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &exit_code);
    {
        std::lock_guard<std::mutex> lock(process_mutex_);
        process_handle_ = nullptr;
        CloseHandle(pi.hProcess);
    }

    check_cancelled();
    if (exit_code != 0) {
        throw FfmpegError("ffmpeg failed with exit code " + std::to_string(exit_code));
    }
}
#else
void FfmpegWorker::execute(const std::vector<std::string>& cmd, bool report_progress) {
    check_cancelled();
    last_pct_ = 0;
    last_progress_time_ = 0.0;
    double duration = 0.0;
    if (report_progress && on_progress) on_progress(10);
    check_cancelled();

    LogBuffer lines;
    auto consume = [&](const std::string& line) {
        if (report_progress) parse_progress(line, duration);
    };
    std::vector<char*> argv;
    argv.reserve(cmd.size() + 1);
    for (const auto& arg : cmd) argv.push_back(const_cast<char*>(arg.c_str()));
    argv.push_back(nullptr);
    int pipefd[2];
    if (pipe(pipefd) != 0) throw FfmpegError("Failed to create pipe");

    pid_t pid = fork();
    if (pid == 0) {
        close(pipefd[0]);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[1]);
        execvp(argv[0], argv.data());
        _exit(127);
    }
    close(pipefd[1]);
    if (pid < 0) {
        close(pipefd[0]);
        throw FfmpegError("Failed to start ffmpeg");
    }
    {
        std::lock_guard<std::mutex> lock(process_mutex_);
        process_handle_ = (void*)(intptr_t)pid;
        if (!is_running_.load()) kill(pid, SIGKILL);
    }

    char buf[4096];
    int status = 0;
    try {
        ssize_t n;
        while ((n = read(pipefd[0], buf, sizeof(buf))) != 0) {
            if (n < 0) {
                if (errno == EINTR) continue;
                throw FfmpegError("Failed to read ffmpeg output");
            }
            check_cancelled();
            lines.feed(std::string_view(buf, n), consume);
        }
        lines.flush(consume);
    } catch (...) {
        close(pipefd[0]);
        std::lock_guard<std::mutex> lock(process_mutex_);
        kill(pid, SIGKILL);
        while (waitpid(pid, nullptr, 0) < 0 && errno == EINTR) {}
        process_handle_ = nullptr;
        throw;
    }
    close(pipefd[0]);
    // Only the execution thread reaps the child; stop() merely signals it.
    for (;;) {
        std::unique_lock<std::mutex> lock(process_mutex_);
        const auto result = waitpid(pid, &status, WNOHANG);
        if (result != 0) {
            if (result < 0 && errno == EINTR) continue;
            process_handle_ = nullptr;
            if (result < 0) throw FfmpegError("Failed to wait for ffmpeg");
            break;
        }
        lock.unlock();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    check_cancelled();
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        throw FfmpegError("ffmpeg failed with exit code " + std::to_string(WEXITSTATUS(status)));
    }
}
#endif

void FfmpegWorker::perform() {
    auto cmd = build_command();
    auto destination = std::filesystem::path(output_path);
    TempOutputDirectory temporary(destination);
    auto candidate = temporary.path() / destination.filename();
    cmd.back() = candidate.string();
    execute(cmd);
    check_cancelled();
    if (!std::filesystem::is_regular_file(candidate) || std::filesystem::file_size(candidate) == 0) {
        throw std::runtime_error("ffmpeg produced no output");
    }
    replace_output(candidate, destination);
}

void FfmpegWorker::run() {
    bool success = false;
    std::string msg;
    std::string fp;
    try {
        check_cancelled();
        std::error_code ec;
        auto in = std::filesystem::weakly_canonical(std::filesystem::path(input_path), ec);
        auto out = std::filesystem::weakly_canonical(std::filesystem::path(output_path), ec);
        if (in == out) {
            throw std::runtime_error("Output must be different from the original file");
        }
        perform();
        if (on_progress) on_progress(100);
        success = true;
        fp = output_path;
    } catch (std::exception& exc) {
        msg = is_running_.load() ? exc.what() : (operation + " was cancelled");
    }
    if (on_finished) {
        on_finished(success, msg, fp);
    }
    is_running_ = false;
}

void FfmpegWorker::start() {
    worker_thread_ = std::thread(&FfmpegWorker::run, this);
}

void FfmpegWorker::stop() {
    is_running_ = false;
#ifdef _WIN32
    {
        std::lock_guard<std::mutex> lock(process_mutex_);
        if (process_handle_) {
            HANDLE h = static_cast<HANDLE>(process_handle_);
            TerminateProcess(h, 1);
            // execute() owns and closes the handle after observing exit.
        }
    }
#else
    {
        std::lock_guard<std::mutex> lock(process_mutex_);
        if (process_handle_) {
            pid_t pid = (pid_t)(intptr_t)process_handle_;
            kill(pid, SIGKILL);
        }
    }
#endif
    if (worker_thread_.joinable() && worker_thread_.get_id() != std::this_thread::get_id()) {
        worker_thread_.join();
    }
}

}
