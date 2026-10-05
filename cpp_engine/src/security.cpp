#include "security.h"
#include "native_paths.h"
#include <filesystem>
#include <regex>
#include <algorithm>
#include <limits>

namespace engine {

static const size_t MAX_PATH_LENGTH = 2048;
static const size_t MAX_STRING_LENGTH = 4096;
static const long long MAX_FILE_SIZE = 10LL * 1024 * 1024 * 1024;
static const std::regex DANGEROUS_COMMAND_CHARS(R"([;&|`$\\])");
// `;`, `&`, `|`, backtick and `$` are shell metacharacters on every platform,
// so they are rejected in paths everywhere. `%` and `^` are ordinary, legal
// filename characters on POSIX (`100%_final.mp4`), but Windows probes run
// through cmd.exe where `%VAR%` expands even inside quotes and an unquoted `^`
// escapes the next character -- so those two are rejected on Windows only.
#ifdef _WIN32
static const std::regex DANGEROUS_PATH_CHARS(R"([;&|`$%^])");
#else
static const std::regex DANGEROUS_PATH_CHARS(R"([;&|`$])");
#endif

void validate_no_null_bytes(const std::string& value, const std::string& field_name) {
    if (value.find('\0') != std::string::npos) {
        throw ValidationError("Null bytes not allowed in " + field_name);
    }
}

std::string validate_path(const std::string& path_str, const std::string& field_name) {
    validate_no_null_bytes(path_str, field_name);
    if (path_str.size() > MAX_PATH_LENGTH) {
        throw ValidationError(field_name + " exceeds maximum length of " + std::to_string(MAX_PATH_LENGTH));
    }
    if (path_str.empty() || path_str.find_first_not_of(" \t\r\n") == std::string::npos) {
        throw ValidationError(field_name + " cannot be empty");
    }
    if (path_str.find("..") != std::string::npos) {
        throw ValidationError(field_name + " contains invalid path traversal");
    }
    if (std::regex_search(path_str, DANGEROUS_PATH_CHARS)) {
        throw ValidationError(field_name + " contains dangerous characters");
    }
    std::error_code ec;
    auto resolved = std::filesystem::weakly_canonical(native_path(path_str), ec);
    if (ec) {
        throw ValidationError(field_name + " contains invalid path after canonicalization");
    }
    auto resolved_str = ipc_path(resolved);
    if (resolved_str.find("..") != std::string::npos) {
        throw ValidationError(field_name + " contains invalid path traversal after canonicalization");
    }
    return resolved_str;
}

std::string validate_file_exists(const std::string& path_str, const std::string& field_name) {
    auto validated = validate_path(path_str, field_name);
    if (!std::filesystem::is_regular_file(native_path(validated))) {
        throw ValidationError("File not found: " + validated);
    }
    std::error_code ec;
    auto size = std::filesystem::file_size(native_path(validated), ec);
    if (!ec && size > MAX_FILE_SIZE) {
        throw ValidationError("File exceeds maximum allowed size (10GB)");
    }
    return validated;
}

std::string validate_output_path(const std::string& path_str, const std::string& field_name) {
    auto validated = validate_path(path_str, field_name);
    auto parent = native_path(validated).parent_path();
    if (!std::filesystem::exists(parent)) {
        throw ValidationError("Output directory does not exist: " + ipc_path(parent));
    }
    auto filename = ipc_path(native_path(validated).filename());
    if (filename.empty() || filename == "." || filename == "..") {
        throw ValidationError("Invalid filename in " + field_name);
    }
    return validated;
}

std::string validate_output_dir(const std::string& dir_str) {
    validate_no_null_bytes(dir_str, "output_dir");
    if (dir_str.size() > MAX_PATH_LENGTH) {
        throw ValidationError("output_dir exceeds maximum length of " + std::to_string(MAX_PATH_LENGTH));
    }
    if (std::regex_search(dir_str, DANGEROUS_PATH_CHARS)) {
        throw ValidationError("output_dir contains dangerous characters");
    }
    std::error_code ec;
    auto resolved = std::filesystem::weakly_canonical(native_path(dir_str), ec);
    if (!std::filesystem::is_directory(resolved)) {
        throw ValidationError("Output directory does not exist: " + ipc_path(resolved));
    }
    return ipc_path(resolved);
}

std::string validate_string(const std::string& value, const std::string& field_name, size_t max_length) {
    validate_no_null_bytes(value, field_name);
    if (value.size() > max_length) {
        throw ValidationError(field_name + " exceeds maximum length of " + std::to_string(max_length));
    }
    if (std::regex_search(value, DANGEROUS_COMMAND_CHARS)) {
        throw ValidationError(field_name + " contains dangerous characters");
    }
    return value;
}

}
