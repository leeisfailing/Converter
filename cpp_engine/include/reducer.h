#pragma once
#include "ffmpeg_worker.h"
#include <optional>

namespace engine {

class ReducerWorker : public FfmpegWorker {
public:
    ~ReducerWorker() override { stop(); }
    ReducerWorker(const std::string& input_path, const std::string& output_path,
                  int quality = 50,
                  const std::string& file_type = "video",
                  std::optional<long long> target_bytes = std::nullopt,
                  bool use_gpu = false, const std::string& preferred_encoder = "");

    void set_target_bytes(long long tb) { target_bytes_ = tb; }

protected:
    std::vector<std::string> build_command() override;
    void perform() override;

public:
    int quality_;
    std::string file_type_;
    std::optional<long long> target_bytes_;
    bool use_gpu_;
    std::string preferred_encoder_;

    friend void reduce_to_target(ReducerWorker* worker);
};

}
