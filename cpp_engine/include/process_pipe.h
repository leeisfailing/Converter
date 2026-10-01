#pragma once
#include <cstdio>
#include <string>

namespace engine {
inline FILE* open_process_pipe(const std::string& command) {
#ifdef _WIN32
    return _popen(command.c_str(), "r");
#else
    return popen(command.c_str(), "r");
#endif
}

inline int close_process_pipe(FILE* pipe) {
#ifdef _WIN32
    return _pclose(pipe);
#else
    return pclose(pipe);
#endif
}

inline std::string quote_process_arg(const std::string& arg) {
#ifdef _WIN32
    return "\"" + arg + "\"";
#else
    std::string quoted = "'";
    for (char ch : arg) quoted += ch == '\'' ? "'\\''" : std::string(1, ch);
    return quoted + "'";
#endif
}
}
