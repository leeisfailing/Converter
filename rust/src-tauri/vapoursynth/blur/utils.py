import vapoursynth as vs
import json
import sys
import os
import math
from fractions import Fraction

core = vs.core


def load_plugins():
    ext = ".dll" if sys.platform == "win32" else ".dylib" if sys.platform == "darwin" else ".so"
    script_dir = os.path.dirname(os.path.abspath(__file__))
    plugin_dir = os.path.join(script_dir, "..", "vapoursynth-plugins")

    if os.path.exists(plugin_dir):
        for f in sorted(os.listdir(plugin_dir)):
            if f.endswith(ext):
                try:
                    core.std.LoadPlugin(os.path.join(plugin_dir, f))
                except Exception:
                    pass

    if sys.platform == "win32":
        try:
            core.std.LoadPlugin(r"C:\Program Files\VapourSynth\plugins\libbestsource" + ext)
        except Exception:
            pass


def safe_int(val, default=None):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def coalesce(val, fallback):
    return fallback if val is None else val


def assume_scaled_fps(clip, timescale):
    if timescale == 1.0:
        return clip
    num = clip.fps.numerator
    den = clip.fps.denominator
    scaled = Fraction(num * timescale, den).limit_denominator(100000)
    return core.std.AssumeFPS(clip, fpsnum=int(scaled.numerator), fpsden=int(scaled.denominator))


def with_format(clip, target_format, process_func):
    converted = core.resize.Point(clip, format=target_format, matrix_in_s="709")
    processed = process_func(converted)
    return core.resize.Point(processed, format=clip.format.id, matrix_s="709")
