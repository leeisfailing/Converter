import re
import subprocess
from typing import Optional, Sequence

from PySide6.QtCore import QThread, Signal


class EncoderWorker(QThread):
    progress = Signal(int)
    finished = Signal(bool, str)

    def __init__(self, cmd: Sequence[str], cwd: Optional[str] = None, parent=None):
        super().__init__(parent)
        self.cmd = list(cmd)
        self.cwd = cwd
        self._is_running = True

    def run(self) -> None:
        try:
            self.progress.emit(10)
            proc = subprocess.Popen(
                self.cmd,
                cwd=self.cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True,
            )

            # Parse ffmpeg stderr for progress
            duration: Optional[float] = None
            for line in proc.stderr:
                if not self._is_running:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                    self.finished.emit(False, "Encoding was cancelled")
                    return

                # Try to extract duration from ffmpeg output
                if duration is None:
                    dur_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+)(?:\.(\d+))?", line)
                    if dur_match:
                        h, m, s = int(dur_match.group(1)), int(dur_match.group(2)), int(dur_match.group(3))
                        duration = h * 3600 + m * 60 + s

                # Try to extract current time
                time_match = re.search(r"time=(\d+):(\d+):(\d+)(?:\.(\d+))?", line)
                if time_match and duration and duration > 0:
                    h, m, s = int(time_match.group(1)), int(time_match.group(2)), int(time_match.group(3))
                    current = h * 3600 + m * 60 + s
                    pct = int((current / duration) * 90) + 10  # 10% to 100%
                    if pct > 100:
                        pct = 100
                    self.progress.emit(pct)

            proc.wait()

            if proc.returncode == 0:
                self.progress.emit(100)
                self.finished.emit(True, "")
            else:
                stderr_output = ""
                if proc.stderr:
                    # Read any remaining stderr
                    try:
                        proc.stderr.close()
                    except Exception:
                        pass
                # Get error summary from the last lines we saw
                msg = f"ffmpeg failed with exit code {proc.returncode}"
                self.finished.emit(False, msg)
        except FileNotFoundError:
            self.finished.emit(False, "ffmpeg not found. Please ensure ffmpeg is installed and in your PATH.")
        except subprocess.TimeoutExpired:
            self.finished.emit(False, "Encoding timed out")
        except Exception as exc:
            self.finished.emit(False, f"Encoding error: {str(exc)}")

    def stop(self) -> None:
        """Request the worker to stop encoding."""
        self._is_running = False

