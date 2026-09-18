#include "ipc.h"
#include <iostream>
#include <nlohmann/json.hpp>

namespace engine {

Ipc& Ipc::instance() {
    static Ipc inst;
    return inst;
}

void Ipc::send_response(const std::string& json_str) {
    std::lock_guard<std::mutex> lock(write_mutex_);
    try {
        std::cout << json_str << "\n" << std::flush;
    } catch (...) {}
}

void Ipc::send_progress(int percent) {
    nlohmann::json j;
    j["type"] = "progress";
    j["percent"] = percent;
    send_response(j.dump());
}

void Ipc::send_finished(bool ok, const std::string& message, const std::string& file_path) {
    nlohmann::json j;
    j["type"] = "finished";
    j["ok"] = ok;
    j["message"] = message;
    j["file_path"] = file_path;
    send_response(j.dump());
}

}
