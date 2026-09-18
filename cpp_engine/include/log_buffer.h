#pragma once
#include <algorithm>
#include <string>
#include <string_view>

namespace engine {
// Reuse one bounded record buffer, including when FFmpeg emits CR-only stats.
class LogBuffer {
public:
    static constexpr size_t max_record = 4096;
    LogBuffer() { pending_.reserve(max_record); }

    template<class Consumer>
    void feed(std::string_view chunk, Consumer&& consume) {
        while (!chunk.empty()) {
            const auto delimiter = chunk.find_first_of("\r\n");
            const auto count = std::min(delimiter, chunk.size());
            auto record = chunk.substr(0, count);
            while (!record.empty()) {
                const auto take = std::min(max_record - pending_.size(), record.size());
                pending_.append(record.data(), take);
                record.remove_prefix(take);
                if (pending_.size() == max_record) flush(consume);
            }
            chunk.remove_prefix(count);
            if (delimiter != std::string_view::npos) {
                flush(consume);
                chunk.remove_prefix(1);
            }
        }
    }

    template<class Consumer>
    void flush(Consumer&& consume) {
        if (!pending_.empty()) {
            consume(pending_);
            pending_.clear();
        }
    }
private:
    std::string pending_;
};
}
