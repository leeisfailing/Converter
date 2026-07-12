import vapoursynth as vs

core = vs.core


def average(clip, weights, offset=0):
    if len(weights) == 0:
        return clip

    num_frames = len(weights)
    if num_frames == 1:
        return clip

    clips = []
    for i in range(num_frames):
        frame_idx = i + offset
        if frame_idx < 0:
            frame_idx = 0
        elif frame_idx >= clip.num_frames:
            frame_idx = clip.num_frames - 1
        clips.append(clip[frame_idx])

    expr_parts = []
    for i, w in enumerate(weights):
        expr_parts.append(f"x{i} {w} *")

    expr = " ".join(expr_parts)
    for _ in range(len(expr_parts) - 1):
        expr += " +"
    expr += " {} /".format(sum(weights))

    return core.akarin.Expr(clips, expr)


def average_bright(clip, weights, gamma=1.0, offset=0):
    if gamma == 1.0:
        return average(clip, weights, offset)

    def process(c):
        darkened = core.akarin.Expr([c], f"x 1 {gamma} pow *")
        blended = average(darkened, weights, offset)
        restored = core.akarin.Expr([blended], f"x 1 {1.0/gamma} pow *")
        return restored

    if clip.format.color_family == vs.YUV:
        return core.resize.Point(
            process(core.resize.Point(clip, format=vs.RGBS, matrix_in_s="709")),
            format=clip.format.id,
            matrix_s="709"
        )
    else:
        return process(clip)
