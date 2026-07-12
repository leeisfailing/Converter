"""URL download worker using yt-dlp with HTTP fallback."""
import os
import re
import urllib.parse
import urllib.request
import threading
from pathlib import Path
from typing import Callable, Optional

try:
    import yt_dlp
except ImportError:
    yt_dlp = None


class DownloadWorker:
    def __init__(self, url: str, output_dir: Path, format_type: str = "bestvideo+bestaudio/best"):
        self.url = url
        self.output_dir = output_dir
        self.format_type = format_type
        self._is_running = True
        self._thread: Optional[threading.Thread] = None
        self.on_progress: Optional[Callable[[int], None]] = None
        self.on_finished: Optional[Callable[[bool, str, str], None]] = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=False)
        self._thread.start()

    def _run(self):
        if not self._is_running:
            return

        if yt_dlp is not None:
            try:
                self._download_with_ytdlp()
                return
            except Exception as e:
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
                return
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate')
                if total and total > 0:
                    downloaded = d.get('downloaded_bytes', 0)
                    pct = int(downloaded / total * 100)
                    if self.on_progress:
                        self.on_progress(pct)

        is_youtube = "youtube.com" in self.url.lower() or "youtu.be" in self.url.lower()

        ydl_opts = {
            'outtmpl': str(self.output_dir / '%(title)s.%(ext)s'),
            'format': 'bestvideo+bestaudio/best',
            'progress_hooks': [progress_hook],
            'nocheckcertificate': False,
            'quiet': True,
            'no_warnings': True,
            'update': False,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'http_headers': {
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.youtube.com/',
            },
        }

        if is_youtube:
            cookies_file = resource_path('cookies.txt')
            if cookies_file.exists():
                ydl_opts['cookiefile'] = str(cookies_file)
            else:
                for browser in ('chrome', 'edge', 'firefox', 'brave'):
                    try:
                        ydl_opts['cookiesfrombrowser'] = (browser,)
                        break
                    except Exception:
                        continue

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
        elif self.format_type != "bestvideo+bestaudio/best":
            ydl_opts['format'] = self.format_type

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(self.url, download=True)
        except Exception as e:
            if 'DPAPI' in str(e) or 'cookiesfrombrowser' in str(e):
                ydl_opts.pop('cookiesfrombrowser', None)
                ydl_opts['quiet'] = True
                ydl_opts['no_warnings'] = True
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(self.url, download=True)
            else:
                raise
            if not self._is_running:
                if self.on_finished:
                    self.on_finished(False, "Download was cancelled", "")
                return

            final_path = ""
            if 'requested_downloads' in info and len(info['requested_downloads']) > 0:
                for req in info['requested_downloads']:
                    if 'filepath' in req:
                        final_path = req['filepath']
                        break
            if not final_path:
                final_path = ydl.prepare_filename(info)

            if self.on_progress:
                self.on_progress(100)
            if self.on_finished:
                self.on_finished(True, "", final_path)

    def _download_http_fallback(self):
        parsed = urllib.parse.urlparse(self.url)
        filename = os.path.basename(parsed.path)
        if not filename:
            filename = "downloaded_file"

        final_path = self.output_dir / filename

        req = urllib.request.Request(self.url, headers={'User-Agent': 'Mozilla/5.0'})

        with urllib.request.urlopen(req, timeout=30) as response:
            content_disp = response.headers.get('Content-Disposition', '')
            if 'filename=' in content_disp:
                match = re.search(r'filename="?([^";]+)"?', content_disp)
                if match:
                    filename = match.group(1)
                    final_path = self.output_dir / filename

            blocksize = 8192
            blocknum = 0

            with open(final_path, 'wb') as out_file:
                while self._is_running:
                    buffer = response.read(blocksize)
                    if not buffer:
                        break
                    out_file.write(buffer)
                    blocknum += 1
                    totalsize = int(response.headers.get("Content-Length", -1))
                    if totalsize > 0:
                        read_so_far = blocknum * blocksize
                        if read_so_far > totalsize:
                            read_so_far = totalsize
                        pct = int((read_so_far / totalsize) * 100)
                        if self.on_progress:
                            self.on_progress(pct)

            if not self._is_running:
                try:
                    os.remove(final_path)
                except OSError:
                    pass
                if self.on_finished:
                    self.on_finished(False, "Download was cancelled", "")
                return

            if self.on_progress:
                self.on_progress(100)
            if self.on_finished:
                self.on_finished(True, "", str(final_path))

    def stop(self):
        self._is_running = False
