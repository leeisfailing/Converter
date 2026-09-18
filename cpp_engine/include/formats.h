#pragma once
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <optional>

namespace engine {

struct FormatOptions {
    std::string ext;
    std::optional<std::string> vcodec;
    std::optional<std::string> acodec;
    std::optional<std::string> bitrate;
    std::optional<std::string> quality;
    std::optional<std::string> compression;
};

const std::unordered_set<std::string>& video_extensions();
const std::unordered_set<std::string>& audio_extensions();
const std::unordered_set<std::string>& photo_extensions();
const std::unordered_map<std::string, FormatOptions>& video_output_formats();
const std::unordered_map<std::string, FormatOptions>& audio_output_formats();
const std::unordered_map<std::string, FormatOptions>& photo_output_formats();

std::string detect_file_type(const std::string& file_path);

}
