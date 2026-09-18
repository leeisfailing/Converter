import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

from PyEngine.core.ytdlp_options import javascript_options
from PyEngine.workers.downloader import DownloadWorker
from PyEngine.handlers.url import _detect_url_info
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
                        # cookiesfrombrowser may be present for YouTube URLs
                        # (enables age-restricted content detection)
                        return self.process_ie_result({
                            'id': 'fixture', 'title': 'Fixture', 'extractor': 'fixture',
                            'webpage_url': url, 'formats': [dict(f) for f in formats],
                        }, download=False)

                self_test = self
                with tempfile.TemporaryDirectory() as folder, \
                     patch('yt_dlp.YoutubeDL', FixtureDL):
                    result = _detect_url_info('https://youtu.be/fixture')
                self.assertTrue(result['ok'])
                self.assertEqual(result['title'], 'Fixture')

    def test_private_deno_wins_over_system_node(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Path(folder) / 'deno.exe'
            runtime.touch()
            with patch('PyEngine.core.ytdlp_options.find_binary', return_value=str(runtime)) as find:
                self.assertEqual(javascript_options(), {'js_runtimes': {'deno': {'path': str(runtime)}}})
                find.assert_called_once_with('deno')

    def test_source_checkout_can_use_node(self):
        with tempfile.TemporaryDirectory() as folder:
            node = Path(folder) / 'node.exe'
            node.touch()
            with patch('PyEngine.core.ytdlp_options.find_binary', side_effect=['missing-deno', str(node)]):
                self.assertEqual(javascript_options(), {'js_runtimes': {'node': {'path': str(node)}}})

    def test_social_links_reach_ytdlp_unchanged(self):
        for url in (
            'https://www.youtube.com/watch?v=9tGvNx4tXKo',
            'https://www.instagram.com/reel/EXAMPLE/',
            'https://x.com/example/status/1234567890',
        ):
            with self.subTest(url=url), tempfile.TemporaryDirectory() as folder:
                output = Path(folder) / 'result.mp4'
                output.write_bytes(b'media')
                api = MagicMock()
                api.YoutubeDL.return_value.__enter__.return_value.extract_info.return_value = {
                    'requested_downloads': [{'filepath': str(output)}],
                }
                worker = DownloadWorker(url, Path(tempfile.gettempdir()), 'best_1080')
                worker.on_finished = Mock()
                with patch('PyEngine.workers.downloader.yt_dlp', api):
                    worker._download_with_ytdlp()
                api.YoutubeDL.return_value.__enter__.return_value.extract_info.assert_called_once_with(url, download=True)
                worker.on_finished.assert_called_once_with(True, '', str(output))

    def test_thumbnail_and_browser_cookie_options_are_valid(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'result.mp4'
            output.write_bytes(b'media')
            api = MagicMock()
            api.YoutubeDL.return_value.__enter__.return_value.extract_info.return_value = {'filepath': str(output)}
            worker = DownloadWorker('https://youtube.com/watch?v=test', Path(folder),
                                    write_thumbnail=True, use_browser_cookies=True)
            with patch('PyEngine.workers.downloader.yt_dlp', api), patch('PyEngine.core.config.resource_path', return_value=Path(folder) / 'no-cookies.txt'):
                worker._download_with_ytdlp()
            options = api.YoutubeDL.call_args.args[0]
            self.assertEqual(options['cookiesfrombrowser'], ('chrome',))
            self.assertTrue(options['writethumbnail'])
            # Construct the actual API: invalid postprocessor keys fail here.
            options.pop('cookiesfrombrowser')
            with yt_dlp.YoutubeDL(options):
                pass

    def test_missing_final_file_is_not_success(self):
        api = MagicMock()
        api.YoutubeDL.return_value.__enter__.return_value.extract_info.return_value = {
            'filepath': 'definitely-missing-media.mp4'}
        api.YoutubeDL.return_value.__enter__.return_value.prepare_filename.return_value = 'also-missing.mp4'
        worker = DownloadWorker('https://example.com/video', Path(tempfile.gettempdir()), 'mp3')
        with patch('PyEngine.workers.downloader.yt_dlp', api):
            with self.assertRaisesRegex(RuntimeError, 'without a final media file'):
                worker._download_with_ytdlp()


if __name__ == '__main__':
    unittest.main()
