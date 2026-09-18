import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PyEngine.core.security import validate_url
from PyEngine.core.tiktok import is_tiktok_url, media_url, resolve_video
from PyEngine.handlers.url import _detect_url_info, handle_detect_url
from PyEngine.handlers.download import handle_start_download
from PyEngine.workers.tiktok import TikTokDownloadWorker

URL = 'https://www.tiktok.com/@example/video/123?_r=1&_t=abc'
DATA = {'id': '123', 'title': 'Example', 'duration': 30,
        'play': 'https://example.com/play.mp4', 'hdplay': 'https://example.com/hd.mp4',
        'wmplay': 'https://example.com/wm.mp4'}
MP4 = b'\x00\x00\x00\x18ftypisom' + b'0' * 100


class Response(io.BytesIO):
    def __init__(self, body, total=None):
        super().__init__(body)
        self.headers = {'Content-Length': str(len(body) if total is None else total)}


class TikTokTests(unittest.TestCase):
    def test_share_query_survives_detection_and_download_validation(self):
        self.assertEqual(validate_url(URL), URL)
        with patch('PyEngine.handlers.url._detect_url_info', return_value={'ok': True}) as detect, patch('PyEngine.handlers.url.send_response'):
            handle_detect_url({'url': URL})
            detect.assert_called_once_with(URL)
        with tempfile.TemporaryDirectory() as folder, patch('PyEngine.handlers.download.TikTokDownloadWorker') as worker, patch('PyEngine.handlers.download.DownloadWorker') as youtube:
            handle_start_download({'url': URL, 'output_dir': folder, 'format_type': 'tiktok_no_watermark'})
            self.assertEqual(worker.call_args.args[0], URL)
            worker.return_value.start.assert_called_once()
            youtube.assert_not_called()
        for invalid in (URL + '\x00', 'https://localhost/video', URL + '|command'):
            with self.assertRaises(ValueError):
                validate_url(invalid)

    def test_hosts(self):
        for host in ('tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'):
            self.assertTrue(is_tiktok_url(f'https://{host}/video/123'))
        for url in ('https://tiktok.com.evil.test/video/1', 'https://eviltiktok.com', 'https://tiktok.com@evil.test', 'file://tiktok.com/video/1'):
            self.assertFalse(is_tiktok_url(url))

    def test_modes_never_substitute_watermarked_for_clean(self):
        self.assertEqual(media_url(DATA, 'tiktok'), DATA['wmplay'])
        self.assertEqual(media_url(DATA, 'tiktok_no_watermark'), DATA['hdplay'])
        self.assertEqual(media_url(DATA, 'tiktok_no_watermark', prefer_hd=False), DATA['play'])
        self.assertEqual(media_url({'play': DATA['play']}, 'tiktok_no_watermark'), DATA['play'])
        with self.assertRaisesRegex(RuntimeError, 'no-watermark'):
            media_url({'wmplay': DATA['wmplay']}, 'tiktok_no_watermark')
        with self.assertRaisesRegex(RuntimeError, 'standard'):
            media_url({'play': DATA['play']}, 'tiktok')

    def test_detection_bypasses_ytdlp(self):
        with patch('PyEngine.core.tiktok.resolve_video', return_value=DATA), patch('yt_dlp.YoutubeDL', side_effect=AssertionError('TikTok must not use yt-dlp')):
            result = _detect_url_info('https://vm.tiktok.com/short/')
        self.assertEqual([f['value'] for f in result['formats']], ['tiktok', 'tiktok_no_watermark'])
        self.assertEqual(result['duration'], '0:30')

    def test_provider_response_and_errors(self):
        for body, valid in [(json.dumps({'code': 0, 'data': DATA}).encode(), True),
                            (b'<html>unavailable</html>', False),
                            (b'{"code": -1, "msg": "try later"}', False),
                            (b'{"code": 0, "data": {"images": []}}', False)]:
            with patch('PyEngine.core.tiktok.urlopen', return_value=Response(body)):
                if valid:
                    self.assertEqual(resolve_video(URL), DATA)
                else:
                    with self.assertRaises(RuntimeError):
                        resolve_video(URL)

    def test_download_and_cleanup(self):
        for body, total, cancelled, success in [(MP4, len(MP4), False, True), (b'<html>error</html>', 18, False, False), (MP4, 9999, False, False), (MP4, len(MP4), True, False)]:
            with tempfile.TemporaryDirectory() as folder, patch('PyEngine.workers.tiktok.resolve_video', return_value=DATA), patch('PyEngine.workers.tiktok.urlopen', return_value=Response(body, total)):
                worker = TikTokDownloadWorker(URL, Path(folder), 'tiktok_no_watermark')
                worker.on_finished = Mock()
                worker.on_progress = Mock()
                if cancelled:
                    worker.stop()
                worker._run()
                self.assertEqual(worker.on_finished.call_args.args[0], success)
                self.assertEqual(len(list(Path(folder).glob('*.mp4'))), int(success))
                self.assertEqual(list(Path(folder).glob('*.part')), [])
                if success:
                    worker.on_progress.assert_called_with(100)

    def test_cancel_during_transfer_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as folder, patch('PyEngine.workers.tiktok.resolve_video', return_value=DATA), patch('PyEngine.workers.tiktok.urlopen', return_value=Response(MP4)):
            worker = TikTokDownloadWorker(URL, Path(folder))
            worker.on_progress = lambda _: worker.stop()
            worker.on_finished = Mock()
            worker._run()
            self.assertFalse(worker.on_finished.call_args.args[0])
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_non_tiktok_keeps_existing_engine(self):
        with tempfile.TemporaryDirectory() as folder, patch('PyEngine.handlers.download.DownloadWorker') as worker, patch('PyEngine.handlers.download.TikTokDownloadWorker') as tiktok:
            handle_start_download({'url': 'https://youtube.com/watch?v=test', 'output_dir': folder, 'format_type': 'mp4'})
            worker.return_value.start.assert_called_once()
            tiktok.assert_not_called()

    def test_incomplete_transfer_retries_and_reports_completion_once(self):
        worker = TikTokDownloadWorker(URL, Path(tempfile.gettempdir()))
        worker.on_finished = Mock()
        with patch.object(worker, '_download_once', side_effect=[RuntimeError('incomplete'), Path('video.mp4')]) as download, patch.object(worker._cancelled, 'wait'):
            worker._run()
        self.assertEqual(download.call_count, 2)
        self.assertEqual(download.call_args_list[0].kwargs, {'prefer_hd': True})
        self.assertEqual(download.call_args_list[1].kwargs, {'prefer_hd': False})
        worker.on_finished.assert_called_once_with(True, '', 'video.mp4')

    def test_detection_marks_missing_versions_and_preserves_file_size(self):
        with patch('PyEngine.core.tiktok.resolve_video', return_value={'play': DATA['play'], 'size': 12345}):
            info = _detect_url_info(URL)
        self.assertFalse(info['formats'][0]['available'])
        self.assertTrue(info['formats'][1]['available'])
        self.assertEqual(info['formats'][1]['filesize'], 12345)
