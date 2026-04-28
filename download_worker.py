import os
import re
import socket
import shutil
import tempfile
import yt_dlp
from pathlib import Path
from typing import Optional
import urllib.request
import urllib.parse
import urllib.error
from PySide6.QtCore import QThread, Signal


class DownloadWorker(QThread):
    progress = Signal(int)
    finished = Signal(bool, str, str)  # ok, error_message, file_path

    def __init__(self, url: str, output_dir: Path, format_type: str = "bestvideo+bestaudio/best", parent=None):
        super().__init__(parent)
        self.url = url
        self.output_dir = output_dir
        self.format_type = format_type
        self._is_running = True

    def run(self) -> None:
        if not self._is_running:
            return

        # First try yt-dlp for YouTube and other supported sites
        try:
            self._download_with_ytdlp()
            return
        except Exception as e:
            # Only try fallback for non-YouTube URLs or if yt-dlp fails
            if "youtube.com" in self.url.lower() or "youtu.be" in self.url.lower():
                self.finished.emit(False, f"Download failed: {str(e)}", "")
                return
            # Try fallback HTTP download
            try:
                self._download_http_fallback()
                return
            except Exception as fallback_e:
                self.finished.emit(False, f"Download failed: {str(e)}\nFallback also failed: {str(fallback_e)}", "")
                return

    def _download_with_ytdlp(self) -> None:
        def progress_hook(d: dict) -> None:
            if not self._is_running:
                raise Exception("Download cancelled")
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate')
                if total and total > 0:
                    downloaded = d.get('downloaded_bytes', 0)
                    pct = int(downloaded / total * 100)
                    self.progress.emit(pct)

        ydl_opts = {
            'outtmpl': str(self.output_dir / '%(title)s.%(ext)s'),
            'format': 'bestvideo+bestaudio/best',
            'progress_hooks': [progress_hook],
            'nocheckcertificate': False,  # Security: verify SSL certificates
            'quiet': True,
            'no_warnings': True,
            'update': False,  # Prevent yt-dlp from auto-updating
        }

        if self.format_type == "mp4":
            ydl_opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
            ydl_opts['merge_output_format'] = 'mp4'
        elif self.format_type == "mp3":
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }]
        elif self.format_type != "bestvideo+bestaudio/best":
            ydl_opts['format'] = self.format_type

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(self.url, download=True)
                if not self._is_running:
                    raise Exception("Download cancelled")

                # Determine final file path
                final_path = ""
                if 'requested_downloads' in info and len(info['requested_downloads']) > 0:
                    for req in info['requested_downloads']:
                        if 'filepath' in req:
                            final_path = req['filepath']
                            break
                if not final_path:
                    final_path = ydl.prepare_filename(info)

                self.progress.emit(100)
                self.finished.emit(True, "", final_path)
        except Exception as e:
            if not self._is_running:
                self.finished.emit(False, "Download was cancelled", "")
            else:
                raise

    def _download_http_fallback(self) -> None:
        """Fallback download for plain HTTP/HTTPS files."""

        parsed = urllib.parse.urlparse(self.url)
        filename = os.path.basename(parsed.path)
        if not filename:
            filename = "downloaded_file"

        final_path = self.output_dir / filename

        def reporthook(blocknum: int, blocksize: int, totalsize: int) -> None:
            if not self._is_running:
                raise Exception("Download cancelled")
            if totalsize > 0:
                read_so_far = blocknum * blocksize
                if read_so_far > totalsize:
                    read_so_far = totalsize
                pct = int((read_so_far / totalsize) * 100)
                self.progress.emit(pct)

        # Setup request with timeout and user agent
        req = urllib.request.Request(
            self.url,
            headers={'User-Agent': 'Mozilla/5.0'}
        )

        try:
            # Use timeout to prevent hanging
            with urllib.request.urlopen(req, timeout=30) as response:
                # Check if we got a different filename from Content-Disposition
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
                            reporthook(blocknum, blocksize, totalsize)

                if not self._is_running:
                    # Clean up partial file
                    try:
                        os.remove(final_path)
                    except OSError:
                        pass
                    self.finished.emit(False, "Download was cancelled", "")
                    return

                self.progress.emit(100)
                self.finished.emit(True, "", str(final_path))

        except socket.timeout:
            self.finished.emit(False, "Download timed out", "")
        except urllib.error.URLError as e:
            self.finished.emit(False, f"URL error: {str(e.reason)}", "")
        except Exception as e:
            self.finished.emit(False, f"Download error: {str(e)}", "")

    def stop(self) -> None:
        """Request the worker to stop downloading."""
        self._is_running = False
