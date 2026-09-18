#include "converter.h"
#include "config.h"
#include "security.h"
#include "formats.h"
#include "gpu.h"
#include "media.h"
#include <sstream>

namespace engine {

const std::unordered_map<std::string, std::string> ConverterWorker::CODEC_MAP = {
    {"libx264", "h264"}, {"h264_nvenc", "h264"}, {"h264_amf", "h264"}, {"h264_qsv", "h264"},
    {"libx265", "hevc"}, {"hevc_nvenc", "hevc"}, {"hevc_amf", "hevc"}, {"hevc_qsv", "hevc"},
    {"libvpx-vp9", "vp9"}, {"av1_nvenc", "av1"}, {"av1_amf", "av1"}, {"av1_qsv", "av1"},
};

ConverterWorker::ConverterWorker(const std::string& input_path, const std::string& output_path,
                                 const std::string& output_format, bool dev_mode,
                                 bool use_gpu, const std::string& preferred_encoder)
    : output_format_(output_format), dev_mode_(dev_mode),
      use_gpu_(use_gpu), preferred_encoder_(preferred_encoder) {
    this->input_path = validate_path(input_path, "input_path");
    this->output_path = validate_output_path(output_path, "output_path");
    validate_string(output_format_, "output_format", 32);
    init_process();
}

std::optional<std::string> ConverterWorker::codec_for_encoder(const std::string& encoder) const {
    auto it = CODEC_MAP.find(encoder);
    return it != CODEC_MAP.end() ? std::make_optional(it->second) : std::nullopt;
}

std::vector<std::string> ConverterWorker::build_command() {
    auto file_type = detect_file_type(input_path);
    auto& fmt = output_format_;
    std::vector<std::string> output_args = {"-map_metadata", "0"};
    bool cuda = false;

    auto& audio_formats = audio_output_formats();
    auto& photo_formats = photo_output_formats();
    auto& video_formats = video_output_formats();

    auto it_audio = audio_formats.find(fmt);
    auto it_photo = photo_formats.find(fmt);
    auto it_video = video_formats.find(fmt);

    if (it_audio != audio_formats.end() && (file_type == "video" || file_type == "audio" || dev_mode_)) {
        auto& options = it_audio->second;
        output_args.insert(output_args.end(), {"-map", "0:a:0", "-vn"});
        if (options.acodec) output_args.insert(output_args.end(), {"-c:a", *options.acodec});
        if (options.bitrate) output_args.insert(output_args.end(), {"-b:a", *options.bitrate});

    } else if (it_photo != photo_formats.end() && (file_type == "photo" || (dev_mode_ && !video_formats.count(fmt)))) {
        auto& options = it_photo->second;
        output_args.insert(output_args.end(), {"-frames:v", "1"});
        if (options.quality) output_args.insert(output_args.end(), {"-q:v", *options.quality});
        if (options.compression) output_args.insert(output_args.end(), {"-compression_level", *options.compression});

    } else if (it_video != video_formats.end() && (file_type == "video" || file_type == "photo" || dev_mode_)) {
        auto& options = it_video->second;
        auto encoder = get_video_encoder(use_gpu_, options.vcodec.value_or("libx264"),
                                         preferred_encoder_, fmt);
        MediaMetadata metadata;
        if (file_type == "video") {
            metadata = probe_media(input_path);
        }

        bool copy_video = (file_type == "video" && !max_width_ &&
                           metadata.vcodec.has_value() &&
                           metadata.vcodec == codec_for_encoder(encoder));

        output_args.insert(output_args.end(), {"-map", "0:V:0", "-map", "0:a:0?"});

        if (copy_video) {
            output_args.insert(output_args.end(), {"-c:v", "copy"});
        } else {
            cuda = uses_cuda_frames(encoder, metadata);
            if (max_width_) {
                output_args.push_back("-vf");
                output_args.push_back(scale_filter(*max_width_, -2, cuda, true));
            }
            auto enc_args = video_encoding_args(encoder, 18);
            output_args.insert(output_args.end(), enc_args.begin(), enc_args.end());
        }

        if (options.acodec) {
            std::string audio_codec = *options.acodec;
            if (audio_codec == "libopus") audio_codec = "opus";
            else if (audio_codec == "libmp3lame") audio_codec = "mp3";

            if (copy_video && metadata.acodec && *metadata.acodec == audio_codec) {
                output_args.insert(output_args.end(), {"-c:a", "copy"});
            } else {
                output_args.insert(output_args.end(), {"-c:a", *options.acodec, "-b:a", "192k"});
            }
        } else {
            output_args.push_back("-an");
        }
    } else {
        throw std::runtime_error("Unsupported file type '" + file_type + "' for conversion.");
    }

    if (fmt == "mp4" || fmt == "mov" || fmt == "m4v") {
        output_args.insert(output_args.end(), {"-movflags", "+use_metadata_tags"});
    }

    auto cuda_args = decode_args(cuda);
    std::vector<std::string> cmd = {find_binary("ffmpeg"), "-y", "-nostdin", "-hide_banner"};
    cmd.insert(cmd.end(), cuda_args.begin(), cuda_args.end());
    cmd.push_back("-i");
    cmd.push_back(input_path);
    cmd.insert(cmd.end(), output_args.begin(), output_args.end());
    cmd.push_back(output_path);
    return cmd;
}

}
