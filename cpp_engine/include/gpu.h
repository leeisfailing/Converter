#pragma once
#include <string>
#include <vector>
#include <optional>
#include <nlohmann/json.hpp>

namespace engine {

struct EncoderInfo {
    std::string id;
    std::string vendor;
    std::string hwaccel;
    std::string label;
};

struct GpuDetectionResult {
    bool available = false;
    std::optional<std::string> encoder;
    std::optional<std::string> vendor;
    std::optional<std::string> hwaccel;
    std::optional<std::string> name;
    std::string message;
    std::vector<EncoderInfo> all_encoders;
};

GpuDetectionResult detect_gpu();
std::vector<std::string> get_hwaccel_for_encoder(const std::string& encoder);
std::vector<std::string> get_hwaccel_args(bool use_gpu, const std::optional<std::string>& encoder = std::nullopt);
std::vector<std::string> get_cuda_decode_args(const std::string& encoder);
std::string get_cuda_scale_filter(int width, int max_width);
std::string get_video_encoder(bool use_gpu, const std::string& fallback = "libx264",
                              const std::string& preferred_encoder = "",
                              const std::optional<std::string>& output_format = std::nullopt);
std::vector<std::string> video_encoding_args(const std::string& encoder, std::optional<int> quality = std::nullopt);

}
