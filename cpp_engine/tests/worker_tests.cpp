#include "ffmpeg_worker.h"
#include "log_buffer.h"
#include "temp_output.h"
#include <fstream>
#include <iostream>
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

int main(int argc, char** argv) {
    if (argc > 1) {
        const std::string mode = argv[1];
        if (mode == "quiet") {
            std::this_thread::sleep_for(std::chrono::seconds(10));
        } else if (mode == "progress") {
            std::cerr << "Duration: 00:00:10.00\rtime=00:00:05.00\r" << std::flush;
        } else if (mode == "write" || mode == "fail") {
            std::ofstream(argv[2]) << "new output";
            if (mode == "fail") return 3;
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
