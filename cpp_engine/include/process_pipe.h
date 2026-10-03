#pragma once
#include <cstdio>
#include <stdexcept>
#include <string>
#ifndef _WIN32
#include <sys/wait.h>
#endif

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

// Probe output is consumed only after exit; read blocks instead of allocating
// and scanning a C string for every JSON line. A stream error is not EOF, so
// the partial output is dropped instead of being handed back as a truncated
// probe result.
inline bool read_process_output(FILE* pipe, std::string& output) {
    output.clear();
    output.reserve(4096);
    char buffer[4096];
    size_t count;
    while ((count = std::fread(buffer, 1, sizeof(buffer), pipe)) != 0)
        output.append(buffer, count);
    if (std::ferror(pipe)) {
        output.clear();
        return false;
    }
    return true;
}

// close_process_pipe() yields the raw wait status on POSIX and the plain exit
// code on Windows; describe either without leaking the encoding to the user.
inline std::string describe_process_status(int status) {
#ifdef _WIN32
    return "exit code " + std::to_string(status);
#else
    if (WIFEXITED(status)) return "exit code " + std::to_string(WEXITSTATUS(status));
    if (WIFSIGNALED(status)) return "signal " + std::to_string(WTERMSIG(status));
    return "abnormal termination";
#endif
}

// Flattens captured output into one short line so an error message stays readable.
inline std::string summarize_output(const std::string& output, size_t max_length = 200) {
    std::string text;
    text.reserve(max_length);
    bool pending_space = false;
    bool truncated = false;
    for (char ch : output) {
        if (ch == '\n' || ch == '\r' || ch == '\t') ch = ' ';
        if (ch == ' ') {
            if (!text.empty()) pending_space = true;
            continue;
        }
        if (text.size() + (pending_space ? 1u : 0u) + 1u + 3u > max_length) {
            truncated = true;
            break;
        }
        if (pending_space) {
            text += ' ';
            pending_space = false;
        }
        text += ch;
    }
    if (truncated) text += "...";
    return text;
}

// Runs a probe command to completion and returns its merged output. A command
// that cannot start, exits non-zero, or cannot be read throws a message the UI
// can show instead of the caller silently treating the output as valid.
inline std::string run_probe_command(const std::string& command) {
    FILE* pipe = open_process_pipe(command);
    if (!pipe) throw std::runtime_error("Probe command could not be started");
    std::string output;
    const bool read_ok = read_process_output(pipe, output);
    const int status = close_process_pipe(pipe);
    if (status != 0) {
        const std::string detail = summarize_output(output);
        throw std::runtime_error("Probe command failed with " + describe_process_status(status) +
                                 (detail.empty() ? std::string() : ": " + detail));
    }
    if (!read_ok) throw std::runtime_error("Probe command output could not be read");
    return output;
}

inline std::string quote_process_arg(const std::string& arg) {
#ifdef _WIN32
    return "\"" + arg + "\"";
#else
    std::string quoted;
    quoted.reserve(arg.size() + 2);
    quoted += '\'';
    for (char ch : arg) {
        if (ch == '\'') quoted += "'\\''";
        else quoted += ch;
    }
    return quoted + "'";
#endif
}
}
