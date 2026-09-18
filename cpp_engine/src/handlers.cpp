#include "handlers.h"
#include "ipc.h"
#include "gpu.h"
#include "converter.h"
#include "reducer.h"
#include "upscaler.h"
#include "security.h"
#include "formats.h"
#include <thread>
#include <atomic>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <filesystem>

namespace engine {

static std::mutex workers_mutex;
static std::unordered_map<std::string, std::unique_ptr<FfmpegWorker>> active_workers;

static bool has_active_worker() {
    std::lock_guard<std::mutex> lock(workers_mutex);
    for (auto it = active_workers.begin(); it != active_workers.end();) {
        if (it->second && it->second->is_running()) {
            return true;
        }
        it = active_workers.erase(it);
    }
    return false;
}

static void cancel_all_workers() {
    std::lock_guard<std::mutex> lock(workers_mutex);
    for (auto& [key, worker] : active_workers) {
        if (worker) worker->stop();
    }
    active_workers.clear();
}

static void store_worker(const std::string& key, std::unique_ptr<FfmpegWorker> worker) {
    std::lock_guard<std::mutex> lock(workers_mutex);
    active_workers[key] = std::move(worker);
}

static bool validate_encoder_str(const std::string& enc) {
    if (enc.empty() || enc == "libx264") return true;
    static const std::unordered_set<std::string> known = {
        "h264_nvenc", "hevc_nvenc", "av1_nvenc",
        "h264_amf", "hevc_amf", "av1_amf",
        "h264_qsv", "hevc_qsv", "av1_qsv"
    };
    return known.count(enc);
}

void handle_detect_gpu(const nlohmann::json&) {
    try {
        auto info = detect_gpu();
        nlohmann::json j = {
            {"ok", true},
            {"available", info.available},
            {"hwaccel", info.hwaccel.value_or("")},
            {"message", info.message},
        };
        if (info.encoder) j["encoder"] = *info.encoder;
        if (info.vendor) j["vendor"] = *info.vendor;
        if (info.name) j["name"] = *info.name;

        nlohmann::json encoders = nlohmann::json::array();
        for (auto& e : info.all_encoders) {
            encoders.push_back({{"id", e.id}, {"vendor", e.vendor}, {"label", e.label}});
        }
        j["all_encoders"] = encoders;
        Ipc::instance().send_response(j.dump());
    } catch (std::exception& e) {
        Ipc::instance().send_response(nlohmann::json({
            {"ok", false}, {"available", false}, {"encoder", nullptr},
            {"vendor", nullptr}, {"hwaccel", nullptr}, {"name", nullptr},
            {"message", "GPU detection failed: " + std::string(e.what())},
            {"all_encoders", nlohmann::json::array()}
        }).dump());
    }
}

void handle_start_convert(const nlohmann::json& cmd_args) {
    try {
        std::string input_path, output_path, output_format;
        try {
            input_path = cmd_args.at("input").get<std::string>();
            output_path = cmd_args.at("output").get<std::string>();
            output_format = cmd_args.at("format").get<std::string>();
        } catch (nlohmann::json::exception& e) {
            Ipc::instance().send_finished(false, std::string("Missing required field: ") + e.what());
            return;
        }
        if (input_path.empty() || output_path.empty() || output_format.empty()) {
            Ipc::instance().send_finished(false, "Empty required field");
            return;
        }
        try {
            input_path = validate_file_exists(input_path, "input");
            output_path = validate_output_path(output_path, "output");
            validate_string(output_format, "format", 64);
        } catch (ValidationError& e) {
            Ipc::instance().send_finished(false, e.what());
            return;
        }

        std::transform(output_format.begin(), output_format.end(), output_format.begin(), ::tolower);

        if (!video_output_formats().count(output_format) &&
            !audio_output_formats().count(output_format) &&
            !photo_output_formats().count(output_format)) {
            Ipc::instance().send_finished(false, "Invalid format: " + output_format);
            return;
        }

        auto parent = std::filesystem::path(output_path).parent_path();
        if (!std::filesystem::exists(parent)) {
            try { std::filesystem::create_directories(parent); }
            catch (std::exception& e) {
                Ipc::instance().send_finished(false, "Cannot create output directory: " + std::string(e.what()));
                return;
            }
        }

        bool dev_mode = cmd_args.value("dev_mode", false);
        bool use_gpu = cmd_args.value("use_gpu", false);
        std::string preferred_encoder = cmd_args.value("preferred_encoder", "");
        const std::string selected_gpu = cmd_args.value("selected_gpu", "");
        if (!validate_encoder_str(selected_gpu)) {
            Ipc::instance().send_finished(false, "Invalid selected GPU encoder");
            return;
        }
        if (use_gpu && !selected_gpu.empty()) {
            preferred_encoder = selected_gpu;
            use_gpu = false; // Workers use false + explicit encoder for manual hardware mode.
        }

        if (!validate_encoder_str(preferred_encoder)) {
            Ipc::instance().send_finished(false, "Invalid preferred encoder");
            return;
        }

        auto worker = std::make_unique<ConverterWorker>(
            input_path, output_path, output_format, dev_mode, use_gpu, preferred_encoder);

        auto* w = worker.get();
        w->on_progress = [](int pct) { Ipc::instance().send_progress(pct); };
        w->on_finished = [](bool ok, const std::string& msg, const std::string& fp) {
            Ipc::instance().send_finished(ok, msg, fp);
        };

        store_worker("convert", std::move(worker));
        w->start();
    } catch (std::exception& e) {
        Ipc::instance().send_finished(false, std::string("Convert failed: ") + e.what());
    }
}

void handle_start_transcoder(const nlohmann::json& cmd_args) {
    try {
        std::string input_path, output_path, file_type;
        try {
            input_path = cmd_args.at("input").get<std::string>();
            output_path = cmd_args.at("output").get<std::string>();
            file_type = cmd_args.at("file_type").get<std::string>();
        } catch (nlohmann::json::exception& e) {
            Ipc::instance().send_finished(false, std::string("Missing required field: ") + e.what());
            return;
        }
        if (input_path.empty() || output_path.empty() || file_type.empty()) {
            Ipc::instance().send_finished(false, "Empty required field");
            return;
        }

        std::transform(file_type.begin(), file_type.end(), file_type.begin(), ::tolower);
        if (file_type != "video" && file_type != "photo" && file_type != "audio") {
            Ipc::instance().send_finished(false, "Invalid file_type: " + file_type);
            return;
        }

        try {
            input_path = validate_file_exists(input_path, "input");
            output_path = validate_output_path(output_path, "output");
            validate_string(file_type, "file_type", 32);
        } catch (ValidationError& e) {
            Ipc::instance().send_finished(false, e.what());
            return;
        }

        auto parent = std::filesystem::path(output_path).parent_path();
        if (!std::filesystem::exists(parent)) {
            try { std::filesystem::create_directories(parent); }
            catch (std::exception& e) {
                Ipc::instance().send_finished(false, "Cannot create output directory: " + std::string(e.what()));
                return;
            }
        }

        int quality = cmd_args.value("quality", 50);
        if (quality < 1 || quality > 100) {
            Ipc::instance().send_finished(false, "quality must be between 1 and 100");
            return;
        }

        std::optional<long long> target_bytes;
        if (cmd_args.contains("target_bytes") && !cmd_args["target_bytes"].is_null()) {
            target_bytes = cmd_args["target_bytes"].get<long long>();
            if (*target_bytes <= 0 || *target_bytes > 10000000000LL) {
                Ipc::instance().send_finished(false, "Target size must be between 0 and 10 GB");
                return;
            }
        }

        bool use_gpu = cmd_args.value("use_gpu", false);
        std::string preferred_encoder = cmd_args.value("preferred_encoder", "");
        const std::string selected_gpu = cmd_args.value("selected_gpu", "");
        if (!validate_encoder_str(selected_gpu)) {
            Ipc::instance().send_finished(false, "Invalid selected GPU encoder");
            return;
        }
        if (use_gpu && !selected_gpu.empty()) {
            preferred_encoder = selected_gpu;
            use_gpu = false; // Workers use false + explicit encoder for manual hardware mode.
        }
        if (!validate_encoder_str(preferred_encoder)) {
            Ipc::instance().send_finished(false, "Invalid preferred encoder");
            return;
        }

        auto worker = std::make_unique<ReducerWorker>(
            input_path, output_path, quality, file_type, target_bytes, use_gpu, preferred_encoder);

        auto* w = worker.get();
        w->on_progress = [](int pct) { Ipc::instance().send_progress(pct); };
        w->on_finished = [](bool ok, const std::string& msg, const std::string& fp) {
            Ipc::instance().send_finished(ok, msg, fp);
        };

        store_worker("transcoder", std::move(worker));
        w->start();
    } catch (std::exception& e) {
        Ipc::instance().send_finished(false, std::string("Reduction failed: ") + e.what());
    }
}

void handle_start_upscale(const nlohmann::json& cmd_args) {
    try {
        std::string input_path, output_path, target, file_type;
        try {
            input_path = cmd_args.at("input").get<std::string>();
            output_path = cmd_args.at("output").get<std::string>();
            target = cmd_args.at("target").get<std::string>();
            file_type = cmd_args.at("file_type").get<std::string>();
        } catch (nlohmann::json::exception& e) {
            Ipc::instance().send_finished(false, std::string("Missing required field: ") + e.what());
            return;
        }

        auto& presets = upscale_presets();
        if (!presets.count(target)) {
            Ipc::instance().send_finished(false, "Invalid target: " + target);
            return;
        }

        std::transform(file_type.begin(), file_type.end(), file_type.begin(), ::tolower);
        if (file_type != "video" && file_type != "photo") {
            Ipc::instance().send_finished(false, "Invalid file_type: " + file_type);
            return;
        }

        try {
            input_path = validate_file_exists(input_path, "input");
            output_path = validate_output_path(output_path, "output");
            validate_string(file_type, "file_type", 32);
        } catch (ValidationError& e) {
            Ipc::instance().send_finished(false, e.what());
            return;
        }

        auto parent = std::filesystem::path(output_path).parent_path();
        if (!std::filesystem::exists(parent)) {
            try { std::filesystem::create_directories(parent); }
            catch (std::exception& e) {
                Ipc::instance().send_finished(false, "Cannot create output directory: " + std::string(e.what()));
                return;
            }
        }

        bool use_gpu = cmd_args.value("use_gpu", false);
        std::string preferred_encoder = cmd_args.value("preferred_encoder", "");
        const std::string selected_gpu = cmd_args.value("selected_gpu", "");
        if (!validate_encoder_str(selected_gpu)) {
            Ipc::instance().send_finished(false, "Invalid selected GPU encoder");
            return;
        }
        if (use_gpu && !selected_gpu.empty()) {
            preferred_encoder = selected_gpu;
            use_gpu = false; // Workers use false + explicit encoder for manual hardware mode.
        }
        if (!validate_encoder_str(preferred_encoder)) {
            Ipc::instance().send_finished(false, "Invalid preferred encoder");
            return;
        }

        auto worker = std::make_unique<UpscalerWorker>(
            input_path, output_path, target, file_type, use_gpu, preferred_encoder);

        auto* w = worker.get();
        w->on_progress = [](int pct) { Ipc::instance().send_progress(pct); };
        w->on_finished = [](bool ok, const std::string& msg, const std::string& fp) {
            Ipc::instance().send_finished(ok, msg, fp);
        };

        store_worker("upscale", std::move(worker));
        w->start();
    } catch (std::exception& e) {
        Ipc::instance().send_finished(false, std::string("Upscale failed: ") + e.what());
    }
}

void cancel_all() {
    cancel_all_workers();
    Ipc::instance().send_response(nlohmann::json({{"ok", true}}).dump());
}

}
