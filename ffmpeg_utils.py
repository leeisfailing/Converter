from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Set, Tuple

from cache_utils import get_cache_manager, VideoMetadata


_ENCODER_CACHE: Optional[List[Tuple[str, str]]] = None


def check_ffmpeg_availability() -> tuple[bool, str]:
    """
    Check if ffmpeg and ffprobe are available and working.
    First checks for bundled binaries, then system PATH.

    Returns:
        Tuple of (is_available, error_message). If available, error_message is empty.
    """
    # Check for bundled ffmpeg first
    app_dir = Path(__file__).parent
    bin_dir = app_dir / "bin"
    bundled_ffmpeg = bin_dir / "ffmpeg.exe"
    bundled_ffprobe = bin_dir / "ffprobe.exe"

    ffmpeg_cmd = str(bundled_ffmpeg) if bundled_ffmpeg.exists() else "ffmpeg"
    ffprobe_cmd = str(bundled_ffprobe) if bundled_ffprobe.exists() else "ffprobe"

    for cmd_name, cmd in [("ffmpeg", ffmpeg_cmd), ("ffprobe", ffprobe_cmd)]:
        try:
            proc = subprocess.run(
                [cmd, "-version"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=5,
            )
            if proc.returncode != 0:
                return False, f"{cmd_name} returned exit code {proc.returncode}"
        except FileNotFoundError:
            if cmd == ffmpeg_cmd or cmd == ffprobe_cmd:
                # Bundled not found, try system
                system_cmd = cmd_name
                try:
                    proc = subprocess.run(
                        [system_cmd, "-version"],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        timeout=5,
                    )
                    if proc.returncode != 0:
                        return False, f"{system_cmd} returned exit code {proc.returncode}"
                except FileNotFoundError:
                    return False, f"{cmd_name} not found. Please install ffmpeg from https://ffmpeg.org/download.html or place ffmpeg.exe and ffprobe.exe in the 'bin' folder."
                except subprocess.TimeoutExpired:
                    return False, f"{system_cmd} timed out during version check."
                except OSError as e:
                    return False, f"Error running {system_cmd}: {e}"
            else:
                return False, f"{cmd_name} not found in bundled binaries or system PATH."
        except subprocess.TimeoutExpired:
            return False, f"{cmd} timed out during version check."
        except OSError as e:
            return False, f"Error running {cmd}: {e}"
    return True, ""


def detect_gpu_hardware() -> List[str]:
    """
    Detect available GPU hardware on the system.
    Returns list of detected GPU types: ['nvidia', 'amd', 'intel']
    """
    detected_gpus = []

    try:
        # Try PowerShell command first (more reliable on Windows)
        proc = subprocess.run(
            ["powershell", "-Command", "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
        )
        if proc.returncode == 0:
            gpu_names = proc.stdout.strip().split('\n')
        else:
            # Fallback to wmic
            proc = subprocess.run(
                ["wmic", "path", "win32_VideoController", "get", "name"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=5,
            )
            gpu_names = proc.stdout.strip().split('\n')[1:]  # Skip header

        for name in gpu_names:
            name = name.strip().lower()
            if 'nvidia' in name or 'geforce' in name or 'rtx' in name or 'gtx' in name:
                if 'nvidia' not in detected_gpus:
                    detected_gpus.append('nvidia')
            elif 'amd' in name or 'radeon' in name or 'rx' in name:
                if 'amd' not in detected_gpus:
                    detected_gpus.append('amd')
            elif 'intel' in name or 'hd graphics' in name or 'iris' in name or 'uhd' in name:
                if 'intel' not in detected_gpus:
                    detected_gpus.append('intel')

    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        pass

    return detected_gpus


def detect_gpu_encoders() -> List[Tuple[str, str]]:
    """
    Return encoders: list of (name, description) for hardware encoders.
    Prioritizes encoders based on detected GPU hardware.
    """
    global _ENCODER_CACHE

    if _ENCODER_CACHE is not None:
        return _ENCODER_CACHE

    # Use bundled ffmpeg if available
    app_dir = Path(__file__).parent
    bin_dir = app_dir / "bin"
    bundled_ffmpeg = bin_dir / "ffmpeg.exe"
    ffmpeg_cmd = str(bundled_ffmpeg) if bundled_ffmpeg.exists() else "ffmpeg"

    try:
        proc = subprocess.run(
            [ffmpeg_cmd, "-hide_banner", "-encoders"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=10,
        )
        output = proc.stdout or ""
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        output = ""

    # Detect available hardware
    detected_hardware = detect_gpu_hardware()

    # Define encoder priorities based on hardware
    encoder_priorities = {
        'nvidia': ['h264_nvenc', 'hevc_nvenc'],
        'amd': ['h264_amf', 'hevc_amf'],
        'intel': ['h264_qsv', 'hevc_qsv'],
    }

    gpu_keywords = ["_nvenc", "_qsv", "_amf", "_vaapi"]
    encoders: List[Tuple[str, str]] = []

    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        name = parts[1]
        if any(name.endswith(kw) for kw in gpu_keywords):
            desc = " ".join(parts[2:]) if len(parts) > 2 else name

            # Add hardware info to description
            if name.endswith('_nvenc'):
                desc = f"NVIDIA {desc}"
            elif name.endswith('_qsv'):
                desc = f"Intel {desc}"
            elif name.endswith('_amf'):
                desc = f"AMD {desc}"
            elif name.endswith('_vaapi'):
                desc = f"VAAPI {desc}"

            encoders.append((name, desc))

    # Sort encoders by hardware priority
    def encoder_priority(encoder_tuple):
        name, _ = encoder_tuple
        for hw in detected_hardware:
            if hw in encoder_priorities and name in encoder_priorities[hw]:
                return 0  # High priority for detected hardware
        return 1  # Lower priority for other encoders

    encoders.sort(key=encoder_priority)

    _ENCODER_CACHE = encoders
    return encoders


def build_ffmpeg_command(
    input_path: Path,
    output_path: Path,
    is_video: bool,
    is_convert: bool,
    gpu_choice: str,
    available_gpu_encoders: Iterable[str],
    target_size_mb: Optional[float] = None,
    target_resolution: Optional[str] = None,
) -> Sequence[str]:
    if is_video:
        return build_video_command(
            input_path=input_path,
            output_path=output_path,
            is_convert=is_convert,
            gpu_choice=gpu_choice,
            available_gpu_encoders=set(available_gpu_encoders),
            target_size_mb=target_size_mb,
            target_resolution=target_resolution,
        )
    return build_image_command(
        input_path=input_path,
        output_path=output_path,
        is_convert=is_convert,
    )


def build_video_command(
    input_path: Path,
    output_path: Path,
    is_convert: bool,
    gpu_choice: str,
    available_gpu_encoders: Set[str],
    target_size_mb: Optional[float] = None,
    target_resolution: Optional[str] = None,
) -> Sequence[str]:
    # Use bundled ffmpeg if available
    app_dir = Path(__file__).parent
    bin_dir = app_dir / "bin"
    bundled_ffmpeg = bin_dir / "ffmpeg.exe"
    ffmpeg_cmd = str(bundled_ffmpeg) if bundled_ffmpeg.exists() else "ffmpeg"

    cmd: List[str] = [ffmpeg_cmd, "-y", "-hide_banner", "-i", str(input_path)]

    video_bitrate = "2500k" if is_convert else "1800k"
    audio_bitrate = "128k"

    if target_size_mb is not None and target_size_mb > 0:
        duration = get_video_duration_seconds(input_path)
        if duration and duration > 0:
            total_bits = target_size_mb * 1024 * 1024 * 8
            total_kbits = total_bits / 1000.0
            target_total_kbps = total_kbits / duration
            audio_kbps = 128.0
            video_kbps = max(100.0, target_total_kbps - audio_kbps)
            video_bitrate = f"{int(video_kbps)}k"

    vcodec = "libx264"

    if gpu_choice and gpu_choice not in ("auto", "cpu_only"):
        vcodec = gpu_choice

    if gpu_choice == "auto":
        preferred_gpu_codecs = ["h264_nvenc", "hevc_nvenc", "h264_qsv", "h264_amf"]
        for codec in preferred_gpu_codecs:
            if codec in available_gpu_encoders:
                vcodec = codec
                break

    if target_resolution:
        cmd += ["-vf", f"scale={target_resolution}:flags=lanczos"]

    cmd += ["-c:v", vcodec, "-b:v", video_bitrate, "-preset", "medium"]
    cmd += ["-c:a", "aac", "-b:a", audio_bitrate]
    cmd.append(str(output_path))
    return cmd


def get_video_duration_seconds(path: Path) -> Optional[float]:
    """
    Ask ffprobe for the duration in seconds. Returns None on failure.
    Uses cache to avoid repeated probing of the same file.
    """
    cache_manager = get_cache_manager()

    # Check cache first
    cached_metadata = cache_manager.get_video_metadata(path)
    if cached_metadata and cached_metadata.duration is not None:
        return cached_metadata.duration

    # Use bundled ffprobe if available
    app_dir = Path(__file__).parent
    bin_dir = app_dir / "bin"
    bundled_ffprobe = bin_dir / "ffprobe.exe"
    ffprobe_cmd = str(bundled_ffprobe) if bundled_ffprobe.exists() else "ffprobe"

    # Probe the file
    try:
        proc = subprocess.run(
            [
                ffprobe_cmd,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired, ValueError):
        return None

    output = (proc.stdout or "").strip()
    try:
        duration = float(output)
        # Cache the result
        metadata = VideoMetadata(duration=duration, size_bytes=None, format=None, width=None, height=None)
        cache_manager.set_video_metadata(path, metadata)
        return duration
    except ValueError:
        return None


def build_image_command(
    input_path: Path,
    output_path: Path,
    is_convert: bool,
) -> Sequence[str]:
    # Use bundled ffmpeg if available
    app_dir = Path(__file__).parent
    bin_dir = app_dir / "bin"
    bundled_ffmpeg = bin_dir / "ffmpeg.exe"
    ffmpeg_cmd = str(bundled_ffmpeg) if bundled_ffmpeg.exists() else "ffmpeg"

    cmd: List[str] = [ffmpeg_cmd, "-y", "-hide_banner", "-i", str(input_path)]

    ext = output_path.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        quality = "2" if is_convert else "4"
        cmd += ["-q:v", quality]
    elif ext == ".png":
        level = "3" if is_convert else "5"
        cmd += ["-compression_level", level]

    cmd.append(str(output_path))
    return cmd

