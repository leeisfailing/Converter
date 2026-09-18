#pragma once
#include <nlohmann/json.hpp>

namespace engine {

void handle_detect_gpu(const nlohmann::json& cmd_args);
void handle_start_convert(const nlohmann::json& cmd_args);
void handle_start_transcoder(const nlohmann::json& cmd_args);
void handle_start_upscale(const nlohmann::json& cmd_args);
void cancel_all();

}
