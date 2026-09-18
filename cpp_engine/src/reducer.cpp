#include "reducer.h"
#include "target_size.h"
#include "config.h"
#include "security.h"
#include "gpu.h"
#include "media.h"
#include "formats.h"
#include <sstream>
#include <algorithm>
#include <cmath>

namespace engine {

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

ReducerWorker::ReducerWorker(const std::string& input_path, const std::string& output_path,
                             int quality,
                             const std::string& file_type, std::optional<long long> target_bytes,
                             bool use_gpu, const std::string& preferred_encoder)
    : quality_(std::max(1, std::min(100, quality))),
      file_type_(file_type), target_bytes_(target_bytes),
      use_gpu_(use_gpu), preferred_encoder_(preferred_encoder) {
    operation = "Reduction";
    this->input_path = validate_path(input_path, "input_path");
    this->output_path = validate_output_path(output_path, "output_path");
    init_process();
}

std::vector<std::string> ReducerWorker::build_command() {
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
        int crf = std::max(1, std::min(51, (int)(40 - (quality_ * 0.28))));
        auto enc_args = video_encoding_args(*video_encoder, crf);
        cmd.insert(cmd.end(), enc_args.begin(), enc_args.end());
        cmd.insert(cmd.end(), {"-c:a", "aac", "-b:a", "128k"});

    } else if (file_type_ == "photo") {
        auto ext = get_ext(output_path);
        if (ext == "jpg" || ext == "jpeg") {
            int qv = std::max(2, std::min(31, (int)(31 - (quality_ * 0.29))));
            cmd.insert(cmd.end(), {"-q:v", std::to_string(qv)});
        } else if (ext == "webp") {
            cmd.insert(cmd.end(), {"-quality", std::to_string(quality_)});
        } else if (ext == "png") {
            int level = std::max(0, std::min(9, (int)(9 - quality_ / 100.0 * 9)));
            cmd.insert(cmd.end(), {"-compression_level", std::to_string(level)});
        }

    } else if (file_type_ == "audio") {
        int bitrate = std::max(32, std::min(320, (int)(32 + quality_ * 3.2)));
        cmd.insert(cmd.end(), {"-c:a", "libmp3lame", "-b:a", std::to_string(bitrate) + "k"});
    }

    auto output_ext = get_ext(output_path);
    if (output_ext == "mp4" || output_ext == "mov" || output_ext == "m4v") {
        cmd.insert(cmd.end(), {"-movflags", "+use_metadata_tags"});
    }
    cmd.insert(cmd.end(), {"-y", output_path});
    return cmd;
}

void ReducerWorker::perform() {
    if (target_bytes_) {
        reduce_to_target(this);
    } else {
        FfmpegWorker::perform();
    }
}

}
