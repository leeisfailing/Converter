#pragma once
#include "ffmpeg_worker.h"
#include "media.h"
#include <optional>

namespace engine {

class ConverterWorker : public FfmpegWorker {
public:
    ~ConverterWorker() override { stop(); }
    ConverterWorker(const std::string& input_path, const std::string& output_path,
                    const std::string& output_format, bool dev_mode = false,
                    bool use_gpu = false, const std::string& preferred_encoder = "");

    void set_max_width(int width) { max_width_ = width; }

protected:
    std::vector<std::string> build_command() override;

private:
    std::string output_format_;
    bool dev_mode_;
    bool use_gpu_;
    std::string preferred_encoder_;
    std::optional<int> max_width_;

    static const std::unordered_map<std::string, std::string> CODEC_MAP;
    std::optional<std::string> codec_for_encoder(const std::string& encoder) const;
};

}
