import io
import json
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

from Engine.core import ipc
from Engine.formats.detection import detect_file_type

ROOT = Path(__file__).resolve().parents[2]


class EngineTests(unittest.TestCase):
    def test_dispatch_handles_multiple_commands_and_bad_input(self):
        commands = [[], {"cmd": "missing"}, {"cmd": "detect_file", "path": str(ROOT / "README.md")}]
        result = subprocess.run(
            [sys.executable, str(ROOT / "Engine/__main__.py")],
            input="\n".join(map(json.dumps, commands)) + "\n",
            text=True, capture_output=True, check=True, timeout=15,
        )
        responses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([r["ok"] for r in responses], [False, False, True])

    def test_file_detection_does_not_import_download_dependencies(self):
        from Engine.__main__ import _load_handler
        _load_handler.cache_clear()
        with patch("Engine.__main__.import_module") as load:
            _load_handler("detect_file")
            _load_handler("detect_file")
        load.assert_called_once_with("Engine.handlers.file")
        _load_handler.cache_clear()

    def test_threaded_responses_remain_valid_json_lines(self):
        stream = io.StringIO()
        with patch.object(ipc.sys, "stdout", stream):
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(lambda index: ipc.send_response({"index": index, "text": "ไทย"}), range(100)))
        messages = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual({m["index"] for m in messages}, set(range(100)))

    def test_container_detection_recognizes_webp_wave_and_ogg_audio(self):
        with tempfile.TemporaryDirectory() as folder:
            cases = [
                ("picture.bin", b"RIFF\0\0\0\0WEBP", "photo"),
                ("sound.bin", b"RIFF\0\0\0\0WAVE", "audio"),
                ("sound.ogg", b"OggS" + b"\0" * 24 + b"OpusHead", "audio"),
            ]
            for name, content, expected in cases:
                path = Path(folder) / name
                path.write_bytes(content)
                self.assertEqual(detect_file_type(str(path)), expected)

    def test_repeated_download_progress_is_coalesced(self):
        from Engine.workers.downloader import DownloadWorker
        worker = DownloadWorker("https://example.com/video", Path(tempfile.gettempdir()))
        worker.on_progress = Mock()
        for value in [0, 0, 25, 25, 25, 100, 100]:
            worker._report_progress(value)
        self.assertEqual([args[0][0] for args in worker.on_progress.call_args_list], [0, 25, 100])

    def test_cancelled_download_never_uses_http_fallback(self):
        from Engine.workers.downloader import DownloadWorker
        worker = DownloadWorker("https://example.com/video", Path(tempfile.gettempdir()))
        worker.on_finished = Mock()
        def cancel_download():
            worker.stop()
            raise RuntimeError("Cancelled")
        with patch("Engine.workers.downloader.yt_dlp", object()), patch.object(worker, "_download_with_ytdlp", side_effect=cancel_download), patch.object(worker, "_download_http_fallback") as fallback:
            worker._run()
        fallback.assert_not_called()
        worker.on_finished.assert_called_once_with(False, "Download was cancelled", "")

    def test_converter_stop_terminates_blocked_encoder(self):
        from Engine.workers.converter import ConverterWorker
        worker = ConverterWorker("in.mp4", "out.mp4", "mp4")
        process = Mock()
        process.poll.return_value = None
        worker._process = process
        worker.stop()
        process.terminate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
