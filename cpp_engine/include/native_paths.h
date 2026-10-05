#pragma once
#include <filesystem>
#include <string>
#include <stdexcept>
#include <limits>
#ifdef _WIN32
#include <windows.h>
#endif

namespace engine {
// JSON IPC paths are UTF-8; Windows filesystem APIs use UTF-16. POSIX paths
// remain byte strings, including filenames that are not valid UTF-8.
#ifdef _WIN32
inline std::wstring utf8_to_wide(const std::string& text) {
    if (text.empty()) return {};
    if (text.size() > static_cast<size_t>((std::numeric_limits<int>::max)()))
        throw std::runtime_error("UTF-8 argument is too long");
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                        text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (!size) throw std::runtime_error("Invalid UTF-8 argument");
    std::wstring result(size, L'\0');
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                            static_cast<int>(text.size()), result.data(), size))
        throw std::runtime_error("Cannot convert UTF-8 argument");
    return result;
}
#endif

inline std::filesystem::path native_path(const std::string& text) {
#ifdef _WIN32
    return std::filesystem::path(utf8_to_wide(text));
#else
    return std::filesystem::path(text);
#endif
}

inline std::string ipc_path(const std::filesystem::path& path) {
#ifdef _WIN32
    return path.u8string();
#else
    return path.string();
#endif
}

#ifdef _WIN32
// Escape one argument according to Windows CRT argv parsing rules. Always
// quote, including empty strings, and double backslashes before quotes/end.
inline std::wstring quote_windows_arg(const std::wstring& argument) {
    std::wstring quoted = L"\"";
    size_t backslashes = 0;
    for (wchar_t character : argument) {
        if (character == L'\\') {
            ++backslashes;
            continue;
        }
        quoted.append(backslashes * (character == L'\"' ? 2 : 1), L'\\');
        backslashes = 0;
        if (character == L'\"') quoted += L'\\';
        quoted += character;
    }
    quoted.append(backslashes * 2, L'\\');
    return quoted + L'\"';
}
#endif
}
