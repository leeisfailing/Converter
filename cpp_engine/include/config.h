#pragma once
#include <string>
#include <filesystem>

namespace engine {

std::filesystem::path resource_path(const std::string& relative = "");
std::string find_binary(const std::string& name);

}
