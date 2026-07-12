import vapoursynth as vs
import math
import json

core = vs.core


def normalize(weights):
    adjusted = list(weights)
    min_val = min(adjusted) if adjusted else 0
    if min_val < 0.0:
        shift = -min_val + 1.0
        adjusted = [w + shift for w in adjusted]

    total = sum(adjusted)
    if total > 0:
        adjusted = [w / total for w in adjusted]

    return adjusted


def scale_range(n, start, end):
    if n <= 1:
        return [start] * n
    step = (end - start) / (n - 1)
    return [start + i * step for i in range(n)]


def equal(frames):
    val = 1.0 / frames
    return [val] * frames


def ascending(frames):
    raw = [float(i + 1) for i in range(frames)]
    return normalize(raw)


def descending(frames):
    raw = [float(frames - i) for i in range(frames)]
    return normalize(raw)


def pyramid(frames):
    half = (frames - 1) / 2.0
    weights = [half - abs(i - half) + 1 for i in range(frames)]
    return normalize(weights)


def gaussian(frames, mean=2.0, stddev=1.0, bound=(0.0, 2.0)):
    if bound[0] == bound[1]:
        raise ValueError("Gaussian bound must have two distinct values")

    x_vals = scale_range(frames, bound[0], bound[1])
    denom = 2 * stddev * stddev
    weights = [math.exp(-((x - mean) ** 2) / denom) for x in x_vals]
    return normalize(weights)


def gaussian_reverse(frames, mean=2.0, stddev=1.0, bound=(0.0, 2.0)):
    weights = gaussian(frames, mean, stddev, bound)
    weights.reverse()
    return weights


def gaussian_sym(frames, stddev=1.0, bound=(0.0, 2.0)):
    max_abs = max(abs(bound[0]), abs(bound[1]))
    return gaussian(frames, 0.0, stddev, (-max_abs, max_abs))


def vegas(frames):
    if frames % 2 == 0:
        weights = [1.0]
        for _ in range(1, frames - 1):
            weights.append(2.0)
        weights.append(1.0)
    else:
        weights = [1.0] * frames
    return normalize(weights)


def divide(frames, weights):
    if not weights:
        return [0.0] * frames
    indices = scale_range(frames, 0, len(weights) - 0.1)
    stretched = [weights[int(idx)] for idx in indices]
    return normalize(stretched)


def parse_gaussian_bound(json_str):
    try:
        arr = json.loads(json_str)
        if isinstance(arr, list) and len(arr) == 2:
            return (float(arr[0]), float(arr[1]))
    except (json.JSONDecodeError, ValueError):
        pass
    return None


def get_weights(blur_weighting, blur_amount, video_fps, output_fps,
                gaussian_std_dev=1.0, gaussian_mean=2.0,
                gaussian_bound_str="[0,2]"):
    if blur_amount <= 0 or video_fps <= 0 or output_fps <= 0:
        return []

    frame_gap = max(1, round(video_fps / output_fps))
    blended_frames = max(1, round(frame_gap * blur_amount))

    if blended_frames <= 0:
        return []

    bound = parse_gaussian_bound(gaussian_bound_str)
    if bound is None:
        bound = (0.0, 2.0)

    if blur_weighting == "equal":
        return equal(blended_frames)
    elif blur_weighting == "ascending":
        return ascending(blended_frames)
    elif blur_weighting == "descending":
        return descending(blended_frames)
    elif blur_weighting == "pyramid":
        return pyramid(blended_frames)
    elif blur_weighting == "gaussian":
        return gaussian(blended_frames, gaussian_mean, gaussian_std_dev, bound)
    elif blur_weighting == "gaussian_reverse":
        return gaussian_reverse(blended_frames, gaussian_mean, gaussian_std_dev, bound)
    elif blur_weighting == "gaussian_sym":
        return gaussian_sym(blended_frames, gaussian_std_dev, bound)
    elif blur_weighting == "vegas":
        return vegas(blended_frames)
    else:
        try:
            custom = [float(x.strip()) for x in blur_weighting.split(",")]
            return divide(blended_frames, custom)
        except ValueError:
            return equal(blended_frames)
