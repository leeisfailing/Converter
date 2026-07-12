"""File format conversion using ffmpeg."""
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable, List, Optional


def find_ffmpeg() -> str:
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS)
        for name in ('ffmpeg.exe', 'ffmpeg'):
            p = base / 'bin' / name
            if p.exists():
                return str(p)

    app_dir = Path(__file__).parent.parent
    for name in ('ffmpeg.exe', 'ffmpeg'):
        p = app_dir / 'bin' / name
        if p.exists():
            return str(p)

    return 'ffmpeg'


class ConverterWorker:
    def __init__(
        self,
        input_path: str,
        output_path: str,
        output_format: str,
        dev_mode: bool = False,
    ):
        self.input_path = input_path
        self.output_path = output_path
        self.output_format = output_format
        self.dev_mode = dev_mode
        self._is_running = True
        self._thread: Optional[threading.Thread] = None
        self._stderr_lines: List[str] = []
        self.on_progress: Optional[Callable[[int], None]] = None
        self.on_finished: Optional[Callable[[bool, str, str], None]] = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=False)
        self._thread.start()

    def _run(self):
        from Engine.formats.video import VIDEO_OUTPUT_FORMATS
        from Engine.formats.photo import PHOTO_OUTPUT_FORMATS
        from Engine.formats.detection import detect_file_type, get_allowed_output_formats

        try:
            cmd = self._build_command()

            if self.on_progress:
                self.on_progress(10)

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )

            duration: Optional[float] = None
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
                    dur_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+)", line)
                    if dur_match:
                        h, m, s = int(dur_match.group(1)), int(dur_match.group(2)), int(dur_match.group(3))
                        duration = h * 3600 + m * 60 + s

                time_match = re.search(r"time=(\d+):(\d+):(\d+)", line)
                if time_match and duration and duration > 0:
                    h, m, s = int(time_match.group(1)), int(time_match.group(2)), int(time_match.group(3))
                    current = h * 3600 + m * 60 + s
                    pct = int((current / duration) * 90) + 10
                    if pct > 100:
                        pct = 100
                    if self.on_progress:
                        self.on_progress(pct)

            proc.wait()

            if proc.returncode == 0:
                if self.on_progress:
                    self.on_progress(100)
                if self.on_finished:
                    self.on_finished(True, "", self.output_path)
            else:
                error_detail = "".join(self._stderr_lines[-20:]) if self._stderr_lines else ""
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

    def _build_command(self) -> List[str]:
        from Engine.formats.video import VIDEO_OUTPUT_FORMATS
        from Engine.formats.photo import PHOTO_OUTPUT_FORMATS
        from Engine.formats.detection import detect_file_type

        input_file = Path(self.input_path)
        output_file = Path(self.output_path)
        file_type = detect_file_type(self.input_path)

        cmd = [find_ffmpeg(), '-y', '-hide_banner', '-i', str(input_file)]

        if file_type == 'video' or (self.dev_mode and self.output_format in VIDEO_OUTPUT_FORMATS):
            fmt = VIDEO_OUTPUT_FORMATS.get(self.output_format, VIDEO_OUTPUT_FORMATS['mp4'])
            cmd += ['-c:v', fmt['vcodec'], '-preset', 'medium']
            if fmt.get('acodec'):
                cmd += ['-c:a', fmt['acodec'], '-b:a', '128k']
            else:
                cmd += ['-an']
        elif file_type == 'photo' or (self.dev_mode and self.output_format in PHOTO_OUTPUT_FORMATS):
            fmt = PHOTO_OUTPUT_FORMATS.get(self.output_format, PHOTO_OUTPUT_FORMATS['jpg'])
            if 'quality' in fmt:
                cmd += ['-q:v', fmt['quality']]
            if 'compression' in fmt:
                cmd += ['-compression_level', fmt['compression']]
        else:
            cmd += ['-c:v', 'libx264', '-c:a', 'aac']

        cmd.append(str(output_file))
        return cmd

    def stop(self):
        self._is_running = False
