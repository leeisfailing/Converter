"""URL download worker using yt-dlp with HTTP fallback."""
import os
import re
import urllib.parse
import urllib.request
import threading
import time
import socket
from Engine.core.config import find_binary
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
    def __init__(self, url: str, output_dir: Path, format_type: str = "bestvideo+bestaudio/best"):
        self.url = url
        self.output_dir = output_dir
        self.format_type = format_type
        self._is_running = True
        self._thread: Optional[threading.Thread] = None
        self._last_progress = None
        self._last_status_time = 0.0
        self.on_progress: Optional[Callable[[int], None]] = None
        self.on_download_status: Optional[Callable[[dict], None]] = None
        self.on_finished: Optional[Callable[[bool, str, str], None]] = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=False)
        self._thread.start()

    def _run(self):
        if not self._is_running:
            if self.on_finished:
                self.on_finished(False, "Download was cancelled", "")
            return

        if yt_dlp is not None:
            try:
                self._download_with_ytdlp()
                return
            except Exception as e:
                if not self._is_running:
                    if self.on_finished:
                        self.on_finished(False, "Download was cancelled", "")
                    return
                if "youtube.com" in self.url.lower() or "youtu.be" in self.url.lower():
                    if self.on_finished:
                        self.on_finished(False, f"Download failed: {str(e)}", "")
                    return
                try:
                    self._download_http_fallback()
                    return
                except Exception as fallback_e:
                    if self.on_finished:
                        self.on_finished(False, f"Download failed: {str(e)}\nFallback also failed: {str(fallback_e)}", "")
                    return
        else:
            try:
                self._download_http_fallback()
                return
            except Exception as e:
                if self.on_finished:
                    self.on_finished(False, f"Download failed: {str(e)}", "")

    def _download_with_ytdlp(self):
        from Engine.core.config import resource_path

        def progress_hook(d: dict):
            if not self._is_running:
                raise DownloadCancelled("Download was cancelled")

            status = d.get('status', '')
            if status == 'finished':
                self._report_progress(100)
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
                pct = min(round(downloaded / total * 100), 100)
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
            if self.on_download_status and now - self._last_status_time >= 0.1:
                self._last_status_time = now
                self.on_download_status({
                    'percent': pct,
                    'speed': speed,
                    'eta': eta,
                    'is_live': bool(is_live),
                    'status': status,
                })

        is_youtube = "youtube.com" in self.url.lower() or "youtu.be" in self.url.lower()

        ydl_opts = {
            'ffmpeg_location': find_binary('ffmpeg'),
            'noplaylist': True,
            'outtmpl': str(self.output_dir / '%(title)s.%(ext)s'),
            'format': 'bestvideo+bestaudio/best',
            'progress_hooks': [progress_hook],
            'nocheckcertificate': False,
            'quiet': True,
            'no_warnings': True,
            'update': False,
            'socket_timeout': 30,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'http_headers': {
                'Accept-Language': 'en-US,en;q=0.9',
            },
        }

        if is_youtube:
            ydl_opts['http_headers']['Referer'] = 'https://www.youtube.com/'
            cookies_file = resource_path('cookies.txt')
            if cookies_file.exists():
                ydl_opts['cookiefile'] = str(cookies_file)

        if self.format_type == "mp4_4k":
            ydl_opts['format'] = 'bestvideo[ext=mp4][height<=2160]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]/best'
            ydl_opts['merge_output_format'] = 'mp4'
        elif self.format_type == "mp4_1080":
            ydl_opts['format'] = 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'
            ydl_opts['merge_output_format'] = 'mp4'
        elif self.format_type == "mp4":
            ydl_opts['format'] = 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
            ydl_opts['merge_output_format'] = 'mp4'
        elif self.format_type == "mp3":
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }]
        elif self.format_type == "best_4k":
            ydl_opts['format'] = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best'
        elif self.format_type == "best_1080":
            ydl_opts['format'] = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'
        elif self.format_type == "original":
            # "original" is an app option, not a yt-dlp format identifier.
            # Audio-only sources also have a valid original representation.
            ydl_opts['format'] = 'bestvideo+bestaudio/best/bestaudio'
        elif self.format_type != "bestvideo+bestaudio/best":
            ydl_opts['format'] = self.format_type

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(self.url, download=True)
        except Exception as e:
            raise

        if not self._is_running:
            if self.on_finished:
                self.on_finished(False, "Download was cancelled", "")
            return

        final_path = ""
        if info and 'requested_downloads' in info and len(info['requested_downloads']) > 0:
            for req in info['requested_downloads']:
                if 'filepath' in req:
                    final_path = req['filepath']
                    break
        if not final_path and info:
            final_path = ydl.prepare_filename(info)

        if self.on_progress:
            self.on_progress(100)
        if self.on_finished:
            self.on_finished(True, "", str(final_path))

    def _download_http_fallback(self):
        parsed = urllib.parse.urlparse(self.url)
        filename = os.path.basename(parsed.path)
        if not filename:
            filename = "downloaded_file"

        final_path = _find_unique_path(self.output_dir, filename)
        temp_path = final_path.with_suffix(final_path.suffix + '.part')

        try:
            req = urllib.request.Request(self.url, headers={'User-Agent': 'Mozilla/5.0'})

            with urllib.request.urlopen(req, timeout=30) as response:
                content_disp = response.headers.get('Content-Disposition', '')
                if 'filename=' in content_disp:
                    match = re.search(r'filename="?([^";]+)"?', content_disp)
                    if match:
                        filename = os.path.basename(match.group(1))
                        if filename:
                            final_path = _find_unique_path(self.output_dir, filename)
                        temp_path = final_path.with_suffix(final_path.suffix + '.part')

                blocksize = 65536
                read_so_far = 0
                try:
                    totalsize = int(response.headers.get('Content-Length', -1))
                except (ValueError, TypeError):
                    totalsize = -1

                with open(temp_path, 'wb') as out_file:
                    while self._is_running:
                        buffer = response.read(blocksize)
                        if not buffer:
                            break
                        out_file.write(buffer)
                        read_so_far += len(buffer)
                        if totalsize > 0:
                            pct = min(int((read_so_far / totalsize) * 100), 100)
                            self._report_progress(pct)

            if not self._is_running:
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
                if self.on_finished:
                    self.on_finished(False, "Download was cancelled", "")
                return

            if totalsize >= 0 and read_so_far != totalsize:
                raise IOError(f"Incomplete download: expected {totalsize} bytes, received {read_so_far}")
            temp_path.rename(final_path)

            if self.on_progress:
                self.on_progress(100)
            if self.on_finished:
                self.on_finished(True, "", str(final_path))
        except Exception:
            try:
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
