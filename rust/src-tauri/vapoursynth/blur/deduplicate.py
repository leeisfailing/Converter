import vapoursynth as vs
import json

core = vs.core


def fill_drops_rife(clip, threshold=0.001, max_range=2):
    try:
        import rife
    except ImportError:
        return clip

    if clip.format.color_family != vs.RGB:
        clip = core.resize.Point(clip, format=vs.RGBS, matrix_in_s="709")

    clip_8 = core.resize.Point(clip, format=vs.YUV420P8, matrix_in_s="709")
    super_clip = core.std.MakeDiff(clip_8[0], clip_8[0])

    stats = core.std.PlaneStats(clip_8, shift=clip_8, plane=0)

    def get_interp(n, f):
        diff = f.props.get("PlaneStatsDiff", 0)
        if diff < threshold:
            prev = max(0, n - 1)
            nxt = min(clip.num_frames - 1, n + 1)
            if prev != nxt:
                try:
                    interp = rife.RIFE(
                        core.std.Interleave([clip[prev], clip[nxt]]),
                        fps_num=clip.fps.numerator * 2,
                        fps_den=clip.fps.denominator,
                    )
                    return interp[0]
                except Exception:
                    return clip[n]
        return clip[n]

    return core.std.FrameEval(clip, get_interp, prop_src=[stats])


def fill_drops_multiple(clip, threshold=0.001, max_range=2, preset="weak",
                        algorithm="13", blocksize="8"):
    from .interpolate import interpolate_svp

    clip_8 = core.resize.Point(clip, format=vs.YUV420P8)
    stats = core.std.PlaneStats(clip_8, shift=clip_8, plane=0)

    def get_interp(n, f):
        diff = f.props.get("PlaneStatsDiff", 0)
        if diff < threshold:
            prev = max(0, n - 1)
            nxt = min(clip.num_frames - 1, n + 1)
            if prev != nxt:
                try:
                    segment = clip.std.Interleave([clip[prev], clip[nxt]])
                    interp = interpolate_svp(segment, clip.fps * 2, preset, algorithm, blocksize)
                    return interp[0]
                except Exception:
                    return clip[n]
        return clip[n]

    return core.std.FrameEval(clip, get_interp, prop_src=[stats])
