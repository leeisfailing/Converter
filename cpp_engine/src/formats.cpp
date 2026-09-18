#include "formats.h"
#include <fstream>
#include <algorithm>

namespace engine {

static const std::unordered_set<std::string> VIDEO_EXT = {
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".wmv", ".flv",
    ".m4v", ".mpg", ".mpeg", ".3gp", ".ts", ".mts", ".vob",
};

static const std::unordered_set<std::string> AUDIO_EXT = {
    ".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma", ".m4a",
    ".opus", ".aiff", ".alac", ".ape", ".wv", ".mid", ".midi",
};

static const std::unordered_set<std::string> PHOTO_EXT = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff",
    ".tif", ".svg", ".ico", ".heic", ".heif", ".avif",
};

static const std::unordered_map<std::string, FormatOptions> VIDEO_OUT = {
    {"mp4",   {".mp4",   "libx264", "aac",   std::nullopt, std::nullopt, std::nullopt}},
    {"mkv",   {".mkv",   "libx264", "aac",   std::nullopt, std::nullopt, std::nullopt}},
    {"avi",   {".avi",   "libx264", "mp3",   std::nullopt, std::nullopt, std::nullopt}},
    {"mov",   {".mov",   "libx264", "aac",   std::nullopt, std::nullopt, std::nullopt}},
    {"webm",  {".webm",  "libvpx-vp9", "libopus", std::nullopt, std::nullopt, std::nullopt}},
    {"wmv",   {".wmv",   "wmv2",    "wmav2", std::nullopt, std::nullopt, std::nullopt}},
    {"flv",   {".flv",   "libx264", "aac",   std::nullopt, std::nullopt, std::nullopt}},
    {"gif",   {".gif",   "gif",     std::nullopt, std::nullopt, std::nullopt, std::nullopt}},
    {"m4v",   {".m4v",   "libx264", "aac",   std::nullopt, std::nullopt, std::nullopt}},
    {"mpg",   {".mpg",   "mpeg2video", "mp2", std::nullopt, std::nullopt, std::nullopt}},
    {"mpeg",  {".mpeg",  "mpeg2video", "mp2", std::nullopt, std::nullopt, std::nullopt}},
    {"3gp",   {".3gp",   "libx264", "aac",   std::nullopt, std::nullopt, std::nullopt}},
    {"mts",   {".mts",   "libx264", "aac",   std::nullopt, std::nullopt, std::nullopt}},
    {"vob",   {".vob",   "mpeg2video", "mp2", std::nullopt, std::nullopt, std::nullopt}},
};

static const std::unordered_map<std::string, FormatOptions> AUDIO_OUT = {
    {"mp3",  {".mp3",  std::nullopt, "libmp3lame", "192k", std::nullopt, std::nullopt}},
    {"wav",  {".wav",  std::nullopt, "pcm_s16le",  std::nullopt, std::nullopt, std::nullopt}},
    {"flac", {".flac", std::nullopt, "flac",       std::nullopt, std::nullopt, std::nullopt}},
    {"aac",  {".aac",  std::nullopt, "aac",        "192k", std::nullopt, std::nullopt}},
    {"ogg",  {".ogg",  std::nullopt, "libvorbis",  "192k", std::nullopt, std::nullopt}},
    {"wma",  {".wma",  std::nullopt, "wmav2",      "192k", std::nullopt, std::nullopt}},
    {"m4a",  {".m4a",  std::nullopt, "aac",        "192k", std::nullopt, std::nullopt}},
    {"opus", {".opus", std::nullopt, "libopus",    "128k", std::nullopt, std::nullopt}},
};

static const std::unordered_map<std::string, FormatOptions> PHOTO_OUT = {
    {"jpg",  {".jpg",  std::nullopt, std::nullopt, std::nullopt, "2",  std::nullopt}},
    {"jpeg", {".jpeg", std::nullopt, std::nullopt, std::nullopt, "2",  std::nullopt}},
    {"png",  {".png",  std::nullopt, std::nullopt, std::nullopt, std::nullopt, "3"}},
    {"webp", {".webp", std::nullopt, std::nullopt, std::nullopt, "80", std::nullopt}},
    {"bmp",  {".bmp",  std::nullopt, std::nullopt, std::nullopt, std::nullopt, std::nullopt}},
    {"gif",  {".gif",  std::nullopt, std::nullopt, std::nullopt, std::nullopt, std::nullopt}},
    {"tiff", {".tiff", std::nullopt, std::nullopt, std::nullopt, std::nullopt, std::nullopt}},
    {"tif",  {".tif",  std::nullopt, std::nullopt, std::nullopt, std::nullopt, std::nullopt}},
    {"avif", {".avif", std::nullopt, std::nullopt, std::nullopt, "30", std::nullopt}},
};

