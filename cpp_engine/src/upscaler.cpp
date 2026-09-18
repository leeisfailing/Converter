#include "upscaler.h"
#include "config.h"
#include "security.h"
#include "gpu.h"
#include "media.h"
#include <algorithm>

namespace engine {

static const std::unordered_map<std::string, UpscalePreset> PRESETS = {
    {"2k",  {2560, 1440, "2K (1440p)"}},
    {"4k",  {3840, 2160, "4K (2160p)"}},
    {"8k",  {7680, 4320, "8K (4320p)"}},
    {"16k", {15360, 8640, "16K (8640p)"}},
};

const std::unordered_map<std::string, UpscalePreset>& upscale_presets() {
    return PRESETS;
}

static std::string to_lower(const std::string& s) {
    std::string r = s;
    std::transform(r.begin(), r.end(), r.begin(), ::tolower);
    return r;
}

static std::string get_ext(const std::string& path) {
    auto pos = path.rfind('.');
    if (pos == std::string::npos) return "";
    return to_lower(path.substr(pos + 1));
}

UpscalerWorker::UpscalerWorker(const std::string& input_path, const std::string& output_path,
                               const std::string& target, const std::string& file_type,
                               bool use_gpu, const std::string& preferred_encoder)
    : target_(target), file_type_(file_type),
      use_gpu_(use_gpu), preferred_encoder_(preferred_encoder) {
    operation = "Upscale";
    if (!PRESETS.count(target)) {
        throw std::runtime_error("Invalid upscale target: " + target);
    }
    this->input_path = validate_path(input_path, "input_path");
    this->output_path = validate_output_path(output_path, "output_path");
    target_width_ = PRESETS.at(target).width;
    target_height_ = PRESETS.at(target).height;
    init_process();
}

std::vector<std::string> UpscalerWorker::build_command() {
    auto ffmpeg = find_binary("ffmpeg");
    std::vector<std::string> cmd = {ffmpeg, "-nostdin"};

    std::optional<std::string> video_encoder;
    if (file_type_ == "video") {
        auto output_ext = get_ext(output_path);
        video_encoder = get_video_encoder(use_gpu_, "libx264", preferred_encoder_, output_ext);
    }

    MediaMetadata metadata;
    if (video_encoder && video_encoder->size() >= 6 &&
        video_encoder->compare(video_encoder->size() - 6, 6, "_nvenc") == 0) {
        metadata = probe_media(input_path);
    }
    bool cuda = video_encoder ? uses_cuda_frames(*video_encoder, metadata) : false;
    auto cuda_args = decode_args(cuda);
    cmd.insert(cmd.end(), cuda_args.begin(), cuda_args.end());
    cmd.insert(cmd.end(), {"-i", input_path, "-map_metadata", "0"});

    if (file_type_ == "video") {
        cmd.push_back("-vf");
        cmd.push_back(scale_filter(target_width_, target_height_, cuda, false));
        auto enc_args = video_encoding_args(*video_encoder, cuda ? 20 : 18);
        cmd.insert(cmd.end(), enc_args.begin(), enc_args.end());
        cmd.insert(cmd.end(), {"-c:a", "aac", "-b:a", "192k"});

    } else if (file_type_ == "photo") {
        cmd.push_back("-vf");
        cmd.push_back("scale=" + std::to_string(target_width_) + ":" +
                       std::to_string(target_height_) + ":flags=lanczos");
        auto ext = get_ext(output_path);
        if (ext == "jpg" || ext == "jpeg") {
            cmd.insert(cmd.end(), {"-q:v", "2"});
        } else if (ext == "webp") {
            cmd.insert(cmd.end(), {"-quality", "95"});
        } else if (ext == "png") {
            cmd.insert(cmd.end(), {"-compression_level", "6"});
        }
    }

    auto output_ext = get_ext(output_path);
    if (output_ext == "mp4" || output_ext == "mov" || output_ext == "m4v") {
        cmd.insert(cmd.end(), {"-movflags", "+use_metadata_tags"});
    }
    cmd.insert(cmd.end(), {"-y", output_path});
    return cmd;
}

}
