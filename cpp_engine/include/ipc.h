#pragma once
#include <string>
#include <mutex>

namespace engine {

class Ipc {
public:
    static Ipc& instance();
    void send_response(const std::string& json_str);
    void send_progress(int percent);
    void send_finished(bool ok, const std::string& message = "", const std::string& file_path = "");

private:
    Ipc() = default;
    std::mutex write_mutex_;
};

}
