#pragma once

namespace engine {

class ReducerWorker;

void reduce_to_target(ReducerWorker* worker);

// Bitrates come from an IPC target (up to 10 GB) over a duration as low as a
// couple of seconds, so the double can far exceed INT_MAX, and an out-of-range
// float→int conversion is undefined behaviour. The upper bound also keeps the
// downstream maxrate/bufsize arithmetic (rate * 1.5, rate * 2) inside int.
inline int bitrate_to_int(double bits_per_second) {
    const double max_bitrate = 1000000000.0;
    if (!(bits_per_second > 0.0)) return 0;             // negative and NaN
    if (bits_per_second > max_bitrate) return static_cast<int>(max_bitrate);
    return static_cast<int>(bits_per_second);
}

}
