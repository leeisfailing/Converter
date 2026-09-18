#include "config.h"
#include <cstdlib>
#include <vector>

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
    char buf[MAX_PATH] = {0};
    GetModuleFileNameA(nullptr, buf, MAX_PATH);
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
    return base / relative;
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

    for (auto& dir : search_dirs) {
        auto path = dir / exe_name;
        if (std::filesystem::exists(path)) {
            return path.string();
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
        return sidecar.string();
    }
#endif

    char buf[4096] = {0};
#ifdef _WIN32
    DWORD len = SearchPathA(nullptr, exe_name.c_str(), nullptr, sizeof(buf), buf, nullptr);
    if (len > 0 && len < sizeof(buf)) {
        return std::string(buf);
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
