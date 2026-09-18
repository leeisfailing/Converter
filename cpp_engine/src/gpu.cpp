#include "gpu.h"
#include "config.h"
#include <array>
#include <iostream>
#include <sstream>
#include <unordered_map>
#include <unordered_set>
#include <set>
#include <algorithm>
#include <thread>
#include <chrono>

#ifdef _WIN32
#include <windows.h>
#include <dxgi.h>
#pragma comment(lib, "dxgi.lib")
#endif

namespace engine {

struct EncoderDef {
    std::string id;
    std::string vendor;
    std::string hwaccel;
    std::string label;
};

static const std::vector<EncoderDef> ALL_HARDWARE_ENCODERS = {
    {"h264_nvenc", "NVIDIA", "cuda", "NVIDIA NVENC H.264"},
    {"hevc_nvenc", "NVIDIA", "cuda", "NVIDIA NVENC HEVC"},
    {"av1_nvenc",  "NVIDIA", "cuda", "NVIDIA NVENC AV1"},
    {"h264_amf",   "AMD",    "amf",  "AMD AMF H.264"},
    {"hevc_amf",   "AMD",    "amf",  "AMD AMF HEVC"},
    {"av1_amf",    "AMD",    "amf",  "AMD AMF AV1"},
    {"h264_qsv",   "Intel",  "qsv",  "Intel Quick Sync H.264"},
    {"hevc_qsv",   "Intel",  "qsv",  "Intel Quick Sync HEVC"},
    {"av1_qsv",    "Intel",  "qsv",  "Intel Quick Sync AV1"},
};

static const std::vector<std::array<std::string,3>> RECOMMENDED_PRIORITY = {
    {"h264_nvenc", "NVIDIA", "cuda"},
    {"h264_amf",   "AMD",    "amf"},
    {"h264_qsv",   "Intel",  "qsv"},
};

static std::vector<std::string> get_system_gpu_names() {
    std::vector<std::string> gpus;
#ifdef _WIN32
    IDXGIFactory* factory = nullptr;
    if (SUCCEEDED(CreateDXGIFactory(__uuidof(IDXGIFactory), (void**)&factory))) {
        IDXGIAdapter* adapter = nullptr;
        for (UINT i = 0; factory->EnumAdapters(i, &adapter) != DXGI_ERROR_NOT_FOUND; ++i) {
            DXGI_ADAPTER_DESC desc;
            if (SUCCEEDED(adapter->GetDesc(&desc))) {
                wchar_t wname[128] = {};
                char cname[128] = {};
                size_t count = 0;
                wcstombs_s(&count, cname, sizeof(cname), desc.Description, _TRUNCATE);
                gpus.push_back(cname);
            }
            adapter->Release();
        }
        factory->Release();
    }
#elif defined(__linux__)
    std::array<char, 4096> buf;
    FILE* pipe = popen("lspci", "r");
    if (pipe) {
        while (fgets(buf.data(), buf.size(), pipe)) {
            std::string line(buf.data());
            auto lower = line;
            std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
            if (lower.find("vga") != std::string::npos ||
                lower.find("3d") != std::string::npos ||
                lower.find("display") != std::string::npos) {
                auto pos = line.find(": ", 0);
                if (pos != std::string::npos) {
                    auto name = line.substr(pos + 2);
                    while (!name.empty() && (name.back() == '\n' || name.back() == '\r'))
                        name.pop_back();
                    gpus.push_back(name);
                }
            }
        }
        pclose(pipe);
    }
#elif defined(__APPLE__)
    std::array<char, 4096> buf;
    FILE* pipe = popen("system_profiler SPDisplaysDataType", "r");
    if (pipe) {
        while (fgets(buf.data(), buf.size(), pipe)) {
            std::string line(buf.data());
            if (line.find("Chipset Model") != std::string::npos ||
                line.find("Chip Model") != std::string::npos) {
                auto pos = line.find(": ", 0);
                if (pos != std::string::npos) {
                    auto name = line.substr(pos + 2);
                    while (!name.empty() && (name.back() == '\n' || name.back() == '\r'))
                        name.pop_back();
                    gpus.push_back(name);
                }
            }
        }
        pclose(pipe);
    }
#endif
    return gpus;
}

static std::unordered_set<std::string> probe_ffmpeg_encoders() {
    std::unordered_set<std::string> encoders;
    auto ffmpeg = find_binary("ffmpeg");
    std::string cmd = ffmpeg + " -hide_banner -encoders 2>&1";

    FILE* pipe = _popen(cmd.c_str(), "r");
    if (!pipe) return encoders;

    char buf[4096];
    while (fgets(buf, sizeof(buf), pipe)) {
        std::string line(buf);
        std::istringstream iss(line);
        std::vector<std::string> parts;
        std::string part;
        while (iss >> part) parts.push_back(part);
        if (parts.size() >= 2) {
            encoders.insert(parts[1]);
        }
    }
    _pclose(pipe);
    return encoders;
}

static bool encoder_works_cached(const std::string& encoder) {
    static std::unordered_map<std::string, bool> cache;
    auto it = cache.find(encoder);
    if (it != cache.end()) return it->second;

    auto ffmpeg = find_binary("ffmpeg");
    std::string cmd = ffmpeg + " -v error -nostdin -f lavfi -i color=c=black:s=256x256:r=1:d=0.1"
                      " -frames:v 1 -c:v " + encoder + " -pix_fmt yuv420p -f null - 2>&1";

    FILE* pipe = _popen(cmd.c_str(), "r");
    bool works = false;
    if (pipe) {
        char buf[256];
        while (fgets(buf, sizeof(buf), pipe)) {}
        int rc = _pclose(pipe);
        works = (rc == 0);
    }

    std::cerr << "[gpu] Testing encoder: " << encoder << " -> " << (works ? "WORKS" : "FAILED") << std::endl;
    cache[encoder] = works;
    return works;
}

static std::string to_lower_str(const std::string& s) {
    std::string r = s;
    std::transform(r.begin(), r.end(), r.begin(), ::tolower);
    return r;
}

GpuDetectionResult detect_gpu() {
    std::cerr << "[gpu] Running GPU detection..." << std::endl;

    auto compiled = probe_ffmpeg_encoders();
    auto gpus = get_system_gpu_names();

    std::vector<EncoderInfo> available;
    for (auto& enc : ALL_HARDWARE_ENCODERS) {
        if (compiled.count(enc.id) && encoder_works_cached(enc.id)) {
            std::string gpu_name;
            for (auto& g : gpus) {
                if (to_lower_str(g).find(to_lower_str(enc.vendor)) != std::string::npos) {
                    gpu_name = g;
                    break;
                }
            }
            std::string label = enc.label;
            if (!gpu_name.empty()) label += " (" + gpu_name + ")";
            available.push_back({enc.id, enc.vendor, enc.hwaccel, label});
        }
    }

    std::optional<EncoderInfo> best_encoder;
    for (auto& rp : RECOMMENDED_PRIORITY) {
        for (auto& e : available) {
            if (e.id == rp[0]) {
                best_encoder = e;
                break;
            }
        }
        if (best_encoder) break;
    }

    nlohmann::json all_encoders_json = nlohmann::json::array();
    if (best_encoder) {
        all_encoders_json.push_back({
            {"id", best_encoder->id},
            {"vendor", best_encoder->vendor},
            {"label", best_encoder->label + " (Recommended)"}
        });
    }
    for (auto& e : available) {
        if (!best_encoder || e.id != best_encoder->id) {
            all_encoders_json.push_back({
                {"id", e.id},
                {"vendor", e.vendor},
                {"label", e.label}
            });
        }
    }
    all_encoders_json.push_back({
        {"id", "libx264"},
        {"vendor", "CPU"},
        {"label", "Software H.264 (CPU fallback)"}
    });

    std::string gpu_name = gpus.empty() ? "" : gpus[0];

    std::cerr << "[gpu] Best encoder: " << (best_encoder ? best_encoder->id : "none") << std::endl;

    GpuDetectionResult result;
    if (best_encoder) {
        std::string display_name = gpu_name;
        for (auto& g : gpus) {
            if (to_lower_str(g).find(to_lower_str(best_encoder->vendor)) != std::string::npos) {
                display_name = g;
                break;
            }
        }
        if (display_name.empty()) display_name = best_encoder->vendor + " GPU";

        result.available = true;
        result.encoder = best_encoder->id;
        result.vendor = best_encoder->vendor;
        result.hwaccel = best_encoder->hwaccel;
        result.name = display_name;
        result.message = "Detected: " + display_name + " (" + best_encoder->id + ")";
    } else {
        result.available = false;
        result.message = "No hardware encoder found" + (gpu_name.empty() ? "" : " (GPU: " + gpu_name + ")");
        result.name = gpu_name.empty() ? std::nullopt : std::make_optional(gpu_name);
    }

    for (auto& e : all_encoders_json) {
        EncoderInfo info;
        info.id = e["id"].get<std::string>();
        info.vendor = e["vendor"].get<std::string>();
        info.label = e["label"].get<std::string>();
        result.all_encoders.push_back(info);
    }

    return result;
}

std::vector<std::string> get_hwaccel_for_encoder(const std::string& encoder) {
    for (auto& enc : ALL_HARDWARE_ENCODERS) {
        if (enc.id == encoder) {
            return {"-hwaccel", enc.hwaccel};
        }
    }
    if (encoder.size() >= 6 && encoder.substr(encoder.size() - 6) == "_nvenc") return {"-hwaccel", "cuda"};
    if (encoder.size() >= 4 && encoder.substr(encoder.size() - 4) == "_amf")  return {"-hwaccel", "amf"};
    if (encoder.size() >= 4 && encoder.substr(encoder.size() - 4) == "_qsv")  return {"-hwaccel", "qsv"};
    return {};
}

std::vector<std::string> get_hwaccel_args(bool use_gpu, const std::optional<std::string>& encoder) {
    if (!use_gpu) return {};
    auto info = detect_gpu();
    if (!info.available || !info.hwaccel) return {};
    if (encoder && encoder->size() >= 6 && encoder->substr(encoder->size() - 6) == "_nvenc") {
        return {"-hwaccel", "cuda", "-hwaccel_output_format", "cuda"};
    }
    return {"-hwaccel", *info.hwaccel};
}

std::vector<std::string> get_cuda_decode_args(const std::string& encoder) {
    if (encoder.size() < 6 || encoder.substr(encoder.size() - 6) != "_nvenc") return {};
    return {"-hwaccel", "cuda", "-hwaccel_output_format", "cuda"};
}

std::string get_cuda_scale_filter(int width, int max_width) {
    if (max_width <= 0 || width <= max_width) return "";
    int target_w = std::max(2, (max_width / 2) * 2);
    return "scale_cuda=" + std::to_string(target_w) + ":-2";
}

std::string get_video_encoder(bool use_gpu, const std::string& fallback,
                              const std::string& preferred_encoder,
                              const std::optional<std::string>& output_format) {
    if (use_gpu) {
        if (fallback != "libx264") {
            if (fallback == "gif") return fallback;
            throw std::runtime_error("This output codec requires CPU encoding. Choose MP4/MKV for GPU encoding, or select CPU in Settings.");
        }
        for (auto& rp : RECOMMENDED_PRIORITY) {
            if (encoder_works_cached(rp[0])) return rp[0];
        }
        throw std::runtime_error("No working GPU video encoder is available. Select CPU in Settings to use software encoding.");
    }
    if (preferred_encoder.empty() || preferred_encoder == "libx264") return fallback;

    std::unordered_set<std::string> known;
    for (auto& e : ALL_HARDWARE_ENCODERS) known.insert(e.id);
    if (!known.count(preferred_encoder)) throw std::runtime_error("Unknown preferred encoder");

    bool compatible = false;
    if (preferred_encoder.substr(0, 5) == "h264_" && fallback == "libx264") compatible = true;
    if (preferred_encoder.substr(0, 5) == "hevc_" && output_format &&
        (std::set<std::string>{"mp4","mkv","mov","m4v"}.count(*output_format))) compatible = true;
    if (preferred_encoder.substr(0, 4) == "av1_" && output_format &&
        (std::set<std::string>{"mp4","mkv","webm"}.count(*output_format))) compatible = true;
    if (!compatible) {
        throw std::runtime_error("The selected GPU encoder is incompatible with this output format.");
    }
    if (encoder_works_cached(preferred_encoder)) return preferred_encoder;
    throw std::runtime_error("The selected GPU encoder (" + preferred_encoder + ") is unavailable.");
}

std::vector<std::string> video_encoding_args(const std::string& encoder, std::optional<int> quality) {
    std::vector<std::string> args = {"-c:v", encoder};
    if (encoder.size() >= 6 && encoder.substr(encoder.size() - 6) == "_nvenc") {
        args.insert(args.end(), {"-preset", "p4"});
        if (quality) {
            args.insert(args.end(), {"-rc", "vbr", "-cq", std::to_string(*quality), "-b:v", "0"});
        }
    } else if (encoder.size() >= 4 && encoder.substr(encoder.size() - 4) == "_amf") {
        args.insert(args.end(), {"-quality", "balanced"});
        if (quality) {
            args.insert(args.end(), {"-rc", "cqp", "-qp_i", std::to_string(*quality), "-qp_p", std::to_string(*quality)});
        }
    } else if (encoder.size() >= 4 && encoder.substr(encoder.size() - 4) == "_qsv") {
        args.insert(args.end(), {"-preset", "medium"});
        if (quality) {
            args.insert(args.end(), {"-global_quality", std::to_string(*quality)});
        }
    } else if (encoder == "libx264" || encoder == "libx265") {
        args.insert(args.end(), {"-preset", "medium"});
        if (quality) {
            args.insert(args.end(), {"-crf", std::to_string(*quality)});
        }
    }
    return args;
}

}
