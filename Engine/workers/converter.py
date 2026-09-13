"""File format conversion using ffmpeg."""
import re
import subprocess
import sys
import threading
import shlex
from collections import deque
from Engine.core.config import find_binary
from Engine.core.security import validate_path, validate_output_path, validate_string
from pathlib import Path
from typing import Callable, List, Optional

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)")
_TIME_RE = re.compile(r"time=\s*(\d+):(\d+):(\d+\.?\d*)")


def find_ffmpeg() -> str:
    return find_binary("ffmpeg")


class ConverterWorker:
    def __init__(
        self,
        input_path: str,
        output_path: str,
        output_format: str,
        dev_mode: bool = False,
    ):
        self.input_path = validate_path(input_path, "input_path")
        self.output_path = validate_output_path(output_path, "output_path")
        self.output_format = validate_string(output_format, "output_format", 32)
        self.dev_mode = dev_mode
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
        from Engine.formats.video import VIDEO_OUTPUT_FORMATS
        from Engine.formats.photo import PHOTO_OUTPUT_FORMATS
        from Engine.formats.audio import AUDIO_OUTPUT_FORMATS
        from Engine.formats.detection import detect_file_type

        input_file = Path(self.input_path)
        output_file = Path(self.output_path)
        file_type = detect_file_type(self.input_path)

        cmd = [find_ffmpeg(), '-y', '-hide_banner', '-i', str(input_file)]

        is_video_output = self.output_format in VIDEO_OUTPUT_FORMATS
        is_audio_output = self.output_format in AUDIO_OUTPUT_FORMATS
        is_photo_output = self.output_format in PHOTO_OUTPUT_FORMATS

        if is_audio_output and (file_type == 'video' or file_type == 'audio'):
            fmt = AUDIO_OUTPUT_FORMATS[self.output_format]
            cmd += ['-vn']
            if fmt.get('acodec'):
                cmd += ['-c:a', fmt['acodec']]
            if fmt.get('bitrate'):
                cmd += ['-b:a', fmt['bitrate']]
        elif is_photo_output and file_type == 'photo':
            fmt = PHOTO_OUTPUT_FORMATS[self.output_format]
            if 'quality' in fmt:
                cmd += ['-q:v', fmt['quality']]
            if 'compression' in fmt:
                cmd += ['-compression_level', fmt['compression']]
        elif is_video_output and (file_type == 'video' or file_type == 'photo'):
            fmt = VIDEO_OUTPUT_FORMATS[self.output_format]
            cmd += ['-c:v', fmt['vcodec'], '-preset', 'medium']
            if fmt.get('acodec'):
                cmd += ['-c:a', fmt['acodec'], '-b:a', '128k']
            else:
                cmd += ['-an']
        elif self.dev_mode and is_audio_output:
            fmt = AUDIO_OUTPUT_FORMATS[self.output_format]
            cmd += ['-vn']
            if fmt.get('acodec'):
                cmd += ['-c:a', fmt['acodec']]
            if fmt.get('bitrate'):
                cmd += ['-b:a', fmt['bitrate']]
        elif self.dev_mode and is_video_output:
            fmt = VIDEO_OUTPUT_FORMATS[self.output_format]
            cmd += ['-c:v', fmt['vcodec'], '-preset', 'medium']
            if fmt.get('acodec'):
                cmd += ['-c:a', fmt['acodec'], '-b:a', '128k']
            else:
                cmd += ['-an']
        elif self.dev_mode and is_photo_output:
            fmt = PHOTO_OUTPUT_FORMATS[self.output_format]
            if 'quality' in fmt:
                cmd += ['-q:v', fmt['quality']]
            if 'compression' in fmt:
                cmd += ['-compression_level', fmt['compression']]
        else:
            raise ValueError(
                f"Unsupported file type '{file_type}' for conversion. "
                f"Please select a supported output format."
            )

        cmd.append(str(output_file))
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
                        self.on_finished(False, "Conversion was cancelled", "")
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
                    self.on_finished(False, "Conversion was cancelled", "")
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
                self.on_finished(False, f"Conversion error: {str(exc)}", "")
        finally:
            self._process = None
            if proc is not None:
                stderr = proc.stderr
                if stderr is not None:
                    try:
                        stderr.close()
                    except Exception:
                        pass
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()

    def _should_update_progress(self, pct: int) -> bool:
        """Throttle progress updates to reduce callback overhead."""
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