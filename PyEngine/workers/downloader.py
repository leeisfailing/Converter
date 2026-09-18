"""URL download worker using yt-dlp with HTTP fallback."""
import os
import re
import urllib.parse
import urllib.request
import threading
import tempfile
import time
from PyEngine.core.config import find_binary
from PyEngine.core.ytdlp_options import javascript_options
from pathlib import Path
from typing import Callable, Optional

try:
    import yt_dlp
except ImportError:
    yt_dlp = None


class DownloadCancelled(Exception):
    """Stop downloading immediately from yt-dlp progress callbacks."""


def _find_unique_path(directory: Path, filename: str) -> Path:
    """Return a unique file path in directory, appending (N) if needed."""
    final_path = directory / filename
    if final_path.exists():
        stem = final_path.stem
        suffix = final_path.suffix
        counter = 1
        while final_path.exists():
            final_path = directory / f"{stem} ({counter}){suffix}"
            counter += 1
    return final_path


class DownloadWorker:
    def __init__(self, url: str, output_dir: Path, format_type: str = "bestvideo+bestaudio/best",
                 write_subtitles: bool = False, write_thumbnail: bool = False,
                 use_browser_cookies: bool = False):
        self.url = url
        self.output_dir = output_dir
        self.format_type = format_type
        self.write_subtitles = write_subtitles
        self.write_thumbnail = write_thumbnail
        self.use_browser_cookies = use_browser_cookies
        self._is_running = True
        self._completed = False
        self._thread: Optional[threading.Thread] = None
        self._last_progress = None
        self._last_progress_time: float = 0.0
        self._last_status_time: float = 0.0
        self.on_progress: Optional[Callable[[int], None]] = None
        self.on_download_status: Optional[Callable[[dict], None]] = None
        self.on_finished: Optional[Callable[[bool, str, str], None]] = None

    def _finish(self, ok, message, path):
        # The client can enqueue its next job before this callback returns.
        self._completed = True
        if self.on_finished:
            self.on_finished(ok, message, path)

    def start(self):
        self._completed = False
        self._thread = threading.Thread(target=self._run, daemon=False)
        self._thread.start()

    def _run(self):
        if not self._is_running:
            self._finish(False, "Download was cancelled", "")
            return

        if yt_dlp is not None:
            try:
                self._download_with_ytdlp()
                return
            except Exception as e:
                if not self._is_running:
                    self._finish(False, "Download was cancelled", "")
                    return
                # A failed media extraction must not become a successful HTML
                # download, or bypass a requested format conversion.
                if self.format_type not in ("original", "bestvideo+bestaudio/best"):
                    self._finish(False, f"Download failed: {str(e)}", "")
                    return
                try:
                    self._download_http_fallback()
                    return
                except Exception as fallback_e:
                    self._finish(False, f"Download failed: {str(e)}\nFallback also failed: {str(fallback_e)}", "")
                    return
        else:
            if self.format_type not in ("original", "bestvideo+bestaudio/best"):
                self._finish(False, "yt-dlp is required for the requested media format", "")
                return
            try:
                self._download_http_fallback()
                return
            except Exception as e:
                self._finish(False, f"Download failed: {str(e)}", "")

    def _download_with_ytdlp(self):
        from PyEngine.core.config import resource_path

        def progress_hook(d: dict):
            if not self._is_running:
                raise DownloadCancelled("Download was cancelled")

            status = d.get('status', '')
            if status == 'finished':
                self._report_progress(99)
                return

            if status != 'downloading':
                return

            total = d.get('total_bytes') or d.get('total_bytes_estimate')
            downloaded = d.get('downloaded_bytes') or 0
            speed = d.get('speed')
            eta = d.get('eta')
            is_live = d.get('live') or d.get('is_live')

            pct = None
            if total and total > 0:
                pct = min(round(downloaded / total * 100), 99)
            else:
                pct_str = d.get('_percent_str', '').strip().rstrip('%')
                if pct_str:
                    try:
                        pct = min(round(float(pct_str)), 100)
                    except (ValueError, TypeError):
                        pct = None

            if pct is not None:
                self._report_progress(pct)

            now = time.monotonic()
            if self.on_download_status and now - self._last_status_time >= 0.5:
                self._last_status_time = now
                self.on_download_status({
                    'percent': pct,
                    'speed': speed,
                    'eta': eta,
                    'is_live': bool(is_live),
                    'status': status,
                })

        hostname = urllib.parse.urlparse(self.url).hostname or ""
        is_youtube = hostname == "youtu.be" or hostname == "youtube.com" or hostname.endswith(".youtube.com")

        ydl_opts = {
            **javascript_options(),
            'ffmpeg_location': find_binary('ffmpeg'),
            'noplaylist': True,
            'outtmpl': str(self.output_dir / '%(title)s.%(ext)s'),
            'format': 'bestvideo+bestaudio/best',
            'progress_hooks': [progress_hook],
            'postprocessors': [],
            'nocheckcertificate': False,
            'quiet': True,
            'noprogress': True,
            'no_warnings': True,
            'update': False,
            'socket_timeout': 30,
            'geo_bypass': True,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'http_headers': {
                'Accept-Language': 'en-US,en;q=0.9',
            },
        }

        if is_youtube:
            ydl_opts['http_headers']['Referer'] = 'https://www.youtube.com/'
            cookies_file = resource_path('cookies.txt')
            if cookies_file.exists():
                ydl_opts['cookiefile'] = str(cookies_file)
            elif self.use_browser_cookies:
                ydl_opts['cookiesfrombrowser'] = ('chrome',)

        # Subtitle and thumbnail options
        if self.write_subtitles:
            ydl_opts['writesubtitles'] = True
            ydl_opts['writeautomaticsub'] = True
            ydl_opts['subtitleslangs'] = ['en']
            ydl_opts['subtitlesformat'] = 'srt/best'
        if self.write_thumbnail:
            ydl_opts['writethumbnail'] = True

        # Video format handling
        if self.format_type.startswith("mp4_"):
            height = self.format_type.replace("mp4_", "")
            ydl_opts['format'] = f'bestvideo[ext=mp4][height<={height}]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
            ydl_opts['merge_output_format'] = 'mp4'
        elif self.format_type == "mp4":
            ydl_opts['format'] = 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
            ydl_opts['merge_output_format'] = 'mp4'
        elif self.format_type.startswith("webm_"):
            height = self.format_type.replace("webm_", "")
            ydl_opts['format'] = f'bestvideo[ext=webm][height<={height}]+bestaudio[ext=webm]/bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
            ydl_opts['merge_output_format'] = 'webm'
        elif self.format_type == "webm":
            ydl_opts['format'] = 'bestvideo[ext=webm][height<=720]+bestaudio[ext=webm]/bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best'
            ydl_opts['merge_output_format'] = 'webm'
        elif self.format_type.startswith("mkv_"):
            height = self.format_type.replace("mkv_", "")
            ydl_opts['format'] = f'bestvideo[height<={height}]+bestaudio/best[height<={height}]/best'
            ydl_opts['merge_output_format'] = 'mkv'
        elif self.format_type == "mkv":
            ydl_opts['format'] = 'bestvideo[height<=720]+bestaudio/bestvideo+bestaudio/best'
            ydl_opts['merge_output_format'] = 'mkv'
        # Audio format handling
        elif self.format_type.startswith("mp3"):
            bitrate = "192"
            if self.format_type == "mp3_320":
                bitrate = "320"
            elif self.format_type == "mp3_256":
                bitrate = "256"
            elif self.format_type == "mp3_192":
                bitrate = "192"
            elif self.format_type == "mp3_128":
                bitrate = "128"
            elif self.format_type == "mp3_64":
                bitrate = "64"
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'].append({
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': bitrate,
            })
        elif self.format_type.startswith("aac"):
            bitrate = "192"
            if self.format_type == "aac_320":
                bitrate = "320"
            elif self.format_type == "aac_256":
                bitrate = "256"
            elif self.format_type == "aac_192":
                bitrate = "192"
            elif self.format_type == "aac_128":
                bitrate = "128"
            elif self.format_type == "aac_64":
                bitrate = "64"
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'].append({
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'aac',
                'preferredquality': bitrate,
            })
        elif self.format_type == "flac":
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'].append({
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'flac',
            })
        elif self.format_type == "wav":
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'].append({
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'wav',
            })
        elif self.format_type.startswith("ogg"):
            bitrate = "192"
            if self.format_type == "ogg_320":
                bitrate = "320"
            elif self.format_type == "ogg_256":
                bitrate = "256"
            elif self.format_type == "ogg_192":
                bitrate = "192"
            elif self.format_type == "ogg_128":
                bitrate = "128"
            elif self.format_type == "ogg_64":
                bitrate = "64"
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'].append({
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'vorbis',
                'preferredquality': bitrate,
            })
        elif self.format_type == "original":
            ydl_opts['format'] = 'bestvideo+bestaudio/best/bestaudio'
        elif self.format_type != "bestvideo+bestaudio/best":
            ydl_opts['format'] = self.format_type

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(self.url, download=True)

        if not self._is_running:
            self._finish(False, "Download was cancelled", "")
            return

        candidates = [info.get('filepath')] if info else []
        if info:
            candidates += [req.get('filepath') for req in info.get('requested_downloads', [])]
            candidates.append(ydl.prepare_filename(info))
        final_path = next((p for p in candidates if p and Path(p).is_file()), None)
        if not final_path:
            raise RuntimeError("Download completed without a final media file")

        if self.on_progress:
            self.on_progress(100)
        self._finish(True, "", str(final_path))

    def _download_http_fallback(self):
        parsed = urllib.parse.urlparse(self.url)
        filename = os.path.basename(parsed.path)
        if not filename:
            filename = "downloaded_file"

        final_path = _find_unique_path(self.output_dir, filename)
        temp_path = None

        try:
            req = urllib.request.Request(self.url, headers={'User-Agent': 'Mozilla/5.0'})

            with urllib.request.urlopen(req, timeout=30) as response:
                if response.headers.get_content_type() in ('text/html', 'application/xhtml+xml'):
                    raise ValueError("The URL returned a web page instead of a downloadable file")
                content_disp = response.headers.get('Content-Disposition', '')
                if 'filename=' in content_disp:
                    match = re.search(r'filename="?([^";]+)"?', content_disp)
                    if match:
                        filename = os.path.basename(match.group(1))
                        if filename:
                            final_path = _find_unique_path(self.output_dir, filename)

                blocksize = 131072
                read_so_far = 0
                try:
                    totalsize = int(response.headers.get('Content-Length', -1))
                except (ValueError, TypeError):
                    totalsize = -1

                status_change_time = time.monotonic()
                last_read_so_far = 0
                last_speed_time = status_change_time
                current_speed = 0.0
                # Own a unique partial file so retries and failures never
                # truncate or delete another download's existing .part file.
                with tempfile.NamedTemporaryFile(mode='wb', prefix='.download-',
                                                 suffix='.part', dir=self.output_dir,
                                                 delete=False) as out_file:
                    temp_path = Path(out_file.name)
                    while self._is_running:
                        buffer = response.read(blocksize)
                        if not buffer:
                            break
                        out_file.write(buffer)
                        read_so_far += len(buffer)
                        now = time.monotonic()
                        elapsed = now - last_speed_time
                        if elapsed >= 0.5:
                            current_speed = (read_so_far - last_read_so_far) / elapsed
                            last_read_so_far = read_so_far
                            last_speed_time = now
                        if totalsize > 0 and now - status_change_time >= 0.5:
                            pct = min(int((read_so_far / totalsize) * 100), 100)
                            self._report_progress(pct)
                            if self.on_download_status:
                                eta = None
                                if current_speed > 0:
                                    remaining = totalsize - read_so_far
                                    eta = max(int(remaining / current_speed), 0)
                                self.on_download_status({
                                    'percent': pct,
                                    'speed': current_speed,
                                    'eta': eta,
                                    'is_live': False,
                                    'status': 'downloading',
                                })
                            status_change_time = now

            if not self._is_running:
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
                self._finish(False, "Download was cancelled", "")
                return

            if totalsize >= 0 and read_so_far != totalsize:
                raise IOError(f"Incomplete download: expected {totalsize} bytes, received {read_so_far}")
            temp_path.rename(final_path)

            if self.on_progress:
                self.on_progress(100)
            self._finish(True, "", str(final_path))
        except Exception:
            try:
                if temp_path is not None:
                    os.remove(temp_path)
            except OSError:
                pass
            raise

    def stop(self):
        self._is_running = False

    def _report_progress(self, percent):
        percent = max(0, min(100, int(percent)))
        if percent != self._last_progress:
            self._last_progress = percent
            if self.on_progress:
                self.on_progress(percent)
