#pragma once
#include "ffmpeg_worker.h"
#include <unordered_map>

namespace engine {

struct UpscalePreset {
    int width;
    int height;
    std::string label;
};

const std::unordered_map<std::string, UpscalePreset>& upscale_presets();

class UpscalerWorker : public FfmpegWorker {
public:
    ~UpscalerWorker() override { stop(); }
    UpscalerWorker(const std::string& input_path, const std::string& output_path,
                   const std::string& target, const std::string& file_type = "video",
                   bool use_gpu = false, const std::string& preferred_encoder = "");

protected:
    std::vector<std::string> build_command() override;

private:
    std::string target_;
    int target_width_;
    int target_height_;
    std::string file_type_;
    bool use_gpu_;
    std::string preferred_encoder_;
};

}
