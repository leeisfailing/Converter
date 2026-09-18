"""TikTok downloads through TikWM and HTTP, independently of yt-dlp."""
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError
from http.client import IncompleteRead

from PyEngine.core.tiktok import HEADERS, resolve_video, media_url


class TikTokDownloadWorker:
    def __init__(self, url: str, output_dir: Path, format_type: str = 'tiktok', **_options):
        self.url = url
        self.output_dir = output_dir
        self.format_type = format_type
        self.on_progress = None
        self.on_download_status = None
        self.on_finished = None
        self._cancelled = threading.Event()
        self._completed = False
        self._thread = None

    def _finish(self, ok, message, path):
        # The client can enqueue its next job before this callback returns.
        self._completed = True
        if self.on_finished:
            self.on_finished(ok, message, path)

    def start(self):
        self._completed = False
        self._thread = threading.Thread(target=self._run, daemon=False)
        self._thread.start()

    def stop(self):
        self._cancelled.set()

    def _check_cancelled(self):
        if self._cancelled.is_set():
            raise RuntimeError('Download was cancelled')

    def _run(self):
        for attempt in range(3):
            try:
                target = self._download_once(prefer_hd=attempt == 0)
            except Exception as exc:
                retryable = isinstance(exc, (URLError, TimeoutError, ConnectionError, IncompleteRead)) or any(
                    word in str(exc).lower() for word in ('incomplete', 'invalid mp4', 'could not be reached', 'rate limit', 'too many', 'try later'))
                if retryable and attempt < 2 and not self._cancelled.is_set():
                    if self.on_download_status:
                        self.on_download_status({'percent': 0, 'status': 'retrying', 'is_live': False})
                    self._cancelled.wait(attempt + 1)
                    continue
                message = 'Download was cancelled' if self._cancelled.is_set() else f'TikTok download failed: {exc}'
                self._finish(False, message, '')
                return
            if self.on_progress:
                self.on_progress(100)
            self._finish(True, '', str(target))
            return

    def _download_once(self, prefer_hd=True):
        partial = None
        try:
            self._check_cancelled()
            if self.on_download_status:
                self.on_download_status({'percent': 0, 'status': 'resolving', 'is_live': False})
            data = resolve_video(self.url)
            self._check_cancelled()
            source = media_url(data, self.format_type, prefer_hd=prefer_hd)
            video_id = re.sub(r'[^0-9]', '', str(data.get('id') or ''))[:32] or 'video'
            suffix = 'no-watermark' if self.format_type == 'tiktok_no_watermark' else 'download'
            # Unique names prevent simultaneous downloads from overwriting each other.
            title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', str(data.get('title') or 'TikTok'))
            title = ' '.join(title.split())[:70].strip(' .') or 'TikTok'
            target = self.output_dir / f'{title} [{video_id}]-{suffix}-{uuid.uuid4().hex[:8]}.mp4'
            partial = target.with_suffix('.mp4.part')
            with urlopen(Request(source, headers=HEADERS), timeout=30) as response:
                total = int(response.headers.get('Content-Length') or 0)
                first = response.read(131072)
                if len(first) < 12 or first[4:8] != b'ftyp':
                    raise RuntimeError('TikTok returned an invalid MP4 file. Please retry.')
                received = 0
                started = time.monotonic()
                last_report = 0.0
                with partial.open('xb') as output:
                    chunk = first
                    while chunk:
                        self._check_cancelled()
                        output.write(chunk)
                        received += len(chunk)
                        now = time.monotonic()
                        if now - last_report >= 0.5:
                            speed = received / max(now - started, 0.001)
                            percent = min(99, int(received * 100 / total)) if total else None
                            if self.on_progress and percent is not None:
                                self.on_progress(percent)
                            if self.on_download_status:
                                self.on_download_status({
                                    'percent': percent, 'speed': speed,
                                    'eta': max(0, (total - received) / speed) if total else None,
                                    'is_live': False, 'status': 'downloading',
                                })
                            last_report = now
                        chunk = response.read(131072)
            self._check_cancelled()
            if total and received != total:
                raise RuntimeError('TikTok download was incomplete. Please retry.')
            partial.rename(target)
            return target
        except Exception:
            if partial:
                partial.unlink(missing_ok=True)
            raise
