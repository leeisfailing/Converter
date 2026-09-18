"""Download completion ordering and ownership of temporary files."""
import io
import tempfile
import threading
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import Mock, patch

from PyEngine import __main__ as dispatcher
from PyEngine.workers.downloader import DownloadWorker
from PyEngine.workers.tiktok import TikTokDownloadWorker


class Response(io.BytesIO):
    def __init__(self, data, content_type='video/mp4', total=None):
        super().__init__(data)
        self.headers = Message()
        self.headers['Content-Type'] = content_type
        self.headers['Content-Length'] = str(len(data) if total is None else total)


class DownloadLifecycleTests(unittest.TestCase):
    def test_next_job_is_accepted_while_completion_callback_returns(self):
        for worker_class in (DownloadWorker, TikTokDownloadWorker):
            with self.subTest(worker=worker_class.__name__), tempfile.TemporaryDirectory() as folder:
                worker = worker_class('https://example.com/video', Path(folder))
                finished, release = threading.Event(), threading.Event()

                def on_finished(*result):
                    finished.set()
                    release.wait(5)

                worker.on_finished = on_finished
                if worker_class is DownloadWorker:
                    operation = patch.object(worker, '_download_with_ytdlp',
                                             side_effect=lambda: worker._finish(True, '', 'video.mp4'))
                else:
                    operation = patch.object(worker, '_download_once', return_value=Path(folder) / 'video.mp4')
                with operation, patch('PyEngine.workers.downloader.yt_dlp', object()), patch.dict(
                        dispatcher._current_worker, {'start_download': worker}, clear=True):
                    worker.start()
                    try:
                        self.assertTrue(finished.wait(5))
                        self.assertTrue(worker._thread.is_alive())
                        self.assertFalse(dispatcher._has_active_worker())
                    finally:
                        release.set()
                        worker._thread.join(5)

    def test_http_success_and_failures_preserve_preexisting_partial_file(self):
        for content_type, total, success in [('video/mp4', 5, True),
                                             ('video/mp4', 20, False),
                                             ('text/html', 5, False)]:
            with self.subTest(content_type=content_type, total=total), tempfile.TemporaryDirectory() as folder:
                partial = Path(folder) / 'video.mp4.part'
                partial.write_bytes(b'keep existing download')
                worker = DownloadWorker('https://example.com/video.mp4', Path(folder), 'original')
                worker.on_finished = Mock()
                with patch('PyEngine.workers.downloader.urllib.request.urlopen',
                           return_value=Response(b'media', content_type, total)):
                    if success:
                        worker._download_http_fallback()
                        self.assertEqual((Path(folder) / 'video.mp4').read_bytes(), b'media')
                    else:
                        with self.assertRaises((ValueError, IOError)):
                            worker._download_http_fallback()
                        self.assertFalse((Path(folder) / 'video.mp4').exists())
                self.assertEqual(partial.read_bytes(), b'keep existing download')
                self.assertEqual(list(Path(folder).glob('.download-*.part')), [])


if __name__ == '__main__':
    unittest.main()
