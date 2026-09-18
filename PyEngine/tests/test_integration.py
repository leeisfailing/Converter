"""Real media and loopback HTTP regressions; no external services are used."""
import json
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import wave
from itertools import count
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from PyEngine.core.config import find_binary
from PyEngine.formats.audio import AUDIO_OUTPUT_FORMATS
from PyEngine.formats.detection import detect_file_type
from PyEngine.formats.photo import PHOTO_OUTPUT_FORMATS
from PyEngine.formats.video import VIDEO_OUTPUT_FORMATS
from PyEngine.workers.converter import ConverterWorker
from PyEngine.workers.downloader import DownloadWorker, yt_dlp

ROOT = Path(__file__).resolve().parents[2]
FFMPEG = find_binary("ffmpeg")
FFPROBE = find_binary("ffprobe")


def run_worker(worker, timeout=30):
    results = []
    worker.on_finished = lambda *result: results.append(result)
    worker.start()
    worker._thread.join(timeout)
    if worker._thread.is_alive():
        worker.stop()
        worker._thread.join(5)
        raise AssertionError("Worker did not finish within the timeout")
    if len(results) != 1:
        raise AssertionError(f"Expected one completion event, got {results}")
    return results[0]


@unittest.skipUnless(shutil.which(FFMPEG) and shutil.which(FFPROBE), "FFmpeg/ffprobe required")
class MediaIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="converter-media-")
        cls.directory = Path(cls.temp.name)
        cls.audio = cls.directory / "source.wav"
        with wave.open(str(cls.audio), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(44100)
            output.writeframes(b"\0" * 44100 * 4)
        cls.video = cls.directory / "source.mp4"
        subprocess.run(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
             "testsrc2=size=64x64:rate=25:duration=1", "-i", str(cls.audio),
             "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(cls.video)],
            check=True, capture_output=True, timeout=30,
        )
        cls.photo = cls.directory / "source.png"
        subprocess.run(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", str(cls.video),
             "-frames:v", "1", str(cls.photo)], check=True, capture_output=True, timeout=30,
        )

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def assert_valid_media(self, path, stream_type):
        result = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(path)],
            check=True, text=True, capture_output=True, timeout=15,
        )
        self.assertIn(stream_type, [stream["codec_type"] for stream in json.loads(result.stdout)["streams"]])

    def test_all_advertised_conversion_formats(self):
        cases = [(self.video, VIDEO_OUTPUT_FORMATS, "video"),
                 (self.audio, AUDIO_OUTPUT_FORMATS, "audio"),
                 (self.photo, PHOTO_OUTPUT_FORMATS, "video")]
        for source, formats, stream_type in cases:
            for output_format in formats:
                with self.subTest(source=source.suffix, output=output_format):
                    output = self.directory / f"{source.stem}-{source.suffix[1:]}.{output_format}"
                    ok, message, path = run_worker(ConverterWorker(str(source), str(output), output_format))
                    self.assertTrue(ok, message)
                    self.assertEqual(Path(path).resolve(), output.resolve())
                    self.assert_valid_media(output, stream_type)

    def test_gpu_enabled_conversions_and_reduction(self):
        from PyEngine.core.gpu import detect_gpu
        from PyEngine.workers.reducer import ReducerWorker
        gpu_available = detect_gpu()["available"]
        source = self.directory / "gpu-source.mp4"
        subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc2=size=320x240:rate=15:duration=1", "-c:v", "libx264", str(source)],
                       check=True, capture_output=True, timeout=30)
        for fmt, options in VIDEO_OUTPUT_FORMATS.items():
            if options["vcodec"] not in ("libx264", "gif"):
                continue
            with self.subTest(fmt=fmt):
                output = self.directory / ("gpu-output." + fmt)
                ok, message, _ = run_worker(ConverterWorker(str(source), str(output), fmt, use_gpu=True))
                if not gpu_available and options["vcodec"] != "gif":
                    self.assertFalse(ok)
                    self.assertIn("No working GPU", message)
                    self.assertFalse(output.exists())
                    continue
                self.assertTrue(ok, message)
                self.assert_valid_media(output, "video")
        output = self.directory / "gpu-reduced.mp4"
        ok, message, _ = run_worker(ReducerWorker(str(source), str(output), use_gpu=True))
        if not gpu_available:
            self.assertFalse(ok)
            self.assertIn("No working GPU", message)
            self.assertFalse(output.exists())
            return
        self.assertTrue(ok, message)
        self.assert_valid_media(output, "video")

    def test_manual_encoders_through_engine_protocol(self):
        from PyEngine.core.gpu import detect_gpu
        source = self.directory / "manual-source.mp4"
        subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i",
                        "testsrc2=size=320x240:rate=15:duration=1", "-c:v", "libx264", str(source)],
                       check=True, capture_output=True, timeout=30)
        for encoder in detect_gpu()["all_encoders"]:
            for command in ("start_convert", "start_transcoder"):
                with self.subTest(encoder=encoder["id"], command=command):
                    output = self.directory / (command + encoder["id"] + ".mp4")
                    request = {"cmd": command, "input": str(source), "output": str(output),
                               "format": "mp4", "file_type": "video", "quality": 50,
                               "use_gpu": False, "preferred_encoder": encoder["id"]}
                    # Keep stdin open like the app: EOF deliberately cancels active work.
                    with tempfile.TemporaryFile(mode='w+') as errors:
                        process = subprocess.Popen([sys.executable, str(ROOT / "PyEngine/__main__.py")],
                                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                                   stderr=errors, text=True)
                        messages = queue.Queue()
                        reader = threading.Thread(target=lambda: [messages.put(line) for line in process.stdout], daemon=True)
                        reader.start()
                        try:
                            process.stdin.write(json.dumps(request) + "\n")
                            process.stdin.flush()
                            deadline = time.monotonic() + 100
                            while True:
                                response = json.loads(messages.get(timeout=max(0.1, deadline - time.monotonic())))
                                if response.get("type") == "finished":
                                    self.assertTrue(response["ok"], response)
                                    break
                        finally:
                            process.stdin.close()
                            try:
                                process.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                process.wait()
                            reader.join(5)
                            process.stdout.close()
                    info = json.loads(subprocess.check_output([FFPROBE, "-v", "error", "-show_entries",
                                                              "stream=codec_name", "-of", "json", str(output)]))
                    expected = "hevc" if encoder["id"].startswith("hevc") else "av1" if encoder["id"].startswith("av1") else "h264"
                    self.assertEqual(info["streams"][0]["codec_name"], expected)

    def test_m4a_is_detected_as_audio(self):
        output = self.directory / "audio-detection.m4a"
        ok, message, _ = run_worker(ConverterWorker(str(self.audio), str(output), "m4a"))
        self.assertTrue(ok, message)
        self.assertEqual(detect_file_type(str(output)), "audio")

    def test_dev_mode_extracts_audio_from_video(self):
        output = self.directory / "extracted.mp3"
        ok, message, _ = run_worker(ConverterWorker(str(self.video), str(output), "mp3", dev_mode=True))
        self.assertTrue(ok, message)
        self.assert_valid_media(output, "audio")

    def test_conversion_can_cancel_before_encoder_launch(self):
        output = self.directory / "cancelled.mp4"
        worker = ConverterWorker(str(self.video), str(output), "mp4")
        worker.on_progress = lambda _: worker.stop()
        ok, message, _ = run_worker(worker)
        self.assertFalse(ok)
        self.assertIn("cancelled", message)

    def test_dispatch_converts_sequential_jobs_in_one_process(self):
        process = subprocess.Popen(
            [sys.executable, str(ROOT / "PyEngine/__main__.py")], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        messages = queue.Queue()
        stderr_lines = []
        reader = threading.Thread(target=lambda: [messages.put(line) for line in process.stdout], daemon=True)
        drain = threading.Thread(target=lambda: [stderr_lines.append(line) for line in process.stderr], daemon=True)
        reader.start()
        drain.start()
        try:
            for index, (source, fmt) in enumerate([(self.audio, 'flac'), (self.audio, 'm4a'), (self.audio, 'opus'), (self.photo, 'webp'), (self.video, 'gif')]):
                output = self.directory / f"sequential-{index}.{fmt}"
                process.stdin.write(json.dumps({"cmd": "start_convert", "input": str(source),
                                                "output": str(output), "format": fmt}) + "\n")
                process.stdin.flush()
                deadline = time.monotonic() + 90
                while True:
                    try:
                        message = json.loads(messages.get(timeout=max(0.1, deadline - time.monotonic())))
                    except queue.Empty:
                        self.fail(f"Timed out converting {source} to {fmt}; exit code: {process.poll()}\n"
                                  + "".join(stderr_lines))
                    if message.get("ok") is False:
                        self.fail(f"Engine rejected {fmt} conversion: {message}\n" + "".join(stderr_lines))
                    if message.get("type") == "finished":
                        self.assertTrue(message["ok"], message.get("message"))
                        self.assertEqual(Path(message["file_path"]).resolve(), output.resolve())
                        break
            process.stdin.close()
            drain.join(30)
            process.wait(timeout=10)
            self.assertEqual(process.returncode, 0, "".join(stderr_lines))
        finally:
            if not process.stdin.closed:
                process.stdin.close()
            if process.poll() is None:
                process.kill()
                process.wait()
            reader.join(5)
            drain.join(5)
            process.stdout.close()
            process.stderr.close()


class DownloadIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="converter-download-")
        cls.directory = Path(cls.temp.name)
        cls.body = b"converter-local-test\n" * 10000
        source = cls.directory / "source.wav"
        with wave.open(str(source), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(44100)
            output.writeframes(b"\0" * 44100 * 2)
        cls.audio = source.read_bytes()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                body = cls.audio if self.path.endswith(".wav") else cls.body
                self.send_response(200)
                self.send_header("Content-Type", "text/html" if self.path == "/page" else "audio/wav" if self.path.endswith(".wav") else "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                if self.path == "/download":
                    self.send_header("Content-Disposition", 'attachment; filename="safe-download.bin"')
                self.end_headers()
                try:
                    self.wfile.write(body[:100] if self.path == "/truncated" else body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(5)
        cls.temp.cleanup()

    def test_http_download_content_disposition_and_duplicate_names(self):
        with tempfile.TemporaryDirectory(dir=self.directory) as directory, patch("PyEngine.workers.downloader.yt_dlp", None):
            for filename in ("safe-download.bin", "safe-download (1).bin"):
                worker = DownloadWorker(self.base_url + "/download", Path(directory))
                ok, message, path = run_worker(worker)
                self.assertTrue(ok, message)
                self.assertEqual(Path(path).name, filename)
                self.assertEqual(Path(path).read_bytes(), self.body)

    def test_truncated_http_download_fails_and_removes_partial_file(self):
        with tempfile.TemporaryDirectory(dir=self.directory) as directory, patch("PyEngine.workers.downloader.yt_dlp", None):
            worker = DownloadWorker(self.base_url + "/truncated", Path(directory))
            ok, message, _ = run_worker(worker)
            self.assertFalse(ok, message)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_html_fallback_is_not_reported_as_media(self):
        with tempfile.TemporaryDirectory(dir=self.directory) as directory, patch("PyEngine.workers.downloader.yt_dlp", None):
            ok, message, _ = run_worker(DownloadWorker(self.base_url + '/page', Path(directory)))
            self.assertFalse(ok)
            self.assertIn('web page', message)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_cancelled_http_download_removes_partial_file(self):
        with tempfile.TemporaryDirectory(dir=self.directory) as directory, patch("PyEngine.workers.downloader.yt_dlp", None):
            worker = DownloadWorker(self.base_url + "/download", Path(directory))
            worker.on_progress = lambda _: worker.stop()
            # The loopback download can finish before the 0.5s progress throttle.
            # Advance only the worker's clock so cancellation occurs mid-transfer.
            with patch("PyEngine.workers.downloader.time", wraps=time) as clock:
                clock.monotonic.side_effect = count()
                ok, message, _ = run_worker(worker)
            self.assertFalse(ok)
            self.assertIn("cancelled", message)
            self.assertEqual(list(Path(directory).iterdir()), [])

    @unittest.skipUnless(yt_dlp is not None and shutil.which(FFMPEG), "yt-dlp/FFmpeg required")
    def test_ytdlp_original_and_mp3_report_existing_final_files(self):
        for output_format, suffix in (("original", ".wav"), ("mp3", ".mp3")):
            with self.subTest(format=output_format), tempfile.TemporaryDirectory(dir=self.directory) as directory:
                worker = DownloadWorker(self.base_url + "/source.wav", Path(directory), output_format)
                with patch.object(worker, "_download_http_fallback", side_effect=AssertionError("Unexpected HTTP fallback")):
                    ok, message, path = run_worker(worker)
                self.assertTrue(ok, message)
                self.assertTrue(Path(path).is_file(), path)
                self.assertEqual(Path(path).suffix, suffix)


if __name__ == "__main__":
    unittest.main()
