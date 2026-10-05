#include "config.h"
#include "native_paths.h"
#include <cstdlib>
#include <vector>
#include <sstream>

#ifdef _WIN32
#include <windows.h>
#include <shlwapi.h>
#pragma comment(lib, "shlwapi.lib")
#else
#include <unistd.h>
#include <climits>
#endif

namespace engine {

static std::filesystem::path get_executable_dir() {
#ifdef _WIN32
    wchar_t buf[32768] = {0};
    const DWORD length = GetModuleFileNameW(nullptr, buf, 32768);
    if (!length || length >= 32768) throw std::runtime_error("Cannot locate native engine executable");
    std::filesystem::path p(buf);
    return p.parent_path();
#else
    char buf[PATH_MAX] = {0};
    ssize_t len = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
    if (len != -1) {
        buf[len] = '\0';
        return std::filesystem::path(buf).parent_path();
    }
    return std::filesystem::current_path();
#endif
}

std::filesystem::path resource_path(const std::string& relative) {
    static std::filesystem::path base = []() {
        auto exe_dir = get_executable_dir();
        auto engine_dir = exe_dir.parent_path() / "PyEngine";
        if (std::filesystem::exists(engine_dir)) {
            return engine_dir;
        }
        return exe_dir;
    }();
    return base / native_path(relative);
}

std::string find_binary(const std::string& name) {
    std::string exe_name = name;
#ifdef _WIN32
    if (exe_name.size() < 4 || exe_name.substr(exe_name.size() - 4) != ".exe") {
        exe_name += ".exe";
    }
#endif

    auto base = resource_path("");
    auto exe_dir = get_executable_dir();

    std::vector<std::filesystem::path> search_dirs = {
        base / "bin",
        base,
        base.parent_path(),
        exe_dir,
    };

#ifdef __linux__
    // Avoid overwriting the distribution's /usr/bin/ffmpeg when installing.
    if (name == "ffmpeg" || name == "ffprobe") {
        const auto bundled_name = "converter-" + name;
        for (const auto& dir : search_dirs) {
            const auto path = dir / bundled_name;
            if (std::filesystem::is_regular_file(path)) return path.string();
        }
        if (const auto* path = getenv("PATH")) {
            std::istringstream dirs(path);
            std::string dir;
            while (std::getline(dirs, dir, ':')) {
                const auto candidate = std::filesystem::path(dir) / bundled_name;
                if (std::filesystem::is_regular_file(candidate)) return candidate.string();
            }
        }
    }
#endif

    for (auto& dir : search_dirs) {
        auto path = dir / exe_name;
        if (std::filesystem::exists(path)) {
            return ipc_path(path);
        }
    }

#ifdef _WIN32
    std::string stem = name;
    if (stem.size() > 4 && stem.substr(stem.size() - 4) == ".exe") {
        stem = stem.substr(0, stem.size() - 4);
    }
    auto sidecar = base.parent_path() / "rust" / "src-tauri" / "bin" /
                   (stem + "-x86_64-pc-windows-msvc.exe");
    if (std::filesystem::exists(sidecar)) {
        return ipc_path(sidecar);
    }
#endif

#ifdef _WIN32
    wchar_t buf[32768] = {0};
    DWORD len = SearchPathW(nullptr, utf8_to_wide(exe_name).c_str(), nullptr, 32768, buf, nullptr);
    if (len > 0 && len < 32768) {
        return ipc_path(std::filesystem::path(buf));
    }
#else
    if (auto* path = getenv("PATH")) {
        std::string pathstr(path);
        size_t start = 0;
        while (start < pathstr.size()) {
            size_t end = pathstr.find(':', start);
            if (end == std::string::npos) end = pathstr.size();
            std::string dir = pathstr.substr(start, end - start);
            auto full = std::filesystem::path(dir) / name;
            if (std::filesystem::exists(full)) {
                return full.string();
            }
            start = end + 1;
        }
    }
#endif
    return name;
}

}
