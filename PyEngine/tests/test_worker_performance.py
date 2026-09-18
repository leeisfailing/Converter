"""Regression coverage for bounded logs and unnecessary subprocess work."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PyEngine.workers.ffmpeg import FfmpegWorker, FfmpegError
from PyEngine.workers.reducer import ReducerWorker
from PyEngine.workers.upscaler import UpscalerWorker


class WorkerPerformanceTests(unittest.TestCase):
    def test_non_cuda_encoders_do_not_probe(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "input.mp4"
            source.touch()
            output = str(Path(folder) / "output.mp4")
            for encoder in ("libx264", "h264_qsv", "h264_amf", "h264_nvenc"):
                for module, factory in (
                    ("reducer", lambda: ReducerWorker(str(source), output)),
                    ("upscaler", lambda: UpscalerWorker(str(source), output, "2k")),
                ):
                    with self.subTest(encoder=encoder, worker=module):
                        with patch("PyEngine.core.gpu.get_video_encoder", return_value=encoder), patch(
                            f"PyEngine.workers.{module}.probe_media",
                            return_value={"vcodec": "h264", "pix_fmt": "yuv420p"},
                        ) as probe:
                            command = factory()._build_command()
                        self.assertEqual(probe.call_count, int(encoder.endswith("_nvenc")))
                        self.assertEqual("-hwaccel" in command, encoder.endswith("_nvenc"))

    def test_unterminated_diagnostics_are_bounded_and_keep_error_tail(self):
        worker = FfmpegWorker()
        worker._init_process()
        with self.assertRaisesRegex(FfmpegError, "final diagnostic"):
            worker._execute([sys.executable, "-c",
                "import sys; sys.stderr.write('x' * 2_000_000 + 'final diagnostic'); sys.exit(3)"])
        self.assertLessEqual(len(worker._stderr_lines), 100)
        self.assertTrue(all(len(line) <= 4096 for line in worker._stderr_lines))
        self.assertIsNone(worker._process)

    def test_carriage_return_progress_and_cancellation(self):
        worker = FfmpegWorker()
        worker._init_process()
        progress = []
        def report(value):
            progress.append(value)
            if value > 10:
                worker.stop()
        worker.on_progress = report
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            worker._execute([sys.executable, "-c",
                "import sys,time; sys.stderr.write('Duration: 00:00:10.00\\rtime=00:00:05.00\\rnext\\n'); sys.stderr.flush(); time.sleep(10)"])
        self.assertIn(54, progress)
        self.assertIsNone(worker._process)
