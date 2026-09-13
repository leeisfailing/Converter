import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

from Engine.core.ytdlp_options import javascript_options
from Engine.workers.downloader import DownloadWorker
from Engine.handlers.url import _detect_url_info
import yt_dlp


class ExtractorSupportTests(unittest.TestCase):
    def test_detection_accepts_split_combined_and_audio_only_formats_without_browser_cookies(self):
        video = {'format_id': 'video', 'url': 'https://example.com/video.mp4',
                 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'none', 'height': 1080}
        audio = {'format_id': 'audio', 'url': 'https://example.com/audio.m4a',
                 'ext': 'm4a', 'vcodec': 'none', 'acodec': 'mp4a'}
        combined = dict(video, format_id='combined', acodec='mp4a')
        for formats in ([audio, video], [combined], [audio]):
            with self.subTest(formats=[f['format_id'] for f in formats]):
                class FixtureDL(yt_dlp.YoutubeDL):
                    def extract_info(self, url, download=False):
                        self_test.assertFalse(download)
                        self_test.assertNotIn('cookiesfrombrowser', self.params)
                        return self.process_ie_result({
                            'id': 'fixture', 'title': 'Fixture', 'extractor': 'fixture',
                            'webpage_url': url, 'formats': [dict(f) for f in formats],
                        }, download=False)

                self_test = self
                with tempfile.TemporaryDirectory() as folder, \
                     patch('yt_dlp.YoutubeDL', FixtureDL), \
                     patch('Engine.handlers.url.resource_path', return_value=Path(folder) / 'cookies.txt'):
                    result = _detect_url_info('https://youtu.be/fixture')
                self.assertTrue(result['ok'])
                self.assertEqual(result['title'], 'Fixture')

    def test_private_deno_wins_over_system_node(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Path(folder) / 'deno.exe'
            runtime.touch()
            with patch('Engine.core.ytdlp_options.find_binary', return_value=str(runtime)) as find:
                self.assertEqual(javascript_options(), {'js_runtimes': {'deno': {'path': str(runtime)}}})
                find.assert_called_once_with('deno')

    def test_source_checkout_can_use_node(self):
        with tempfile.TemporaryDirectory() as folder:
            node = Path(folder) / 'node.exe'
            node.touch()
            with patch('Engine.core.ytdlp_options.find_binary', side_effect=['missing-deno', str(node)]):
                self.assertEqual(javascript_options(), {'js_runtimes': {'node': {'path': str(node)}}})

    def test_social_links_reach_ytdlp_unchanged(self):
        for url in (
            'https://www.youtube.com/watch?v=9tGvNx4tXKo',
            'https://www.tiktok.com/@example/video/1234567890',
            'https://www.instagram.com/reel/EXAMPLE/',
            'https://x.com/example/status/1234567890',
        ):
            with self.subTest(url=url):
                api = MagicMock()
                api.YoutubeDL.return_value.__enter__.return_value.extract_info.return_value = {
                    'requested_downloads': [{'filepath': 'result.mp4'}],
                }
                worker = DownloadWorker(url, Path(tempfile.gettempdir()), 'best_1080')
                worker.on_finished = Mock()
                with patch('Engine.workers.downloader.yt_dlp', api):
                    worker._download_with_ytdlp()
                api.YoutubeDL.return_value.__enter__.return_value.extract_info.assert_called_once_with(url, download=True)
                worker.on_finished.assert_called_once_with(True, '', 'result.mp4')


if __name__ == '__main__':
    unittest.main()
