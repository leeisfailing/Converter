"""File size reduction using ffmpeg."""
import re
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path
from Engine.core.config import find_binary
from Engine.core.security import validate_path, validate_output_path, validate_string
from typing import Callable, List, Optional

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)")
_TIME_RE = re.compile(r"time=\s*(\d+):(\d+):(\d+\.?\d*)")


def find_ffmpeg() -> str:
    return find_binary("ffmpeg")


class ReducerWorker:
    def __init__(
        self,
        input_path: str,
        output_path: str,
        quality: int = 50,
        max_width: Optional[int] = None,
        file_type: str = "video",
        target_bytes: Optional[int] = None,
        use_gpu: bool = False,
        preferred_encoder: str = "",
    ):
        self.input_path = validate_path(input_path, "input_path")
        self.output_path = validate_output_path(output_path, "output_path")
        self.quality = max(1, min(100, quality))
        self.max_width = max_width
        self.file_type = file_type
        self.target_bytes = target_bytes
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

    def _build_command(self) -> List[str]:
        from Engine.core.gpu import get_video_encoder, video_encoding_args, get_hwaccel_args, get_cuda_scale_filter
        ffmpeg = find_ffmpeg()
        cmd = [ffmpeg, "-nostdin"]

        # Determine video encoder early so hwaccel can be encoder-aware
        video_encoder = None
        if self.file_type == "video":
            video_encoder = get_video_encoder(self.use_gpu, fallback="libx264", preferred_encoder=self.preferred_encoder, output_format=Path(self.output_path).suffix.lstrip(".").lower())

        cmd += get_hwaccel_args(self.use_gpu, encoder=video_encoder)
        cmd += ["-i", self.input_path]
        cmd += ["-map_metadata", "0"]

        if self.file_type == "video":
            crf = max(1, min(51, int(40 - (self.quality * 0.28))))
            encoder = video_encoder
            cmd += video_encoding_args(encoder, crf)
            cmd += ["-c:a", "aac", "-b:a", "128k"]
            if self.max_width is not None:
                # GPU-resident scale when using full CUDA pipeline (NVENC decode+encode)
                if encoder and encoder.endswith("_nvenc"):
                    input_width = self._probe_width()
                    if input_width:
                        cuda_scale = get_cuda_scale_filter(input_width, self.max_width)
                        if cuda_scale:
                            cmd += ["-vf", cuda_scale]
                        else:
                            cmd += ["-vf", f"scale={self.max_width}:-2"]
                    else:
                        cmd += ["-vf", f"scale={self.max_width}:-2"]
                else:
                    cmd += ["-vf", f"scale={self.max_width}:-2"]

        elif self.file_type == "photo":
            ext = Path(self.output_path).suffix.lstrip(".").lower()
            if ext in ("jpg", "jpeg"):
                qv = max(2, min(31, int(31 - (self.quality * 0.29))))
                cmd += ["-q:v", str(qv)]
            elif ext == "webp":
                cmd += ["-quality", str(self.quality)]
            elif ext == "png":
                level = max(0, min(9, int(9 - self.quality / 100 * 9)))
                cmd += ["-compression_level", str(level)]
            if self.max_width is not None:
                cmd += ["-vf", f"scale={self.max_width}:-1"]

        elif self.file_type == "audio":
            bitrate = max(32, min(320, int(32 + self.quality * 3.2)))
            cmd += ["-c:a", "libmp3lame", "-b:a", f"{bitrate}k"]

        output_ext = Path(self.output_path).suffix.lstrip(".").lower()
        if output_ext in ("mp4", "mov", "m4v"):
            cmd += ["-movflags", "+use_metadata_tags"]
        cmd += ["-y", self.output_path]
        import sys
        print(f"[reduce] GPU enabled: {self.use_gpu}", file=sys.stderr, flush=True)
        print(f"[reduce] Preferred encoder: {self.preferred_encoder!r}", file=sys.stderr, flush=True)
        print(f"[reduce] Selected video encoder: {video_encoder!r}", file=sys.stderr, flush=True)
        print(f"[reduce] File type: {self.file_type}", file=sys.stderr, flush=True)
        print(f"[reduce] Full ffmpeg command:", file=sys.stderr, flush=True)
        print(f"  {' '.join(cmd)}", file=sys.stderr, flush=True)
        has_hwaccel = any('hwaccel' in arg for arg in cmd)
        has_nvenc = any('nvenc' in arg for arg in cmd)
        has_cuda = any('cuda' in arg for arg in cmd)
        print(f"[reduce] GPU pipeline: hwaccel={has_hwaccel}, nvenc={has_nvenc}, cuda={has_cuda}", file=sys.stderr, flush=True)
        return cmd

    def _probe_width(self) -> Optional[int]:
        """Probe input file width via ffprobe."""
        try:
            import json as _json
            result = subprocess.run(
                [find_binary("ffprobe"), "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width", "-of", "json", self.input_path],
                capture_output=True, text=True, timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            data = _json.loads(result.stdout)
            streams = data.get("streams", [])
            if streams:
                return int(streams[0].get("width", 0)) or None
        except Exception:
            pass
        return None

    def _run(self):
        proc = None
        try:
            if self.target_bytes is not None:
                import os as _os
                import shutil
                import tempfile
                from pathlib import Path as _Path

                cmd = self._build_command()
                with tempfile.TemporaryDirectory(prefix='.reduce-') as tmpdir:
                    tmp_output = _Path(tmpdir) / ('tmp_output' + _Path(self.output_path).suffix)
                    tmp_cmd = cmd[:-1] + [str(tmp_output)]
                    if self.on_progress:
                        self.on_progress(10)
                    proc = subprocess.Popen(
                        tmp_cmd,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                        text=True,
                        bufsize=1,
                        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                    )
                    self._process = proc
                    if not self._is_running:
                        proc.terminate()
                    duration = None
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
                                self.on_finished(False, "Reduction was cancelled", "")
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
                            pct = int((current / duration) * 80) + 10
                            if pct > 100:
                                pct = 100
                            if self._should_update_progress(pct):
                                self._last_pct = pct
                                if self.on_progress:
                                    self.on_progress(pct)
                    proc.wait()
                    self._process = None
                    if proc.returncode != 0:
                        error_detail = "".join(list(self._stderr_lines)[-20:])
                        msg = f"ffmpeg failed with exit code {proc.returncode}"
                        if error_detail.strip():
                            msg += f"\n\nffmpeg output:\n{error_detail}"
                        if self.on_finished:
                            self.on_finished(False, msg, "")
                        return
                    if not self._is_running:
                        if self.on_finished:
                            self.on_finished(False, "Reduction was cancelled", "")
                        return
                    output_size = tmp_output.stat().st_size if tmp_output.exists() else 0
                    if output_size <= self.target_bytes:
                        shutil.move(str(tmp_output), self.output_path)
                        if self.on_progress:
                            self.on_progress(100)
                        if self.on_finished:
                            self.on_finished(True, "", self.output_path)
                        return
                if self.on_progress:
                    self.on_progress(5)
                from Engine.workers.target_size import reduce_to_target
                reduce_to_target(self)
                if self.on_finished:
                    self.on_finished(True, "", self.output_path)
                return
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
                        self.on_finished(False, "Reduction was cancelled", "")
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
                    self.on_finished(False, "Reduction was cancelled", "")
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
                self.on_finished(False, f"Reduction error: {str(exc)}", "")
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
