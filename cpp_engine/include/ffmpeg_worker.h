#pragma once
#include <string>
#include <atomic>
#include <thread>
#include <mutex>
#include <functional>
#include <regex>
#include <vector>
#include <stdexcept>

namespace engine {

class FfmpegError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

class FfmpegWorker {
public:
    std::string operation = "Conversion";
    std::string input_path;
    std::string output_path;
    std::function<void(int)> on_progress;
    std::function<void(bool, const std::string&, const std::string&)> on_finished;

    FfmpegWorker();
    virtual ~FfmpegWorker();

    void start();
    void stop();
    bool is_running() const { return is_running_.load(); }

protected:
    virtual std::vector<std::string> build_command() = 0;

    std::atomic<bool> is_running_{false};
    std::thread worker_thread_;
    void* process_handle_ = nullptr;
    std::mutex process_mutex_;
    int last_pct_ = 0;
    double last_progress_time_ = 0.0;

    void init_process();
    void check_cancelled();
    void execute(const std::vector<std::string>& cmd, bool report_progress = true);
    virtual void perform();

private:
    void run();
    static double seconds_from_match(const std::smatch& match);
    void parse_progress(const std::string& line, double& duration);
};

}
