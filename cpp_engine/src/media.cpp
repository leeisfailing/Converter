#include "media.h"
#include "config.h"
#include <sstream>
#include <regex>
#include <fstream>
#include <unordered_set>

namespace engine {

static std::string exec_cmd(const std::string& cmd) {
    std::string result;
    FILE* pipe = _popen(cmd.c_str(), "r");
    if (!pipe) return result;
    char buf[4096];
    while (fgets(buf, sizeof(buf), pipe)) {
        result += buf;
    }
    _pclose(pipe);
    return result;
}

MediaMetadata probe_media(const std::string& path) {
    MediaMetadata meta;
    auto ffprobe = find_binary("ffprobe");
    std::string cmd = ffprobe + " -v error -show_entries"
        " stream=index,codec_type,codec_name,width,height,pix_fmt"
        ":stream_disposition=attached_pic:format=duration"
        " -of json \"" + path + "\" 2>&1";

    std::string output = exec_cmd(cmd);
    if (output.empty()) return meta;

    try {
        auto j = nlohmann::json::parse(output);
        auto streams = j.value("streams", nlohmann::json::array());
        nlohmann::json video = nlohmann::json::object();
        nlohmann::json audio = nlohmann::json::object();

        for (auto& s : streams) {
            if (s.value("codec_type", "") == "video") {
                auto disp = s.value("disposition", nlohmann::json::object());
                if (disp.value("attached_pic", 0) == 0) {
                    video = s;
                }
            }
            if (s.value("codec_type", "") == "audio" && audio.empty()) {
                audio = s;
            }
        }

        if (!video.empty()) {
            if (video.contains("codec_name")) meta.vcodec = video["codec_name"].get<std::string>();
            if (video.contains("width")) meta.width = video["width"].get<int>();
            if (video.contains("height")) meta.height = video["height"].get<int>();
            if (video.contains("pix_fmt")) meta.pix_fmt = video["pix_fmt"].get<std::string>();
        }
        if (!audio.empty()) {
            if (audio.contains("codec_name")) meta.acodec = audio["codec_name"].get<std::string>();
        }
        auto format = j.value("format", nlohmann::json::object());
        if (format.contains("duration")) {
            try { meta.duration = std::stod(format["duration"].get<std::string>()); } catch (...) {}
        }
    } catch (...) {}
    return meta;
}

bool uses_cuda_frames(const std::string& encoder, const MediaMetadata& metadata) {
    if (encoder.empty() || encoder.size() < 6 || encoder.substr(encoder.size() - 6) != "_nvenc")
        return false;

    static const std::unordered_set<std::string> supported_codecs = {
        "h264", "hevc", "av1", "vp9", "vp8", "mpeg2video", "vc1"
    };
    static const std::unordered_set<std::string> supported_pix = {
        "yuv420p", "yuvj420p", "yuv420p10le", "nv12", "p010le"
    };

    if (!metadata.vcodec || !supported_codecs.count(*metadata.vcodec)) return false;
    if (!metadata.pix_fmt || !supported_pix.count(*metadata.pix_fmt)) return false;
    return true;
}

std::vector<std::string> decode_args(bool cuda) {
    if (!cuda) return {};
    return {"-hwaccel", "cuda", "-hwaccel_output_format", "cuda"};
}

std::string scale_filter(int width, int height, bool cuda, bool limit) {
    width = (height == -2) ? std::max(2, (width / 2) * 2) : width;
    std::string w = limit ? ("'min(iw," + std::to_string(width) + ")'") : std::to_string(width);
    std::string name = cuda ? "scale_cuda" : "scale";
    std::string interp = cuda ? "interp_algo=lanczos" : "flags=lanczos";
    return name + "=w=" + w + ":h=" + std::to_string(height) + ":" + interp;
}

}
