#include "ffmpeg_worker.h"
#include "log_buffer.h"
#include "media.h"
#include "process_pipe.h"
#include "security.h"
#include "target_size.h"
#include "temp_output.h"
#include "native_paths.h"
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>

using namespace engine;
static void require(bool ok, const char* message) {
    if (!ok) throw std::runtime_error(message);
}

class Worker : public FfmpegWorker {
public:
    std::vector<std::string> command;
    Worker() { init_process(); }
    ~Worker() override { stop(); }
    using FfmpegWorker::execute;
    using FfmpegWorker::perform;
    std::vector<std::string> build_command() override { return command; }
};

#ifdef _WIN32
int wmain(int argc, wchar_t** wide_argv) {
    std::vector<std::string> arguments;
    for (int i = 0; i < argc; ++i) arguments.push_back(ipc_path(std::filesystem::path(wide_argv[i])));
    std::vector<char*> narrow_argv;
    for (auto& argument : arguments) narrow_argv.push_back(argument.data());
    char** argv = narrow_argv.data();
#else
int main(int argc, char** argv) {
#endif
    if (argc > 1) {
        const std::string mode = argv[1];
        if (mode == "quiet") {
            std::this_thread::sleep_for(std::chrono::seconds(10));
        } else if (mode == "progress") {
            std::cerr << "Duration: 00:00:10.00\rtime=00:00:05.00\r" << std::flush;
        } else if (mode == "write" || mode == "fail") {
            std::ofstream(native_path(argv[2])) << "new output";
            if (mode == "fail") return 3;
#ifdef _WIN32
        } else if (mode == "arguments") {
            // Check actual CRT argv after the parent quotes its UTF-16 launch.
            if (argc != 7 || std::string(argv[2]) != "" ||
                std::string(argv[3]) != "tab\tvalue" ||
                std::string(argv[4]) != "quoted\"value" ||
                std::string(argv[5]) != "space at end\\") return 4;
            if (std::string(argv[6]) != u8"\u65e5\u672c\u8a9e") return 5;
#endif
        }
        return 0;
    }
    try {
        LogBuffer buffer;
        std::vector<std::string> records;
        auto consume = [&](const std::string& line) { records.push_back(line); };
        buffer.feed("first\r\nsec", consume);
        buffer.feed("ond\rthird", consume);
        buffer.flush(consume);
        require(records == std::vector<std::string>{"first", "second", "third"}, "split records");
        size_t total = 0;
        auto bounded = [&](const std::string& line) {
            require(line.size() <= LogBuffer::max_record, "unbounded record");
            total += line.size();
        };
        buffer.feed(std::string(2000000, 'x'), bounded);
        buffer.flush(bounded);
        require(total == 2000000, "lost log bytes");

        // Bitrates derived from an IPC target over a short duration can far
        // exceed INT_MAX, and an out-of-range float->int conversion is UB.
        require(bitrate_to_int(4000.9) == 4000, "bitrate not truncated");
        require(bitrate_to_int(2000.0) == 2000, "low bitrate masked by clamp");
        require(bitrate_to_int(0.0) == 0 && bitrate_to_int(-1.0) == 0, "negative bitrate not floored");
        require(bitrate_to_int(std::numeric_limits<double>::quiet_NaN()) == 0, "NaN bitrate not floored");
        const int clamped = bitrate_to_int(3.5e10);
        require(clamped == 1000000000, "oversized bitrate not clamped");
        require(clamped <= (std::numeric_limits<int>::max)() / 2,
                "clamped bitrate overflows bufsize arithmetic");

        // On Windows, cmd.exe expands %VAR% inside quotes and ^ escapes the next
        // byte, so both are rejected there. On POSIX they are ordinary, legal
        // filename characters (100%_final.mp4) and must keep working.
        bool rejected = false;
#ifdef _WIN32
        try { validate_path("clip%TEMP%.mp4", "input"); } catch (const ValidationError&) { rejected = true; }
        require(rejected, "percent expansion allowed in path");
        rejected = false;
        try { validate_path("clip^.mp4", "input"); } catch (const ValidationError&) { rejected = true; }
        require(rejected, "caret escape allowed in path");
#else
        try { validate_path("clip%TEMP%.mp4", "input"); } catch (const ValidationError&) { rejected = true; }
        require(!rejected, "percent rejected in a legal POSIX filename");
        rejected = false;
        try { validate_path("clip^.mp4", "input"); } catch (const ValidationError&) { rejected = true; }
        require(!rejected, "caret rejected in a legal POSIX filename");
#endif
        const std::string accepted = validate_path("clip (1) final.mp4", "input");
        require(accepted.find("clip (1) final.mp4") != std::string::npos, "safe path rejected");

        // Probe output must be captured, and a failed probe must surface a
        // message instead of silently-defaulted metadata.
        require(run_probe_command("echo probe-ok").find("probe-ok") != std::string::npos,
                "probe output not captured");
#ifdef _WIN32
        const std::string probe_fail = "echo bad-input & exit 7";
        require(describe_process_status(7) == "exit code 7", "exit status not described");
#else
        const std::string probe_fail = "echo bad-input; exit 7";
        // pclose() yields the raw wait status (exit 7 -> 7*256), not the code.
        require(describe_process_status(7 << 8) == "exit code 7", "wait status not decoded");
        require(describe_process_status(9) == "signal 9", "signal status not decoded");
#endif
        bool reported = false;
        try {
            run_probe_command(probe_fail);
        } catch (const std::exception& e) {
            const std::string message = e.what();
            reported = message.find("exit code") != std::string::npos &&
                       message.find("bad-input") != std::string::npos;
        }
        require(reported, "probe exit status not reported");
        require(summarize_output(std::string(500, 'x')).size() <= 200, "probe detail not truncated");

#ifndef _WIN32
        // pclose() yields a raw wait status: a signal must not read as an exit code.
        bool signalled = false;
        try {
            run_probe_command("kill -9 $$");
        } catch (const std::exception& e) {
            signalled = std::string(e.what()).find("signal 9") != std::string::npos;
        }
        require(signalled, "probe signal status not reported");

        // fread() errors are not EOF: truncated output must be discarded.
        FILE* dir = std::fopen("/", "r");
        if (dir) {
            std::string partial = "stale";
            require(!read_process_output(dir, partial), "stream error not detected");
            require(partial.empty(), "truncated probe output kept");
            std::fclose(dir);
        }
#endif

        bool probe_failed = false;
        try {
            probe_media("converter-probe-missing-input.mp4");
        } catch (const std::exception& e) {
            probe_failed = std::string(e.what()).find("Probe command") != std::string::npos;
        }
        require(probe_failed, "probe_media swallowed a failed probe");

#ifdef _WIN32
        DWORD before = 0, after = 0;
        { Worker warmup; warmup.execute({argv[0], "progress"}); }
        GetProcessHandleCount(GetCurrentProcess(), &before);
#endif
        for (int i = 0; i < 20; ++i) {
            Worker worker;
            int progress = 0;
            worker.on_progress = [&](int value) { progress = value; };
            worker.execute({argv[0], "progress"});
            require(progress == 54, "CR progress not emitted");
        }
#ifdef _WIN32
        GetProcessHandleCount(GetCurrentProcess(), &after);
        std::cout << "Handles before=" << before << " after=" << after << "\n";
        require(after <= before, "process or thread handle leak");
#endif
        TempOutputDirectory root(std::filesystem::temp_directory_path() / "worker-tests");
#ifdef _WIN32
        {
            const auto unicode_directory = root.path() / L"\u65e5\u672c\u8a9e space";
            std::filesystem::create_directory(unicode_directory);
            const auto unicode_output = unicode_directory / L"\u5f71\u7247.txt";
            std::ofstream(unicode_output) << "original";
            require(native_path(validate_file_exists(ipc_path(unicode_output), "input")) == unicode_output,
                    "UTF-8 validation corrupted a Windows filename");
            require(native_path(validate_output_path(ipc_path(unicode_output), "output")) == unicode_output,
                    "UTF-8 output validation corrupted a Windows filename");

            // Actually start an executable from a Unicode directory rather
            // than only asserting the converter's intermediate strings.
            wchar_t executable_buffer[32768] = {};
            require(GetModuleFileNameW(nullptr, executable_buffer, 32768) != 0, "cannot locate test executable");
            const auto unicode_executable = unicode_directory / "worker_tests.exe";
            std::filesystem::copy_file(std::filesystem::path(executable_buffer), unicode_executable);
            Worker unicode_worker;
            unicode_worker.execute({ipc_path(unicode_executable), "arguments", "", "tab\tvalue",
                                    "quoted\"value", "space at end\\", u8"\u65e5\u672c\u8a9e"});
            unicode_worker.output_path = ipc_path(unicode_output);
            unicode_worker.command = {ipc_path(unicode_executable), "write", ipc_path(unicode_output)};
            unicode_worker.perform();

            // A probe must preserve Unicode through cmd.exe and UTF-16 file
            // lookup. Contents are ASCII so the output code page is irrelevant.
            require(run_probe_command("type " + quote_process_arg(ipc_path(unicode_output))).find("new output") != std::string::npos,
                    "Unicode probe path corrupted");
            require(run_probe_command(quote_process_arg(ipc_path(unicode_executable)) + " progress 2>&1").find("Duration:") != std::string::npos,
                    "quoted Unicode probe executable path corrupted");
            TempOutputDirectory trial(unicode_output);
            const auto candidate = trial.path() / unicode_output.filename();
            std::ofstream(candidate) << "replacement";
            replace_output(candidate, unicode_output);
            std::ifstream input(unicode_output);
            std::string content((std::istreambuf_iterator<char>(input)), {});
            require(content == "replacement", "Unicode atomic publication failed");
            input.close();
            bool invalid_utf8_rejected = false;
            try { native_path(std::string(1, '\xff')); } catch (const std::runtime_error&) { invalid_utf8_rejected = true; }
            require(invalid_utf8_rejected, "invalid UTF-8 Windows path accepted");
            std::filesystem::remove_all(unicode_directory);
        }
#else
        require(ipc_path(native_path(std::string("clip-") + '\xff')) == std::string("clip-") + '\xff',
                "POSIX filename bytes changed");
#endif
        auto output = root.path() / "out.txt";
        std::ofstream(output) << "original";
        for (const auto mode : {"fail", "write"}) {
            Worker worker;
            worker.output_path = output.string();
            worker.command = {argv[0], mode, output.string()};
            bool failed = false;
            try { worker.perform(); } catch (const FfmpegError&) { failed = true; }
            require(failed == (std::string(mode) == "fail"), "wrong process result");
            std::ifstream input(output);
            std::string content((std::istreambuf_iterator<char>(input)), {});
            require(content == (failed ? "original" : "new output"), "output replacement");
            for (const auto& entry : std::filesystem::directory_iterator(root.path())) {
                require(entry.path() == output, "temporary directory leaked");
            }
        }
        {
            Worker worker;
            worker.input_path = (root.path() / "input").string();
            worker.output_path = output.string();
            worker.command = {argv[0], "quiet", output.string()};
            worker.start();
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            auto started = std::chrono::steady_clock::now();
            worker.stop();
            require(std::chrono::steady_clock::now() - started < std::chrono::seconds(2), "quiet child cancellation blocked");
        }
        std::cout << "Worker lifecycle and bounded log tests passed\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
