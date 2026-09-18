#pragma once
#include <string>
#include <optional>
#include <nlohmann/json.hpp>

namespace engine {

struct MediaMetadata {
    std::optional<std::string> vcodec;
    std::optional<std::string> acodec;
    std::optional<int> width;
    std::optional<int> height;
    std::optional<std::string> pix_fmt;
    std::optional<double> duration;
};

MediaMetadata probe_media(const std::string& path);
bool uses_cuda_frames(const std::string& encoder, const MediaMetadata& metadata);
std::vector<std::string> decode_args(bool cuda);
std::string scale_filter(int width, int height = -2, bool cuda = false, bool limit = false);

}
