"""Video/image upscaling using ffmpeg with GPU-first pipeline."""
import re
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path
from Engine.core.config import find_binary
from Engine.core.security import validate_path, validate_output_path
from typing import Callable, Optional

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)")
_TIME_RE = re.compile(r"time=\s*(\d+):(\d+):(\d+\.?\d*)")

UPSCALE_PRESETS = {
    "2k": {"width": 2560, "height": 1440, "label": "2K (1440p)"},
    "4k": {"width": 3840, "height": 2160, "label": "4K (2160p)"},
    "8k": {"width": 7680, "height": 4320, "label": "8K (4320p)"},
    "16k": {"width": 15360, "height": 8640, "label": "16K (8640p)"},
}


def find_ffmpeg() -> str:
    return find_binary("ffmpeg")


class UpscalerWorker:
    def __init__(
        self,
        input_path: str,
        output_path: str,
        target: str,
        file_type: str = "video",
        use_gpu: bool = False,
        preferred_encoder: str = "",
    ):
        self.input_path = validate_path(input_path, "input_path")
        self.output_path = validate_output_path(output_path, "output_path")
        if target not in UPSCALE_PRESETS:
            raise ValueError(f"Invalid upscale target: {target}. Must be one of: {', '.join(UPSCALE_PRESETS)}")
        self.target = target
        self.target_width = UPSCALE_PRESETS[target]["width"]
        self.target_height = UPSCALE_PRESETS[target]["height"]
        self.file_type = file_type
        self.use_gpu = use_gpu
        self.preferred_encoder = preferred_encoder
        self._is_running = True
        self._thread: Optional[threading.Thread] = None
        self._stderr_lines: deque = deque(maxlen=100)
        self._process = None
        self.on_progress: Optional[Callable[[int], None]] = None
        self.on_finished: Optional[Callable[[bool, str, str], None]] = None
        self._last_pct: int = 0
        self._last_progress_time: float = 0.0
        self._progress_interval: float = 0.1

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=False)
        self._thread.start()

    def _build_command(self) -> list:
        from Engine.core.gpu import (
            get_video_encoder,
            video_encoding_args,
            get_hwaccel_args,
        )
        ffmpeg = find_ffmpeg()
        cmd = [ffmpeg, "-nostdin"]

        video_encoder = None
        if self.file_type == "video":
            output_ext = Path(self.output_path).suffix.lstrip(".").lower()
            video_encoder = get_video_encoder(
                self.use_gpu,
                fallback="libx264",
                preferred_encoder=self.preferred_encoder,
                output_format=output_ext,
            )

        cmd += get_hwaccel_args(self.use_gpu, encoder=video_encoder)
        cmd += ["-i", self.input_path]
        cmd += ["-map_metadata", "0"]

        if self.file_type == "video":
            encoder = video_encoder
            # GPU-resident pipeline: scale on GPU then encode
            if encoder and encoder.endswith("_nvenc"):
                cmd += ["-vf", f"scale_npp={self.target_width}:{self.target_height}:interp_algo=lanczos"]
                cmd += video_encoding_args(encoder, quality=20)
            else:
                # CPU lanczos upscale
                cmd += ["-vf", f"scale={self.target_width}:{self.target_height}:flags=lanczos"]
                cmd += video_encoding_args(encoder, quality=18)
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        elif self.file_type == "photo":
            cmd += ["-vf", f"scale={self.target_width}:{self.target_height}:flags=lanczos"]
            ext = Path(self.output_path).suffix.lstrip(".").lower()
            if ext in ("jpg", "jpeg"):
                cmd += ["-q:v", "2"]
            elif ext == "webp":
                cmd += ["-quality", "95"]
            elif ext == "png":
                cmd += ["-compression_level", "6"]

        output_ext = Path(self.output_path).suffix.lstrip(".").lower()
        if output_ext in ("mp4", "mov", "m4v"):
            cmd += ["-movflags", "+use_metadata_tags"]
        cmd += ["-y", self.output_path]
        return cmd

    def _run(self):
        proc = None
        try:
            cmd = self._build_command()
            if self.on_progress:
                self.on_progress(10)

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            self._process = proc
            if not self._is_running:
                proc.terminate()

            duration: Optional[float] = None
            self._stderr_lines = deque(maxlen=100)
            self._last_pct = 0
            self._last_progress_time = 0.0

            for line in proc.stderr:
                if not self._is_running:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                    if self.on_finished:
                        self.on_finished(False, "Upscale was cancelled", "")
                    return

                self._stderr_lines.append(line)

                if duration is None:
                    dur_match = _DURATION_RE.search(line)
                    if dur_match:
                        h, m, s = round(float(dur_match.group(1))), round(float(dur_match.group(2))), float(dur_match.group(3))
                        duration = h * 3600 + m * 60 + s

                time_match = _TIME_RE.search(line)
                if time_match and duration and duration > 0:
                    h, m, s = round(float(time_match.group(1))), round(float(time_match.group(2))), float(time_match.group(3))
                    current = h * 3600 + m * 60 + s
                    pct = int((current / duration) * 90) + 10
                    if pct > 100:
                        pct = 100
                    if self._should_update_progress(pct):
                        self._last_pct = pct
                        if self.on_progress:
                            self.on_progress(pct)
                elif time_match and self.on_progress and self._last_pct < 95:
                    self._last_pct = 95
                    self.on_progress(95)

            proc.wait()

            if not self._is_running:
                if self.on_finished:
                    self.on_finished(False, "Upscale was cancelled", "")
            elif proc.returncode == 0:
                if self.on_progress:
                    self.on_progress(100)
                if self.on_finished:
                    self.on_finished(True, "", self.output_path)
            else:
                error_detail = "".join(list(self._stderr_lines)[-20:])
                msg = f"ffmpeg failed with exit code {proc.returncode}"
                if error_detail.strip():
                    msg += f"\n\nffmpeg output:\n{error_detail}"
                if self.on_finished:
                    self.on_finished(False, msg, "")

        except FileNotFoundError:
            if self.on_finished:
                self.on_finished(False, "ffmpeg not found. Please install ffmpeg.", "")
        except Exception as exc:
            if self.on_finished:
                self.on_finished(False, f"Upscale error: {str(exc)}", "")
        finally:
            self._process = None
            if proc is not None:
                if proc.stderr is not None:
                    try:
                        proc.stderr.close()
                    except Exception:
                        pass
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()

    def _should_update_progress(self, pct: int) -> bool:
        import time
        now = time.time()
        if now - self._last_progress_time >= self._progress_interval:
            self._last_progress_time = now
            return True
        return False

    def stop(self):
        self._is_running = False
        proc = self._process
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass
