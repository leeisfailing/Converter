"""GPU hardware encoder detection via ffmpeg."""
import subprocess
import sys
from functools import lru_cache
from typing import Optional

from PyEngine.core.config import find_binary

# All known hardware encoders with their vendor and hwaccel method.
_ALL_HARDWARE_ENCODERS = [
    ("h264_nvenc", "NVIDIA", "cuda", "NVIDIA NVENC H.264"),
    ("hevc_nvenc", "NVIDIA", "cuda", "NVIDIA NVENC HEVC"),
    ("av1_nvenc", "NVIDIA", "cuda", "NVIDIA NVENC AV1"),
    ("h264_amf", "AMD", "amf", "AMD AMF H.264"),
    ("hevc_amf", "AMD", "amf", "AMD AMF HEVC"),
    ("av1_amf", "AMD", "amf", "AMD AMF AV1"),
    ("h264_qsv", "Intel", "qsv", "Intel Quick Sync H.264"),
    ("hevc_qsv", "Intel", "qsv", "Intel Quick Sync HEVC"),
    ("av1_qsv", "Intel", "qsv", "Intel Quick Sync AV1"),
]

# Recommended priority: NVIDIA > AMD > Intel, H.264 first.
_RECOMMENDED_PRIORITY = [
    ("h264_nvenc", "NVIDIA", "cuda"),
    ("h264_amf", "AMD", "amf"),
    ("h264_qsv", "Intel", "qsv"),
]

_CPU_ENCODERS = [
    ("libx264", "CPU", None, "Software H.264 (libx264)"),
]


