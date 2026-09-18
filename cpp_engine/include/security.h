#pragma once
#include <string>
#include <stdexcept>

namespace engine {

class ValidationError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void validate_no_null_bytes(const std::string& value, const std::string& field_name = "input");
std::string validate_path(const std::string& path_str, const std::string& field_name = "path");
std::string validate_file_exists(const std::string& path_str, const std::string& field_name = "path");
std::string validate_output_path(const std::string& path_str, const std::string& field_name = "path");
std::string validate_output_dir(const std::string& dir_str);
std::string validate_string(const std::string& value, const std::string& field_name, size_t max_length = 4096);

}
