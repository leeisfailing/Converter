import vapoursynth as vs
import json
import sys
import os
import math
from fractions import Fraction

# Add the script's parent directory to sys.path so local packages (blur) can be found
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

core = vs.core

from blur.utils import load_plugins, assume_scaled_fps
from blur.blending import average, average_bright
from blur.interpolate import interpolate_svp, interpolate_rife, change_fps
from blur.deduplicate import fill_drops_rife, fill_drops_multiple
from blur.weighting import get_weights

# Read settings from vspipe -a arguments (passed as global variables)
try:
    settings_json = json.loads(settings)
except (NameError, json.JSONDecodeError):
    settings_json = {}

try:
    video_path
except NameError:
    video_path = ""

try:
    fps_num = int(fps_num)
except (NameError, ValueError):
    fps_num = 0

try:
    fps_den = int(fps_den)
except (NameError, ValueError):
    fps_den = 1

try:
    color_range
except NameError:
    color_range = "undefined"

try:
    enable_lsmash = str(enable_lsmash).lower() == "true"
except NameError:
    enable_lsmash = False


def load_video_source(path):
    if enable_lsmash:
        try:
            return core.lsmas.LWLibavSource(path)
        except Exception:
            pass

    try:
        return core.bs.VideoSource(path)
    except Exception:
        pass

    raise Exception(f"Could not load video source: {path}")


