#include "ffmpeg_worker.h"
#include "log_buffer.h"
#include "temp_output.h"
#include <chrono>
#include <filesystem>
#include <cstdlib>
#include <cerrno>
#include <algorithm>
#include <cmath>
#include <string_view>

#ifdef _WIN32
#include <windows.h>
#else
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#endif

namespace engine {

// Parse FFmpeg's ASCII HH:MM:SS[.fraction] without regex or substrings.
static bool parse_timestamp(std::string_view text, double& seconds) {
    while (!text.empty() && (text.front() == ' ' || text.front() == '\t' ||
           text.front() == '\r' || text.front() == '\n' ||
           text.front() == '\f' || text.front() == '\v')) text.remove_prefix(1);
    double parts[3] = {};
    for (int part = 0; part < 3; ++part) {
        if (text.empty() || text.front() < '0' || text.front() > '9') return false;
        while (!text.empty() && text.front() >= '0' && text.front() <= '9') {
            parts[part] = parts[part] * 10 + (text.front() - '0');
            text.remove_prefix(1);
        }
        if (part < 2) {
            if (text.empty() || text.front() != ':') return false;
            text.remove_prefix(1);
        }
    }
    if (!text.empty() && text.front() == '.') {
        text.remove_prefix(1);
        double place = 0.1;
        while (!text.empty() && text.front() >= '0' && text.front() <= '9') {
            parts[2] += (text.front() - '0') * place;
            place *= 0.1;
            text.remove_prefix(1);
        }
    }
    const double parsed = parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (!std::isfinite(parsed)) return false;
    seconds = parsed;
    return true;
}

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

void FfmpegWorker::parse_progress(const std::string& line, double& duration) {
    const std::string_view record(line);
    if (duration == 0.0) {
        const auto marker = record.find("Duration:");
        if (marker != std::string_view::npos)
            parse_timestamp(record.substr(marker + 9), duration);
    }
    if (duration <= 0) return;
    const auto marker = record.find("time=");
    double elapsed = 0.0;
    if (marker == std::string_view::npos ||
        !parse_timestamp(record.substr(marker + 5), elapsed)) return;
    const double fraction = elapsed / duration;
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
    if (!SetHandleInformation(hReadPipe, HANDLE_FLAG_INHERIT, 0)) {
        CloseHandle(hReadPipe);
        CloseHandle(hWritePipe);
        throw FfmpegError("Failed to configure ffmpeg output pipe");
    }

    // The child must not inherit stdout: that handle carries the JSON-lines
    // IPC protocol back to Rust, and stray bytes desynchronise it.
    HANDLE hNull = CreateFileA("NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                               &sa, OPEN_EXISTING, 0, nullptr);
    if (hNull == INVALID_HANDLE_VALUE) {
        CloseHandle(hReadPipe);
        CloseHandle(hWritePipe);
        throw FfmpegError("Failed to open NUL device for ffmpeg output");
    }

    STARTUPINFOA si = { sizeof(STARTUPINFOA) };
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = hNull;
    si.hStdError = hWritePipe;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);

    PROCESS_INFORMATION pi = {};
    BOOL created = CreateProcessA(
        nullptr, cmd_str.data(), nullptr, nullptr, TRUE,
        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi
    );

    CloseHandle(hNull);
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
            if (report_progress) lines.feed(std::string_view(read_buf, bytes_read), consume);
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
    const BOOL exit_known = GetExitCodeProcess(pi.hProcess, &exit_code);
    {
        std::lock_guard<std::mutex> lock(process_mutex_);
        process_handle_ = nullptr;
        CloseHandle(pi.hProcess);
    }

    check_cancelled();
    if (!exit_known) {
        throw FfmpegError("Failed to read ffmpeg exit code");
    }
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
        // Child stdout is the JSON-lines IPC channel: send it to /dev/null and
        // keep only stderr, which carries ffmpeg's progress and diagnostics.
        const int null_fd = open("/dev/null", O_WRONLY);
        if (null_fd < 0) _exit(126);
        if (dup2(null_fd, STDOUT_FILENO) < 0) _exit(126);
        if (null_fd != STDOUT_FILENO && null_fd != STDERR_FILENO) close(null_fd);
        if (dup2(pipefd[1], STDERR_FILENO) < 0) _exit(126);
        if (pipefd[1] != STDOUT_FILENO && pipefd[1] != STDERR_FILENO) close(pipefd[1]);
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
            if (report_progress) lines.feed(std::string_view(buf, n), consume);
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
    if (WIFEXITED(status)) {
        const int code = WEXITSTATUS(status);
        if (code != 0) {
            throw FfmpegError("ffmpeg failed with exit code " + std::to_string(code));
        }
    } else if (WIFSIGNALED(status)) {
        throw FfmpegError("ffmpeg terminated by signal " + std::to_string(WTERMSIG(status)));
    } else {
        throw FfmpegError("ffmpeg exited abnormally");
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
    } catch (...) {
        // An exception escaping here would reach std::terminate() on this thread.
        msg = is_running_.load() ? (operation + " failed with an unexpected error")
                                 : (operation + " was cancelled");
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
