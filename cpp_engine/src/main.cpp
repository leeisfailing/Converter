#include "handlers.h"
#include "ipc.h"
#include <iostream>
#include <string>
#include <unordered_map>
#include <functional>
#include <nlohmann/json.hpp>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    using HandlerFunc = std::function<void(const nlohmann::json&)>;
    std::unordered_map<std::string, HandlerFunc> handlers = {
        {"detect_gpu",     engine::handle_detect_gpu},
        {"start_convert",  engine::handle_start_convert},
        {"start_transcoder", engine::handle_start_transcoder},
        {"start_upscale",  engine::handle_start_upscale},
    };

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        nlohmann::json msg;
        try {
            msg = nlohmann::json::parse(line);
        } catch (nlohmann::json::exception&) {
            engine::Ipc::instance().send_response(
                nlohmann::json({{"ok", false}, {"error", "Invalid JSON"}}).dump());
            continue;
        }

        if (!msg.is_object()) {
            engine::Ipc::instance().send_response(
                nlohmann::json({{"ok", false}, {"error", "Command must be a JSON object"}}).dump());
            continue;
        }

        const auto command = msg.find("cmd");
        if (command == msg.end() || !command->is_string()) {
            engine::Ipc::instance().send_response(
                nlohmann::json({{"ok", false}, {"error", "Command name must be a string"}}).dump());
            continue;
        }
        const auto cmd = command->get<std::string>();

        if (cmd == "cancel") {
            engine::cancel_all();
            continue;
        }

        auto it = handlers.find(cmd);
        if (it != handlers.end()) {
            try {
                it->second(msg);
            } catch (std::exception& e) {
                engine::Ipc::instance().send_response(
                    nlohmann::json({{"ok", false}, {"error", e.what()}}).dump());
            }
        } else {
            engine::Ipc::instance().send_response(
                nlohmann::json({{"ok", false}, {"error", "Unknown command: " + cmd}}).dump());
        }
    }

    engine::cancel_all();
    return 0;
}
