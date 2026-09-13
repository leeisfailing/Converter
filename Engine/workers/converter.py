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
        use_gpu: bool = False,
        preferred_encoder: str = "",
    ):
        self.input_path = validate_path(input_path, "input_path")
        self.output_path = validate_output_path(output_path, "output_path")
        self.output_format = validate_string(output_format, "output_format", 32)
        self.dev_mode = dev_mode
        self.use_gpu = use_gpu
        self.preferred_encoder = preferred_encoder
        self.max_width: Optional[int] = None
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

    _CODEC_MAP = {
        'libx264': 'h264', 'h264_nvenc': 'h264', 'h264_amf': 'h264', 'h264_qsv': 'h264',
        'libx265': 'hevc', 'hevc_nvenc': 'hevc', 'hevc_amf': 'hevc', 'hevc_qsv': 'hevc',
        'libvpx-vp9': 'vp9', 'av1_nvenc': 'av1', 'av1_amf': 'av1', 'av1_qsv': 'av1',
    }

    def _codec_for_encoder(self, encoder: str) -> Optional[str]:
        return self._CODEC_MAP.get(encoder)

    def _probe_codecs(self) -> Optional[dict]:
        """Probe input file to detect video and audio codecs."""
        try:
            cmd = [
                find_ffmpeg(), '-hide_banner', '-i', self.input_path,
            ]
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            vcodec, acodec = None, None
            for line in proc.stderr.splitlines():
                line_stripped = line.strip()
                if 'Video:' in line_stripped:
                    parts = line_stripped.split('Video:')
                    if len(parts) > 1:
                        codec_part = parts[1].split(',')[0].strip()
                        vcodec = codec_part.lower()
                elif 'Audio:' in line_stripped:
                    parts = line_stripped.split('Audio:')
                    if len(parts) > 1:
                        codec_part = parts[1].split(',')[0].strip()
                        acodec = codec_part.lower()
            if vcodec:
                return {'vcodec': vcodec, 'acodec': acodec}
        except Exception:
            pass
        return None

    def _build_command(self) -> List[str]:
        from Engine.formats.video import VIDEO_OUTPUT_FORMATS
        from Engine.formats.photo import PHOTO_OUTPUT_FORMATS
        from Engine.formats.audio import AUDIO_OUTPUT_FORMATS
        from Engine.formats.detection import detect_file_type
        from Engine.core.gpu import get_video_encoder, video_encoding_args, get_hwaccel_args, get_cuda_scale_filter

        input_file = Path(self.input_path)
        output_file = Path(self.output_path)
        file_type = detect_file_type(self.input_path)

        # Determine video encoder early so hwaccel can be encoder-aware
        is_video_output = self.output_format in VIDEO_OUTPUT_FORMATS
        is_audio_output = self.output_format in AUDIO_OUTPUT_FORMATS
        is_photo_output = self.output_format in PHOTO_OUTPUT_FORMATS
        video_encoder = None
        if is_video_output and (file_type == 'video' or file_type == 'photo'):
            fmt_pre = VIDEO_OUTPUT_FORMATS[self.output_format]
            video_encoder = get_video_encoder(self.use_gpu, fallback=fmt_pre['vcodec'], preferred_encoder=self.preferred_encoder, output_format=self.output_format)

        cmd = [find_ffmpeg(), '-y', '-nostdin', '-hide_banner']
        cmd += get_hwaccel_args(self.use_gpu, encoder=video_encoder)
        cmd += ['-i', str(input_file)]
        cmd += ['-map_metadata', '0']

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
            encoder = video_encoder
            # Stream copy when input codec is compatible with output format
            probe = self._probe_codecs()
            can_stream_copy = (
                probe
                and probe['vcodec'] in ('h264', 'hevc', 'av1', 'vp9')
                and encoder in ('libx264', 'hevc_nvenc', 'h264_nvenc', 'h264_amf', 'hevc_amf', 'h264_qsv', 'hevc_qsv')
                and probe['vcodec'] == self._codec_for_encoder(encoder)
            )
            if can_stream_copy:
                cmd += ['-c:v', 'copy']
                # Also copy audio when output format supports it
                if fmt.get('acodec') and probe.get('acodec') in ('aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3'):
                    cmd += ['-c:a', 'copy']
                elif fmt.get('acodec'):
                    cmd += ['-c:a', fmt['acodec'], '-b:a', '192k']
                else:
                    cmd += ['-an']
            else:
                # GPU-resident scale when using full CUDA pipeline (NVENC decode+encode)
                if encoder and encoder.endswith("_nvenc") and probe and probe.get('width'):
                    cuda_scale = get_cuda_scale_filter(probe['width'], self.max_width or 0)
                    if cuda_scale:
                        cmd += ['-vf', cuda_scale]
                    elif self.max_width:
                        cmd += ['-vf', f'scale={self.max_width}:-2']
                elif self.max_width:
                    cmd += ['-vf', f'scale={self.max_width}:-2']
                # Transcode with visually lossless quality (CRF 18)
                cmd += video_encoding_args(encoder, quality=18)
                if fmt.get('acodec'):
                    cmd += ['-c:a', fmt['acodec'], '-b:a', '192k']
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
            encoder = video_encoder
            # GPU-resident scale when using full CUDA pipeline (NVENC decode+encode)
            if encoder and encoder.endswith("_nvenc"):
                probe = self._probe_codecs()
                if probe and probe.get('width'):
                    cuda_scale = get_cuda_scale_filter(probe['width'], self.max_width or 0)
                    if cuda_scale:
                        cmd += ['-vf', cuda_scale]
                    elif self.max_width:
                        cmd += ['-vf', f'scale={self.max_width}:-2']
                elif self.max_width:
                    cmd += ['-vf', f'scale={self.max_width}:-2']
            elif self.max_width:
                cmd += ['-vf', f'scale={self.max_width}:-2']
            cmd += video_encoding_args(encoder, quality=18)
            if fmt.get('acodec'):
                cmd += ['-c:a', fmt['acodec'], '-b:a', '192k']
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

        if self.output_format in ('mp4', 'mov', 'm4v'):
            cmd += ['-movflags', '+use_metadata_tags']
        cmd.append(str(output_file))
        import sys
        print(f"[convert] ffmpeg cmd output_file={output_file!r}, resolved={str(output_file.resolve())!r}", file=sys.stderr, flush=True)
        print(f"[convert] GPU enabled: {self.use_gpu}", file=sys.stderr, flush=True)
        print(f"[convert] Preferred encoder: {self.preferred_encoder!r}", file=sys.stderr, flush=True)
        print(f"[convert] Selected video encoder: {video_encoder!r}", file=sys.stderr, flush=True)
        print(f"[convert] Full ffmpeg command:", file=sys.stderr, flush=True)
        print(f"  {' '.join(cmd)}", file=sys.stderr, flush=True)
        # Show if GPU hwaccel is in the args
        has_hwaccel = any('hwaccel' in arg for arg in cmd)
        has_nvenc = any('nvenc' in arg for arg in cmd)
        has_cuda = any('cuda' in arg for arg in cmd)
        print(f"[convert] GPU pipeline: hwaccel={has_hwaccel}, nvenc={has_nvenc}, cuda={has_cuda}", file=sys.stderr, flush=True)
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