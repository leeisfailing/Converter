#include "target_size.h"
#include "temp_output.h"
#include "reducer.h"
#include "config.h"
#include "gpu.h"
#include "media.h"
#include <nlohmann/json.hpp>
#include <cmath>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <filesystem>
#include <cstdlib>

#ifdef _WIN32
#include <windows.h>
#else
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace engine {

static std::string exec_cmd_output(const std::vector<std::string>& args) {
    std::string cmd;
    for (size_t i = 0; i < args.size(); ++i) {
        if (i > 0) cmd += " ";
        if (args[i].find(' ') != std::string::npos) cmd += "\"" + args[i] + "\"";
        else cmd += args[i];
    }
    cmd += " 2>&1";

    std::string result;
    FILE* pipe = _popen(cmd.c_str(), "r");
    if (!pipe) return result;
    char buf[4096];
    while (fgets(buf, sizeof(buf), pipe)) result += buf;
    _pclose(pipe);
    return result;
}

static std::string get_ext_lower(const std::string& path) {
    auto pos = path.rfind('.');
    if (pos == std::string::npos) return "";
    std::string ext = path.substr(pos + 1);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    return ext;
}

void reduce_to_target(ReducerWorker* worker) {
    auto target = *worker->target_bytes_;
    if (target <= 0 || target > 10000000000LL) {
        throw std::runtime_error("Target size must be greater than zero and at most 10 GB");
    }
    auto destination = std::filesystem::path(worker->output_path);
    if (std::filesystem::weakly_canonical(destination) ==
        std::filesystem::weakly_canonical(std::filesystem::path(worker->input_path))) {
        throw std::runtime_error("Output must be different from the original file");
    }

    std::string extension;
    if (worker->file_type_ == "video") extension = ".mp4";
    else if (worker->file_type_ == "audio") extension = ".mp3";
    else if (worker->file_type_ == "photo") extension = ".webp";
    else throw std::runtime_error("Invalid file type");

    if (get_ext_lower(worker->output_path) != extension.substr(1)) {
        throw std::runtime_error("Target-size output must use " + extension);
    }

    auto probe_output = exec_cmd_output({find_binary("ffprobe"), "-v", "error",
        "-show_streams", "-show_format", "-of", "json", worker->input_path});

    nlohmann::json metadata;
    try { metadata = nlohmann::json::parse(probe_output); } catch (...) {
        throw std::runtime_error("Failed to parse media metadata");
    }

    auto streams = metadata.value("streams", nlohmann::json::array());
    nlohmann::json video = nlohmann::json::object();
    nlohmann::json audio = nlohmann::json::object();
    for (auto& s : streams) {
        if (s.value("codec_type", "") == "video" && video.empty()) video = s;
        if (s.value("codec_type", "") == "audio" && audio.empty()) audio = s;
    }

    double duration = 0.0;
    try { duration = std::stod(metadata.at("format").at("duration").get<std::string>()); } catch (...) {}
    if (worker->file_type_ != "photo" && (!std::isfinite(duration) || duration <= 0)) {
        throw std::runtime_error("Cannot determine media duration for the target size");
    }

    int width = 0;
    if (!video.empty() && video.contains("width")) {
        width = video["width"].get<int>();
    }

    double budget = 0.0;
    if (duration > 0) {
        budget = std::max(0.0, (double)(target - 1024)) * 8.0 * 0.88 / duration;
    }

    TempOutputDirectory temporary(destination);
    const auto& folder = temporary.path();

    auto candidate = folder / ("result" + extension);
    auto best = folder / ("best" + extension);

    auto keep_candidate = [&]() -> bool {
        if (!worker->is_running()) throw std::runtime_error("Reduction was cancelled");
        if (std::filesystem::exists(candidate) && std::filesystem::file_size(candidate) > 0 &&
            std::filesystem::file_size(candidate) <= (std::uintmax_t)target) {
            replace_output(candidate, best);
            return true;
        }
        return false;
    };

    auto finish = [&]() {
        if (!worker->is_running()) throw std::runtime_error("Reduction was cancelled");
        replace_output(best, destination);
        if (worker->on_progress) worker->on_progress(100);
    };

    auto source = std::filesystem::path(worker->input_path);
    if (get_ext_lower(worker->input_path) == extension.substr(1) &&
        std::filesystem::file_size(source) <= (std::uintmax_t)target &&
        (video.empty() || width == video.value("width", 0))) {
        std::filesystem::copy_file(source, best, std::filesystem::copy_options::overwrite_existing);
        finish();

        return;
    }

    if (worker->file_type_ == "photo") {
        if (video.empty()) throw std::runtime_error("No image stream found");
        auto base_cmd = std::vector<std::string>{
            find_binary("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", worker->input_path,
            "-vf", "scale=" + std::to_string(width) + ":-1", "-c:v", "libwebp",
            "-compression_level", "6", "-an"
        };

        auto lossless_cmd = base_cmd;
        lossless_cmd.insert(lossless_cmd.end(), {"-lossless", "1", candidate.string()});
        worker->execute(lossless_cmd, false);

        if (keep_candidate()) { finish(); return; }

        int low = 1, high = 100;
        for (int attempt = 0; attempt < 7; ++attempt) {
            if (low > high) break;
            int quality = (low + high) / 2;
            auto q_cmd = base_cmd;
            q_cmd.insert(q_cmd.end(), {"-quality", std::to_string(quality), candidate.string()});
            worker->execute(q_cmd, false);
            if (keep_candidate()) low = quality + 1;
            else high = quality - 1;
            if (worker->on_progress) worker->on_progress(10 + attempt * 12);
        }
        if (std::filesystem::exists(best)) { finish(); return; }

        throw std::runtime_error("Target is too small at this resolution.");
    }

    std::vector<int> rates = {320, 256, 224, 192, 160, 128, 112, 96, 80, 64, 56, 48, 40, 32, 24, 16, 8};
    std::vector<int> valid_rates;
    for (int r : rates) {
        if (r * 1000.0 * duration / 8.0 <= target) valid_rates.push_back(r);
    }
    if (valid_rates.empty()) throw std::runtime_error("Target is too small for this audio.");

    double lower = 0, upper = 0;
    std::optional<std::string> encoder;
    bool cuda = false;
    if (worker->file_type_ == "video") {
        encoder = get_video_encoder(worker->use_gpu_, "libx264", worker->preferred_encoder_, "mp4");
        MediaMetadata m;
        if (!video.empty()) {
            if (video.contains("codec_name")) m.vcodec = video["codec_name"].get<std::string>();
            if (video.contains("pix_fmt")) m.pix_fmt = video["pix_fmt"].get<std::string>();
        }
        cuda = uses_cuda_frames(*encoder, m);
    }

    int max_attempts = (worker->file_type_ == "audio") ? (int)valid_rates.size() : 12;
    for (int attempt = 0; attempt < max_attempts; ++attempt) {
        auto cmd = std::vector<std::string>{
            find_binary("ffmpeg"), "-v", "error", "-nostdin", "-y"
        };
        auto cuda_args = decode_args(cuda);
        cmd.insert(cmd.end(), cuda_args.begin(), cuda_args.end());
        cmd.insert(cmd.end(), {"-i", worker->input_path, "-map_metadata", "0"});

        if (worker->file_type_ == "audio") {
            if (audio.empty()) throw std::runtime_error("Target is too small for this audio.");
            int rate = valid_rates[attempt];
            cmd.insert(cmd.end(), {"-map", "0:a:0", "-vn", "-c:a", "libmp3lame",
                                   "-b:a", std::to_string(rate) + "k", "-compression_level", "0"});
        } else {
            double audio_rate = std::min(192000.0, std::max(16000.0, budget * 0.15));
            int video_rate = (int)(budget - audio_rate);
            if (video.empty() || video_rate < 4000) {
                continue;
            }
            cmd.insert(cmd.end(), {"-map", "0:V:0"});
            cmd.push_back("-vf");
            cmd.push_back(scale_filter(width, -2, cuda, true));

            if (worker->on_progress) worker->on_progress(std::min(90, 5 + attempt * 16));

            if (*encoder == "libx264") {
                cmd.insert(cmd.end(), {"-c:v", "libx264", "-b:v", std::to_string(video_rate),
                                       "-preset", "veryslow", "-pix_fmt", "yuv420p",
                                       "-passlogfile", (folder / "analysis").string()});
                auto pass1_cmd = cmd;
                pass1_cmd.insert(pass1_cmd.end(), {"-pass", "1", "-an", "-f", "null", std::string(1, std::filesystem::path::preferred_separator) == "/" ? "/dev/null" : "NUL"});
                worker->execute(pass1_cmd, false);
                cmd.insert(cmd.end(), {"-pass", "2"});
            } else {
                auto enc_args = video_encoding_args(*encoder);
                cmd.insert(cmd.end(), enc_args.begin(), enc_args.end());
                cmd.insert(cmd.end(), {"-b:v", std::to_string(video_rate),
                                       "-maxrate", std::to_string((int)(video_rate * 1.5)),
                                       "-bufsize", std::to_string(video_rate * 2)});
                if (encoder->size() >= 6 && encoder->substr(encoder->size() - 6) == "_nvenc") {
                    cmd.insert(cmd.end(), {"-rc", "vbr", "-multipass", "fullres"});
                } else if (encoder->size() >= 4 && encoder->substr(encoder->size() - 4) == "_amf") {
                    cmd.insert(cmd.end(), {"-rc", "vbr_peak"});
                }
            }

            cmd.insert(cmd.end(), {"-map", "0:a:0?", "-movflags", "+faststart+use_metadata_tags"});
            if (!audio.empty()) {
                cmd.insert(cmd.end(), {"-c:a", "aac", "-b:a", std::to_string((int)audio_rate)});
            }
        }

        cmd.push_back(candidate.string());
        if (worker->on_progress) worker->on_progress(std::min(90, 10 + attempt * 16));
        worker->execute(cmd, false);

        if (!worker->is_running()) throw std::runtime_error("Reduction was cancelled");

        auto size = std::filesystem::file_size(candidate);
        if (keep_candidate()) {
            if (worker->file_type_ == "audio" || size >= (std::uintmax_t)(target * 0.97)) {
                finish();

                return;
            }
            lower = budget;
            budget = upper > 0 ? (budget + upper) / 2.0 : budget * std::min(2.0, (double)target / std::max(1.0, (double)size));
        } else {
            upper = budget;
            budget = lower > 0 ? (lower + budget) / 2.0 : budget * (double)target / std::max(1.0, (double)size) * 0.92;
        }
    }

    if (std::filesystem::exists(best)) {
        finish();

        return;
    }

    // Fallback: try progressively smaller resolutions when bitrate alone can't fit
    if (!video.empty() && worker->file_type_ == "video") {
        double fallback_scales[] = {0.75, 0.6, 0.5, 0.4, 0.3, 0.2};
        for (double scale : fallback_scales) {
            int scaled_width = std::max(256, (int)(width * scale));
            scaled_width = scaled_width & ~1;

            double fallback_budget = std::max(0.0, (double)(target - 1024)) * 8.0 * 0.80 / duration;
            double fl = 0, fu = 0;

            for (int attempt = 0; attempt < 10; ++attempt) {
                double audio_rate = audio.empty() ? 0 : std::min(64000.0, std::max(8000.0, fallback_budget * 0.10));
                int video_rate = (int)(fallback_budget - audio_rate);
                if (video_rate < 3000) break;

                auto cmd = std::vector<std::string>{
                    find_binary("ffmpeg"), "-v", "error", "-nostdin", "-y"
                };
                auto cuda_args = decode_args(cuda);
                cmd.insert(cmd.end(), cuda_args.begin(), cuda_args.end());
                cmd.insert(cmd.end(), {"-i", worker->input_path, "-map_metadata", "0"});
                cmd.insert(cmd.end(), {"-map", "0:V:0"});
                cmd.push_back("-vf");
                cmd.push_back(scale_filter(scaled_width, -2, cuda, true));

                if (*encoder == "libx264") {
                    cmd.insert(cmd.end(), {"-c:v", "libx264", "-b:v", std::to_string(video_rate),
                                           "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                                           "-passlogfile", (folder / "fb_analysis").string()});
                    auto pass1_cmd = cmd;
                    pass1_cmd.insert(pass1_cmd.end(), {"-pass", "1", "-an", "-f", "null",
                        std::string(1, std::filesystem::path::preferred_separator) == "/" ? "/dev/null" : "NUL"});
                    worker->execute(pass1_cmd, false);
                    cmd.insert(cmd.end(), {"-pass", "2"});
                } else {
                    auto enc_args = video_encoding_args(*encoder);
                    cmd.insert(cmd.end(), enc_args.begin(), enc_args.end());
                    cmd.insert(cmd.end(), {"-b:v", std::to_string(video_rate),
                                           "-maxrate", std::to_string((int)(video_rate * 1.1)),
                                           "-bufsize", std::to_string(video_rate)});
                    if (encoder->size() >= 6 && encoder->substr(encoder->size() - 6) == "_nvenc") {
                        cmd.insert(cmd.end(), {"-rc", "constqp", "-qp", "35"});
                    } else if (encoder->size() >= 4 && encoder->substr(encoder->size() - 4) == "_amf") {
                        cmd.insert(cmd.end(), {"-rc", "cqp", "-qp_p", "35", "-qp_i", "30"});
                    }
                }

                cmd.insert(cmd.end(), {"-map", "0:a:0?", "-movflags", "+faststart+use_metadata_tags"});
                if (!audio.empty()) {
                    cmd.insert(cmd.end(), {"-c:a", "aac", "-b:a", std::to_string((int)audio_rate)});
                }
                cmd.push_back(candidate.string());
                worker->execute(cmd, false);

                if (!worker->is_running()) throw std::runtime_error("Reduction was cancelled");

                auto fb_size = std::filesystem::file_size(candidate);
                if (keep_candidate()) {
                    if (fb_size >= (std::uintmax_t)(target * 0.95)) {
                        finish();
                        return;
                    }
                    fl = fallback_budget;
                    fallback_budget = fu > 0 ? (fallback_budget + fu) / 2.0
                        : fallback_budget * std::min(2.0, (double)target / std::max(1.0, (double)fb_size));
                } else {
                    fu = fallback_budget;
                    fallback_budget = fl > 0 ? (fl + fallback_budget) / 2.0
                        : fallback_budget * (double)target / std::max(1.0, (double)fb_size) * 0.85;
                }
            }

            if (std::filesystem::exists(best)) {
                finish();
                return;
            }
        }

        // Last resort: try CRF encoding at minimal resolution to get under target
        for (double scale : {0.5, 0.25}) {
            int scaled_width = std::max(256, (int)(width * scale));
            scaled_width = scaled_width & ~1;
            for (int crf = 51; crf >= 28; crf -= 3) {
                auto cmd = std::vector<std::string>{
                    find_binary("ffmpeg"), "-v", "error", "-nostdin", "-y"
                };
                auto cuda_args = decode_args(cuda);
                cmd.insert(cmd.end(), cuda_args.begin(), cuda_args.end());
                cmd.insert(cmd.end(), {"-i", worker->input_path, "-map_metadata", "0"});
                cmd.insert(cmd.end(), {"-map", "0:V:0"});
                cmd.push_back("-vf");
                cmd.push_back(scale_filter(scaled_width, -2, cuda, true));

                if (*encoder == "libx264") {
                    cmd.insert(cmd.end(), {"-c:v", "libx264", "-crf", std::to_string(crf),
                                           "-maxrate", std::to_string(std::max(40000, (int)(target * 8 / duration / 2))),
                                           "-bufsize", std::to_string(std::max(40000, (int)(target * 8 / duration))),
                                           "-preset", "ultrafast", "-pix_fmt", "yuv420p"});
                } else {
                    auto enc_args = video_encoding_args(*encoder);
                    cmd.insert(cmd.end(), enc_args.begin(), enc_args.end());
                    int maxrate = std::max(40000, (int)(target * 8 / duration / 2));
                    cmd.insert(cmd.end(), {"-rc", "vbr", "-cq", std::to_string(crf),
                                           "-maxrate", std::to_string(maxrate),
                                           "-bufsize", std::to_string(maxrate * 2)});
                }

                cmd.insert(cmd.end(), {"-map", "0:a:0?", "-movflags", "+faststart+use_metadata_tags"});
                if (!audio.empty()) {
                    cmd.insert(cmd.end(), {"-c:a", "aac", "-b:a", "48000"});
                }
                cmd.push_back(candidate.string());
                worker->execute(cmd, false);

                if (!worker->is_running()) throw std::runtime_error("Reduction was cancelled");

                if (keep_candidate()) {
                    finish();
                    return;
                }
            }
        }
    }

    throw std::runtime_error("Could not fit the complete file within the target size.");
}

}
