import io
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

from PyEngine.core import ipc
from PyEngine.formats.detection import detect_file_type

ROOT = Path(__file__).resolve().parents[2]


class EngineTests(unittest.TestCase):
    def test_dispatch_accepts_next_job_while_finished_callback_returns(self):
        from PyEngine import __main__ as dispatcher
        from PyEngine.workers.converter import ConverterWorker

        worker = ConverterWorker("in.mp4", "out.mp4", "mp4")
        finished = threading.Event()
        release = threading.Event()

        def on_finished(*result):
            finished.set()
            release.wait(5)

        worker.on_finished = on_finished
        with patch.object(worker, "_perform"), \
             patch.dict(dispatcher._current_worker, {'start_convert': worker}, clear=True):
            worker.start()
            try:
                self.assertTrue(finished.wait(5))
                self.assertTrue(worker._thread.is_alive())
                self.assertFalse(dispatcher._has_active_worker())
                self.assertFalse(dispatcher._current_worker)
            finally:
                release.set()
                worker._thread.join(5)

    def test_dispatch_handles_multiple_commands_and_bad_input(self):
        commands = [[], {"cmd": "missing"}, {"cmd": "detect_file", "path": str(ROOT / "README.md")}]
        result = subprocess.run(
            [sys.executable, str(ROOT / "PyEngine/__main__.py")],
            input="\n".join(map(json.dumps, commands)) + "\n",
            text=True, capture_output=True, check=True, timeout=15,
        )
        responses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([r["ok"] for r in responses], [False, False, True])

    def test_file_detection_does_not_import_download_dependencies(self):
        from PyEngine.__main__ import _load_handler
        _load_handler.cache_clear()
        with patch("PyEngine.__main__.import_module") as load:
            _load_handler("detect_file")
            _load_handler("detect_file")
        load.assert_called_once_with("PyEngine.handlers.file")
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
        from PyEngine.workers.downloader import DownloadWorker
        worker = DownloadWorker("https://example.com/video", Path(tempfile.gettempdir()))
        worker.on_progress = Mock()
        for value in [0, 0, 25, 25, 25, 100, 100]:
            worker._report_progress(value)
        self.assertEqual([args[0][0] for args in worker.on_progress.call_args_list], [0, 25, 100])

    def test_cancelled_download_never_uses_http_fallback(self):
        from PyEngine.workers.downloader import DownloadWorker
        worker = DownloadWorker("https://example.com/video", Path(tempfile.gettempdir()))
        worker.on_finished = Mock()
        def cancel_download():
            worker.stop()
            raise RuntimeError("Cancelled")
        with patch("PyEngine.workers.downloader.yt_dlp", object()), patch.object(worker, "_download_with_ytdlp", side_effect=cancel_download), patch.object(worker, "_download_http_fallback") as fallback:
            worker._run()
        fallback.assert_not_called()
        worker.on_finished.assert_called_once_with(False, "Download was cancelled", "")

    def test_converter_stop_terminates_blocked_encoder(self):
        from PyEngine.workers.converter import ConverterWorker
        worker = ConverterWorker("in.mp4", "out.mp4", "mp4")
        process = Mock()
        process.poll.return_value = None
        worker._process = process
        worker.stop()
        process.terminate.assert_called_once()

    def test_dispatch_rejects_overlapping_work_without_losing_cancel_handle(self):
        from PyEngine import __main__ as dispatcher
        worker = Mock()
        worker._thread.is_alive.return_value = True
        with patch.dict(dispatcher._current_worker, {'start_convert': worker}, clear=True), \
             patch.object(dispatcher.sys, 'stdin', io.StringIO('{"cmd":"start_transcoder"}\n')), \
             patch.object(dispatcher, '_load_handler') as load, \
             patch.object(dispatcher, 'send_response') as respond, \
             patch.object(dispatcher, '_cleanup_workers'):
            dispatcher.run_interactive_mode()
            load.assert_not_called()
            self.assertIn('already in progress', respond.call_args.args[0]['error'])
            self.assertIs(dispatcher._current_worker['start_convert'], worker)


if __name__ == "__main__":
    unittest.main()