def _get_system_gpu_names() -> list:
    """Return a list of GPU names on this system."""
    gpus = []
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                [
                    "powershell", "-NoProfile", "-Command",
                    "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
                ],
                capture_output=True, text=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            for line in result.stdout.strip().splitlines():
                name = line.strip()
                if name:
                    gpus.append(name)
        elif sys.platform == "linux":
            result = subprocess.run(["lspci"], capture_output=True, text=True, timeout=5)
            for line in result.stdout.splitlines():
                lower = line.lower()
                if "vga" in lower or "3d" in lower or "display" in lower:
                    parts = line.split(": ", 1)
                    if len(parts) > 1:
                        gpus.append(parts[1].strip())
        elif sys.platform == "darwin":
            result = subprocess.run(
                ["system_profiler", "SPDisplaysDataType"],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.splitlines():
                if "Chipset Model" in line or "Chip Model" in line:
                    parts = line.split(": ", 1)
                    if len(parts) > 1:
                        gpus.append(parts[1].strip())
    except Exception:
        pass
    return gpus


def _probe_ffmpeg_encoders() -> set:
    """Return the set of encoder names supported by the bundled ffmpeg."""
    ffmpeg = find_binary("ffmpeg")
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        encoders = set()
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                encoders.add(parts[1])
        return encoders
    except Exception:
        return set()


@lru_cache(maxsize=16)
def _encoder_works(encoder: str) -> bool:
    """Test if an encoder actually works by encoding a single test frame."""
    try:
        result = subprocess.run(
            [find_binary("ffmpeg"), "-v", "error", "-nostdin", "-f", "lavfi",
             "-i", "color=c=black:s=256x256:r=1:d=0.1",
             "-frames:v", "1",
             "-c:v", encoder, "-pix_fmt", "yuv420p",
             "-f", "null", "-"],
            capture_output=True, timeout=8,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        print(f"[gpu] Testing encoder: {encoder} -> {'WORKS' if result.returncode == 0 else 'FAILED'}", file=sys.stderr, flush=True)
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        print(f"[gpu] Testing encoder: {encoder} -> FAILED (exception)", file=sys.stderr, flush=True)
        return False


@lru_cache(maxsize=None)
def detect_gpu() -> dict:
    """Detect the best GPU and all available encoders.

    Returns a dict with:
        available: bool - whether a hardware encoder was found
        encoder: str|null - best ffmpeg encoder name
        vendor: str|null - best GPU vendor
        hwaccel: str|null - best hwaccel method
        name: str|null - human-readable best GPU name
        message: str - status message
        all_encoders: list - all working encoders [{"id", "vendor", "label"}]
    """
    print(f"[gpu] Running GPU detection...", file=sys.stderr, flush=True)
    compiled = _probe_ffmpeg_encoders()
    gpus = _get_system_gpu_names()

    # Find all working hardware encoders
    available = []
    for enc_id, vendor, hwaccel, label in _ALL_HARDWARE_ENCODERS:
        if enc_id in compiled and _encoder_works(enc_id):
            # Match encoder to a GPU name if possible
            gpu_name = next((g for g in gpus if vendor.lower() in g.lower()), None)
            available.append({
                "id": enc_id,
                "vendor": vendor,
                "hwaccel": hwaccel,
                "label": f"{label}" + (f" ({gpu_name})" if gpu_name else ""),
            })

    # Find the recommended (best) encoder
    best_encoder = None
    for enc_id, vendor, hwaccel in _RECOMMENDED_PRIORITY:
        if any(e["id"] == enc_id for e in available):
            best_encoder = (enc_id, vendor, hwaccel)
            break

    # Build the full encoder list: recommended first, then others, then CPU
    all_encoders = []
    if best_encoder:
        be_id, be_vendor, be_hwaccel = best_encoder
        be_info = next((e for e in available if e["id"] == be_id), None)
        be_label = be_info["label"] if be_info else be_id
        all_encoders.append({"id": be_id, "vendor": be_vendor, "label": f"{be_label} (Recommended)"})

    for e in available:
        if e["id"] != (best_encoder[0] if best_encoder else None):
            all_encoders.append({"id": e["id"], "vendor": e["vendor"], "label": e["label"]})

    all_encoders.append({"id": "libx264", "vendor": "CPU", "label": "Software H.264 (CPU fallback)"})

    # Pick best GPU name
    gpu_name = gpus[0] if gpus else None

    print(f"[gpu] Best encoder: {best_encoder}", file=sys.stderr, flush=True)
    print(f"[gpu] All working encoders: {[e['id'] for e in all_encoders]}", file=sys.stderr, flush=True)

    if best_encoder:
        be_id, be_vendor, be_hwaccel = best_encoder
        display_name = next((g for g in gpus if be_vendor.lower() in g.lower()), None) or f"{be_vendor} GPU"
        return {
            "available": True,
            "encoder": be_id,
            "vendor": be_vendor,
            "hwaccel": be_hwaccel,
            "name": display_name,
            "message": f"Detected: {display_name} ({be_id})",
            "all_encoders": all_encoders,
        }

    return {
        "available": False,
        "encoder": None,
        "vendor": None,
        "hwaccel": "",
        "name": gpu_name,
        "message": "No hardware encoder found" + (f" (GPU: {gpu_name})" if gpu_name else ""),
        "all_encoders": all_encoders,
    }


def get_hwaccel_for_encoder(encoder: str) -> list:
    """Return ffmpeg hwaccel args for a specific hardware encoder."""
    for enc_id, vendor, hwaccel, label in _ALL_HARDWARE_ENCODERS:
        if enc_id == encoder:
            return ["-hwaccel", hwaccel]
    # Match by suffix
    if encoder.endswith("_nvenc"):
        return ["-hwaccel", "cuda"]
    elif encoder.endswith("_amf"):
        return ["-hwaccel", "amf"]
    elif encoder.endswith("_qsv"):
        return ["-hwaccel", "qsv"]
    return []


def get_hwaccel_args(use_gpu: bool, encoder: Optional[str] = None) -> list:
    """Return ffmpeg args for hardware acceleration when use_gpu is True.

    When encoder is an NVENC variant and use_gpu is True, uses
    -hwaccel cuda -hwaccel_output_format cuda so decoded frames stay on GPU.
    Otherwise falls back to -hwaccel <method> or empty list.
    """
    if not use_gpu:
        return []
    info = detect_gpu()
    if not info["available"] or not info["hwaccel"]:
        return []
    # Full CUDA pipeline: decode on GPU, keep frames in GPU memory
    if encoder and encoder.endswith("_nvenc"):
        return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]
    # Generic hwaccel (software decode, GPU encode)
    return ["-hwaccel", info["hwaccel"]]


def get_cuda_decode_args(encoder: str) -> list:
    """Return CUDA decode args (keeps frames on GPU) when using an NVENC encoder.

    Uses -hwaccel cuda -hwaccel_output_format cuda so decoded frames stay in GPU
    memory. Falls back gracefully if NVDEC is unavailable for the input codec.
    """
    if not encoder or not encoder.endswith("_nvenc"):
        return []
    return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]


