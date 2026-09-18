"""Structured media metadata and matching decode/scale plans."""
import json
import subprocess
import sys

from PyEngine.core.config import find_binary


def probe_media(path: str) -> dict:
    """Probe once per job; do not cache metadata for files that can change."""
    try:
        result = subprocess.run(
            [find_binary("ffprobe"), "-v", "error", "-show_entries",
             "stream=index,codec_type,codec_name,width,height,pix_fmt:stream_disposition=attached_pic:format=duration",
             "-of", "json", path], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        if result.returncode:
            return {}
        data = json.loads(result.stdout)
        streams = data.get("streams", [])
        video = next((s for s in streams if s.get("codec_type") == "video"
                      and not s.get("disposition", {}).get("attached_pic")), {})
        audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
        return {"vcodec": video.get("codec_name"), "acodec": audio.get("codec_name"),
                "width": video.get("width"), "height": video.get("height"),
                "pix_fmt": video.get("pix_fmt"), "duration": data.get("format", {}).get("duration")}
    except (OSError, ValueError, TypeError, subprocess.TimeoutExpired):
        return {}


def uses_cuda_frames(encoder: str, metadata: dict) -> bool:
    # Hardware encoding also accepts software frames. Only retain CUDA frames
    # when the source is a supported YUV video, never for RGB images/codecs.
    return bool(encoder and encoder.endswith("_nvenc")
                and metadata.get("vcodec") in {"h264", "hevc", "av1", "vp9", "vp8", "mpeg2video", "vc1"}
                and metadata.get("pix_fmt") in {"yuv420p", "yuvj420p", "yuv420p10le", "nv12", "p010le"})


def decode_args(cuda: bool) -> list:
    return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] if cuda else []


def scale_filter(width: int, height: int = -2, *, cuda: bool = False, limit: bool = False) -> str:
    """Keep width limits and frame memory consistent across all workers."""
    width = max(2, width // 2 * 2) if height == -2 else width
    w = f"'min(iw,{width})'" if limit else str(width)
    name, interpolation = ("scale_cuda", "interp_algo=lanczos") if cuda else ("scale", "flags=lanczos")
    return f"{name}=w={w}:h={height}:{interpolation}"