def main():
    load_plugins()

    if not video_path:
        raise Exception("No video path provided")

    # Load settings
    blur_enabled = settings_json.get("blur", True)
    blur_amount = settings_json.get("blur_amount", 1.0)
    blur_output_fps = settings_json.get("blur_output_fps", 60)
    blur_weighting = settings_json.get("blur_weighting", "equal")
    blur_gamma = settings_json.get("blur_gamma", 1.0)

    interpolate_enabled = settings_json.get("interpolate", True)
    interpolated_fps_str = settings_json.get("interpolated_fps", "1200")
    interpolation_method = settings_json.get("interpolation_method", "svp")

    pre_interpolate = settings_json.get("pre_interpolate", False)
    pre_interpolated_fps_str = settings_json.get("pre_interpolated_fps", "360")

    deduplicate_enabled = settings_json.get("deduplicate", True)
    deduplicate_method = settings_json.get("deduplicate_method", "svp")

    timescale_enabled = settings_json.get("timescale", False)
    input_timescale = settings_json.get("input_timescale", 1.0)
    output_timescale = settings_json.get("output_timescale", 1.0)

    filters_enabled = settings_json.get("filters", False)
    brightness = settings_json.get("brightness", 1.0)
    saturation = settings_json.get("saturation", 1.0)
    contrast = settings_json.get("contrast", 1.0)

    gpu_interpolation = settings_json.get("gpu_interpolation", True)

    gaussian_std_dev = settings_json.get("blur_weighting_gaussian_std_dev", 1.0)
    gaussian_mean = settings_json.get("blur_weighting_gaussian_mean", 2.0)
    gaussian_bound = settings_json.get("blur_weighting_gaussian_bound", "[0,2]")

    deduplicate_threshold = float(settings_json.get("deduplicate_threshold", "0.001"))
    deduplicate_range = settings_json.get("deduplicate_range", 2)

    rife_model = settings_json.get("rife_model", "rife-v4.26_ensembleFalse")
    svp_preset = settings_json.get("svp_interpolation_preset", "weak")
    svp_algorithm = settings_json.get("svp_interpolation_algorithm", "13")
    blocksize = settings_json.get("interpolation_blocksize", "8")
    mask_area = settings_json.get("interpolation_mask_area", 0)

    # Determine RIFE model path - check models directory relative to script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, "..", "models")
    rife_model_path = os.path.join(models_dir, rife_model) if os.path.isdir(models_dir) else ""

    # Parse interpolated FPS (supports "5x" multiplier or absolute value)
    def parse_fps(s, source_fps):
        s = str(s).strip()
        if s.endswith("x"):
            try:
                multiplier = float(s[:-1])
                return source_fps * multiplier
            except ValueError:
                return source_fps
        try:
            return float(s)
        except ValueError:
            return source_fps

    # Load video
    clip = load_video_source(video_path)

    if fps_num > 0 and fps_den > 0:
        clip = core.std.AssumeFPS(clip, fpsnum=fps_num, fpsden=fps_den)

    source_fps = clip.fps if clip.fps > 0 else 24.0

    # Input timescale
    if timescale_enabled and input_timescale != 1.0:
        clip = assume_scaled_fps(clip, 1.0 / input_timescale)

    # Deduplication
    if deduplicate_enabled:
        if deduplicate_method == "rife":
            try:
                clip = fill_drops_rife(clip, deduplicate_threshold, deduplicate_range)
            except Exception:
                pass
        elif deduplicate_method == "svp":
            try:
                clip = fill_drops_multiple(clip, deduplicate_threshold, deduplicate_range,
                                           svp_preset, svp_algorithm, blocksize)
            except Exception:
                pass

    # Pre-interpolation
    if pre_interpolate and interpolate_enabled:
        pre_fps = parse_fps(pre_interpolated_fps_str, clip.fps)
        if pre_fps > clip.fps:
            try:
                if interpolation_method == "rife":
                    if rife_model_path and os.path.exists(rife_model_path):
                        clip = interpolate_rife(clip, pre_fps, rife_model_path, -1)
                    else:
                        clip = interpolate_svp(clip, pre_fps, svp_preset, svp_algorithm, blocksize, mask_area)
                else:
                    clip = interpolate_svp(clip, pre_fps, svp_preset, svp_algorithm, blocksize, mask_area)
            except Exception:
                pass

    # Main interpolation
    if interpolate_enabled:
        target_fps = parse_fps(interpolated_fps_str, clip.fps)
        if target_fps > clip.fps:
            try:
                if interpolation_method == "rife":
                    if rife_model_path and os.path.exists(rife_model_path):
                        clip = interpolate_rife(clip, target_fps, rife_model_path, -1)
                    else:
                        clip = interpolate_svp(clip, target_fps, svp_preset, svp_algorithm, blocksize, mask_area)
                else:
                    clip = interpolate_svp(clip, target_fps, svp_preset, svp_algorithm, blocksize, mask_area)
            except Exception:
                pass

    # Output timescale
    if timescale_enabled and output_timescale != 1.0:
        clip = assume_scaled_fps(clip, output_timescale)

    # Motion blur
    if blur_enabled and blur_amount > 0 and blur_output_fps > 0:
        current_fps = clip.fps if clip.fps > 0 else source_fps
        frame_gap = max(1, round(current_fps / blur_output_fps))
        blended_frames = max(1, round(frame_gap * blur_amount))

        if blended_frames > 1:
            weights = get_weights(
                blur_weighting, blur_amount, current_fps, blur_output_fps,
                gaussian_std_dev, gaussian_mean, gaussian_bound
            )

            if weights:
                if blur_gamma != 1.0:
                    clip = average_bright(clip, weights, blur_gamma)
                else:
                    clip = average(clip, weights)

        # Change to output FPS
        clip = change_fps(clip, Fraction(blur_output_fps))

    # Video filters
    if filters_enabled:
        needs_conversion = clip.format.color_family != vs.YUV

        def apply_filters(c):
            if brightness != 1.0 or saturation != 1.0 or contrast != 1.0:
                c = core.resize.Point(c, format=vs.YUV444P16, matrix_s="709")
                c = core.adjust.Tweak(c, brightness=brightness, saturation=saturation, contrast=contrast)
                c = core.resize.Point(c, format=clip.format.id, matrix_s="709")
            return c

        if needs_conversion:
            yuv = core.resize.Point(clip, format=vs.YUV444P16, matrix_in_s="709")
            yuv = apply_filters(yuv)
            clip = core.resize.Point(yuv, format=clip.format.id, matrix_s="709")
        else:
            clip = apply_filters(clip)

    return clip


output = main()
output.set_output()