def get_cuda_scale_filter(width: int, max_width: int) -> str:
    """Return a scale_cuda filter string if width needs downscaling, else empty string.

    Uses the GPU-resident format from -hwaccel_output_format cuda.
    """
    if max_width <= 0 or width <= max_width:
        return ""
    target_w = max(2, max_width // 2 * 2)
    return f"scale_cuda={target_w}:-2"


def get_video_encoder(use_gpu: bool, fallback: str = "libx264", preferred_encoder: Optional[str] = None,
                      output_format: Optional[str] = None) -> str:
    """Auto mode selects H.264; manual mode respects format compatibility."""
    if use_gpu:
        if fallback != "libx264":
            if fallback == "gif":
                return fallback
            raise ValueError("This output codec requires CPU encoding. Choose MP4/MKV for GPU encoding, or select CPU in Settings.")
        # Jobs need one working encoder, not a full inventory and GPU-name
        # subprocess. Stop at the first usable H.264 encoder.
        encoder = next((enc for enc, _, _ in _RECOMMENDED_PRIORITY if _encoder_works(enc)), None)
        if encoder:
            return encoder
        raise ValueError("No working GPU video encoder is available. Select CPU in Settings to use software encoding.")
    if not preferred_encoder or preferred_encoder == "libx264":
        return fallback
    known = {entry[0] for entry in _ALL_HARDWARE_ENCODERS}
    if preferred_encoder not in known:
        raise ValueError("Unknown preferred encoder")
    compatible = (
        (preferred_encoder.startswith("h264_") and fallback == "libx264")
        or (preferred_encoder.startswith("hevc_") and output_format in {"mp4", "mkv", "mov", "m4v"})
        or (preferred_encoder.startswith("av1_") and output_format in {"mp4", "mkv", "webm"})
    )
    if not compatible:
        raise ValueError("The selected GPU encoder is incompatible with this output format. Choose a compatible format or select CPU in Settings.")
    if _encoder_works(preferred_encoder):
        return preferred_encoder
    raise ValueError(f"The selected GPU encoder ({preferred_encoder}) is unavailable. Choose another encoder in Settings.")


def video_encoding_args(encoder: str, quality: Optional[int] = None) -> list:
    """Select preset and quality options supported by the chosen encoder."""
    args = ["-c:v", encoder]
    if encoder.endswith("_nvenc"):
        args += ["-preset", "p4"]
        if quality is not None:
            args += ["-rc", "vbr", "-cq", str(quality), "-b:v", "0"]
    elif encoder.endswith("_amf"):
        args += ["-quality", "balanced"]
        if quality is not None:
            args += ["-rc", "cqp", "-qp_i", str(quality), "-qp_p", str(quality)]
    elif encoder.endswith("_qsv"):
        args += ["-preset", "medium"]
        if quality is not None:
            args += ["-global_quality", str(quality)]
    elif encoder in ("libx264", "libx265"):
        args += ["-preset", "medium"]
        if quality is not None:
            args += ["-crf", str(quality)]
    return args


def resolve_encoder_selection(use_gpu, preferred_encoder="", selected_gpu=""):
    """Normalize JSON settings to the workers' auto/explicit encoder contract."""
    known = {"", "libx264", *(entry[0] for entry in _ALL_HARDWARE_ENCODERS)}
    if not isinstance(use_gpu, bool):
        raise ValueError("use_gpu must be a boolean")
    for encoder in (preferred_encoder, selected_gpu):
        if not isinstance(encoder, str) or encoder not in known:
            raise ValueError("Invalid GPU encoder")
    if use_gpu and selected_gpu:
        return False, selected_gpu
    return use_gpu, preferred_encoder
