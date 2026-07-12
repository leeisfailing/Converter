import vapoursynth as vs
import json
import math

core = vs.core


def change_fps(clip, target_fps):
    if clip.fps == target_fps:
        return clip
    if target_fps <= 0 or clip.fps <= 0:
        return clip

    factor = clip.fps / target_fps

    def(n):
        new_n = math.floor(n / factor)
        new_n = max(0, min(new_n, clip.num_frames - 1))
        return clip[new_n]

    return core.std.FrameEval(clip, func)


def interpolate_svp(clip, target_fps, preset="weak", algorithm="13",
                    blocksize="8", mask_area=0):
    try:
        import svp1
        import svp2
    except ImportError:
        return change_fps(clip, target_fps)

    if clip.format.color_family != vs.YUV:
        clip = core.resize.Point(clip, format=vs.YUV420P8, matrix_s="709")

    super_preset = {
        "weak": {"pel": 2, "sharp": 0, "downscale": 0, "enhance": 0},
        "film": {"pel": 2, "sharp": 1, "downscale": 0, "enhance": 0},
        "smooth": {"pel": 2, "sharp": 0, "downscale": 0, "enhance": 1},
        "default": {"pel": 2, "sharp": 1, "downscale": 0, "enhance": 1},
        "test": {"pel": 1, "sharp": 0, "downscale": 0, "enhance": 0},
    }

    sp = super_preset.get(preset, super_preset["weak"])

    super_args = {
        "pel": sp["pel"],
        "sharp": sp["sharp"],
        "downscale": sp["downscale"],
        "enhance": sp["enhance"],
    }
    super_str = json.dumps(super_args)

    vectors_args = {
        "blksize": int(blocksize) if blocksize in ["4", "8", "16", "32"] else 8,
        "overlap": 0,
        "delta": 0,
        "badpels": 128,
    }
    vectors_str = json.dumps(vectors_args)

    smooth_args = {
        "algo": int(algorithm) if algorithm in ["1", "2", "11", "13", "21", "23"] else 13,
        "rate": float(target_fps),
        "ml": 0,
    }
    if mask_area > 0:
        smooth_args["mask"] = {"area": mask_area}
    smooth_str = json.dumps(smooth_args)

    clip_8 = core.resize.Point(clip, format=vs.YUV420P8)
    super_clip = svp1.Super(clip_8, super_str)
    vectors = svp1.Analyse(super_clip, clip_8, vectors_str)
    interpolated = svp2.SmoothFps(clip_8, super_clip, vectors, smooth_str,
                                  clip_frame_rate=clip.fps, value_check=False)
    return interpolated


def interpolate_rife(clip, target_fps, model_path="", gpu_index=-1):
    try:
        import rife
    except ImportError:
        return change_fps(clip, target_fps)

    if clip.format.color_family != vs.RGB:
        clip = core.resize.Point(clip, format=vs.RGBS, matrix_in_s="709")

    try:
        interpolated = rife.RIFE(clip, fps_num=int(target_fps.numerator) if hasattr(target_fps, 'numerator') else int(target_fps),
                                  fps_den=int(target_fps.denominator) if hasattr(target_fps, 'denominator') else 1,
                                  model_path=model_path, gpu_id=gpu_index)
        return interpolated
    except Exception:
        return change_fps(clip, target_fps)