const std::unordered_set<std::string>& video_extensions() { return VIDEO_EXT; }
const std::unordered_set<std::string>& audio_extensions() { return AUDIO_EXT; }
const std::unordered_set<std::string>& photo_extensions() { return PHOTO_EXT; }
const std::unordered_map<std::string, FormatOptions>& video_output_formats() { return VIDEO_OUT; }
const std::unordered_map<std::string, FormatOptions>& audio_output_formats() { return AUDIO_OUT; }
const std::unordered_map<std::string, FormatOptions>& photo_output_formats() { return PHOTO_OUT; }

static std::string to_lower(const std::string& s) {
    std::string r = s;
    std::transform(r.begin(), r.end(), r.begin(), ::tolower);
    return r;
}

static std::string get_ext(const std::string& path) {
    auto pos = path.rfind('.');
    if (pos == std::string::npos) return "";
    return to_lower(path.substr(pos));
}

static const uint8_t JPEG_MAGIC[] = {0xff, 0xd8, 0xff};
static const uint8_t PNG_MAGIC[] = {0x89, 0x50, 0x4e, 0x47};
static const uint8_t GIF_MAGIC[] = {0x47, 0x49, 0x46, 0x38};
static const uint8_t BMP_MAGIC[] = {0x42, 0x4d};
static const uint8_t TIFF_LE_MAGIC[] = {0x49, 0x49, 0x2a, 0x00};
static const uint8_t TIFF_BE_MAGIC[] = {0x4d, 0x4d, 0x00, 0x2a};
static const uint8_t FLV_MAGIC[] = {0x46, 0x4c, 0x56, 0x01};
static const uint8_t EBML_MAGIC[] = {0x1a, 0x45, 0xdf, 0xa3};
static const uint8_t TS_MAGIC = 0x47;

static std::string detect_from_content(const std::string& file_path) {
    std::ifstream f(file_path, std::ios::binary);
    if (!f) return "";
    uint8_t header[64] = {};
    f.read(reinterpret_cast<char*>(header), sizeof(header));
    auto n = f.gcount();
    if (n < 4) return "";

    if (n >= 3 && std::equal(JPEG_MAGIC, JPEG_MAGIC + 3, header)) return "photo";
    if (n >= 4 && std::equal(PNG_MAGIC, PNG_MAGIC + 4, header)) return "photo";
    if (n >= 4 && std::equal(GIF_MAGIC, GIF_MAGIC + 4, header)) return "photo";
    if (n >= 2 && std::equal(BMP_MAGIC, BMP_MAGIC + 2, header)) return "photo";
    if (n >= 4 && std::equal(TIFF_LE_MAGIC, TIFF_LE_MAGIC + 4, header)) return "photo";
    if (n >= 4 && std::equal(TIFF_BE_MAGIC, TIFF_BE_MAGIC + 4, header)) return "photo";

    if (n >= 4 && std::equal(FLV_MAGIC, FLV_MAGIC + 4, header)) return "video";
    if (n >= 4 && std::equal(EBML_MAGIC, EBML_MAGIC + 4, header)) return "video";
    if (header[0] == TS_MAGIC) return "video";

    if (n >= 12 && header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F') {
        if (header[8] == 'W' && header[9] == 'E' && header[10] == 'B' && header[11] == 'P') return "photo";
        if (header[8] == 'W' && header[9] == 'A' && header[10] == 'V' && header[11] == 'E') return "audio";
        if (header[8] == 'A' && header[9] == 'V' && header[10] == 'I' && header[11] == ' ') return "video";
    }

    if (n >= 12 && header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p') {
        std::string brand(reinterpret_cast<char*>(header + 8), 4);
        if (brand == "heic" || brand == "heix" || brand == "mif1" || brand == "heim" || brand == "heis") return "photo";
        if (brand == "avif" || brand == "avis") return "photo";
        if (brand == "M4A ") return "audio";
        return "video";
    }

    if (n >= 4 && header[0] == 'O' && header[1] == 'g' && header[2] == 'g' && header[3] == 'S') {
        std::string data(reinterpret_cast<char*>(header), n);
        if (data.find("OpusHead") != std::string::npos || data.find("\x01vorbis") != std::string::npos) return "audio";
        if (data.find("\x80theora") != std::string::npos) return "video";
    }

    return "";
}

std::string detect_file_type(const std::string& file_path) {
    auto ext = get_ext(file_path);
    std::string ext_type;
    if (VIDEO_EXT.count(ext)) ext_type = "video";
    else if (PHOTO_EXT.count(ext)) ext_type = "photo";
    else if (AUDIO_EXT.count(ext)) ext_type = "audio";

    auto content_type = detect_from_content(file_path);
    if (!content_type.empty()) return content_type;
    return ext_type.empty() ? "unknown" : ext_type;
}

}
