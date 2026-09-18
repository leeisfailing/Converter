"""Shared FFmpeg lifecycle: bounded diagnostics, cancellation and atomic output."""
from collections import deque
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)")
_TIME_RE = re.compile(r"time=\s*(\d+):(\d+):(\d+\.?\d*)")


class FfmpegError(RuntimeError):
    pass


def _seconds(match):
    h, m, s = map(float, match.groups())
    return h * 3600 + m * 60 + s


class FfmpegWorker:
    operation = "Conversion"

    def _init_process(self):
        self._is_running = True
        self._completed = False
        self._thread = None
        self._process = None
        self._stderr_lines = deque(maxlen=100)
        self.on_progress = None
        self.on_finished = None
        self._last_pct = 0
        self._last_progress_time = 0.0
        self._progress_interval = 0.1

    def start(self):
        self._completed = False
        self._thread = threading.Thread(target=self._run, daemon=False)
        self._thread.start()

    def _check_cancelled(self):
        if not self._is_running:
            raise RuntimeError(f"{self.operation} was cancelled")

    def _execute(self, cmd):
        self._check_cancelled()
        self._stderr_lines.clear()
        self._last_pct = 0
        self._last_progress_time = 0.0
        duration = None
        if self.on_progress:
            self.on_progress(10)
        self._check_cancelled()
        with subprocess.Popen(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
            encoding="utf-8", errors="replace", bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        ) as proc:
            self._process = proc
            try:
                self._check_cancelled()
                # Bound each read as well as the history: a malformed diagnostic
                # without a newline must not allocate an arbitrarily large string.
                for line in iter(lambda: proc.stderr.readline(4096), ""):
                    self._check_cancelled()
                    self._stderr_lines.append(line[-4096:])
                    if duration is None and "Duration:" in line:
                        match = _DURATION_RE.search(line)
                        if match:
                            duration = _seconds(match)
                    match = _TIME_RE.search(line) if duration and "time=" in line else None
                    if match and duration and duration > 0:
                        pct = max(10, min(99, int(_seconds(match) / duration * 89) + 10))
                        now = time.monotonic()
                        if pct > self._last_pct and now - self._last_progress_time >= self._progress_interval:
                            self._last_pct, self._last_progress_time = pct, now
                            if self.on_progress:
                                self.on_progress(pct)
                proc.wait()
                self._check_cancelled()
                if proc.returncode:
                    detail = "".join(list(self._stderr_lines)[-20:]).strip()
                    raise FfmpegError(f"ffmpeg failed with exit code {proc.returncode}\n\nffmpeg output:\n{detail}")
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
                self._process = None

    def _perform(self):
        cmd = self._build_command()
        destination = Path(self.output_path)
        # Same filesystem for atomic replacement; never expose partial output
        # or overwrite an existing result after an error/cancellation.
        with tempfile.TemporaryDirectory(prefix=".convert-", dir=destination.parent) as folder:
            candidate = Path(folder) / destination.name
            cmd[-1] = str(candidate)
            self._execute(cmd)
            self._check_cancelled()
            if not candidate.is_file() or candidate.stat().st_size == 0:
                raise RuntimeError("ffmpeg produced no output")
            os.replace(candidate, destination)

    def _run(self):
        result = (False, "", "")
        try:
            self._check_cancelled()
            if Path(self.input_path).resolve() == Path(self.output_path).resolve():
                raise ValueError("Output must be different from the original file")
            self._perform()
            if self.on_progress:
                self.on_progress(100)
            result = (True, "", self.output_path)
        except FileNotFoundError as exc:
            result = (False, f"{self.operation} failed: {exc}", "")
        except Exception as exc:
            message = str(exc) if self._is_running else f"{self.operation} was cancelled"
            result = (False, message, "")
        # Release the dispatcher before publishing completion: the client can
        # submit another job before this callback/thread has returned.
        self._completed = True
        if self.on_finished:
            self.on_finished(*result)

    def stop(self):
        self._is_running = False
        proc = self._process
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass
