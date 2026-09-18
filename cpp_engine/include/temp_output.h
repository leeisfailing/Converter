#pragma once
#include <filesystem>
#include <random>
#include <stdexcept>
#include <string>
#ifdef _WIN32
#include <windows.h>
#endif

namespace engine {
// Put candidates beside their destination so publication never copies media
// across disks. The directory owns all trial outputs, even after exceptions.
class TempOutputDirectory {
public:
    explicit TempOutputDirectory(const std::filesystem::path& destination) {
        auto parent = std::filesystem::absolute(destination).parent_path();
        std::random_device random;
        for (int attempt = 0; attempt < 32; ++attempt) {
            path_ = parent / (".convert-" + std::to_string(random()) + "-" + std::to_string(random()));
            std::error_code ec;
            if (std::filesystem::create_directory(path_, ec)) return;
            if (ec) throw std::filesystem::filesystem_error("Cannot create output directory", path_, ec);
        }
        throw std::runtime_error("Cannot create unique output directory");
    }
    ~TempOutputDirectory() {
        std::error_code ec;
        std::filesystem::remove_all(path_, ec);
    }
    TempOutputDirectory(const TempOutputDirectory&) = delete;
    TempOutputDirectory& operator=(const TempOutputDirectory&) = delete;
    const std::filesystem::path& path() const { return path_; }
private:
    std::filesystem::path path_;
};

inline void replace_output(const std::filesystem::path& source,
                           const std::filesystem::path& destination) {
#ifdef _WIN32
    if (!MoveFileExW(source.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING)) {
        throw std::filesystem::filesystem_error("Cannot publish output", source, destination,
            std::error_code(GetLastError(), std::system_category()));
    }
#else
    std::filesystem::rename(source, destination);
#endif
}
}
