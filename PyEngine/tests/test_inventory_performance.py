"""Check concurrency and subprocess overhead without timing thresholds."""
import os
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

from PyEngine.core import gpu
from PyEngine.workers.ffmpeg import FfmpegWorker
from PyEngine.workers.target_size import _execute
from PyEngine.core.config import find_binary


class InventoryPerformanceTests(unittest.TestCase):
    def test_target_progress_streams_before_process_exit_and_never_regresses(self):
        worker = FfmpegWorker()
        worker._init_process()
        events = []
        worker.on_progress = lambda percent: events.append((percent, worker._process.poll()))
        command = [find_binary('ffmpeg'), '-v', 'error', '-re', '-f', 'lavfi',
                   '-i', 'color=s=64x64:r=10:d=2', '-f', 'null', '-']
        _execute(worker, command, progress_duration=2, progress_range=(10, 40))
        self.assertTrue(any(10 < percent < 40 and status is None for percent, status in events), events)
        count = len(events)
        _execute(worker, command, progress_duration=2, progress_range=(10, 40))
        self.assertEqual(len(events), count)
        self.assertEqual([percent for percent, _ in events], sorted(set(percent for percent, _ in events)))
        self.assertIsNone(worker._process)

    def test_gpu_inventories_overlap_and_encodes_stay_sequential(self):
        gpu.detect_gpu.cache_clear()
        barrier = threading.Barrier(2)
        def encoders():
            barrier.wait(timeout=5)
            return {"h264_nvenc", "hevc_nvenc"}
        def names():
            barrier.wait(timeout=5)
            return ["NVIDIA Test GPU"]
        caller = threading.get_ident()
        def works(encoder):
            self.assertEqual(threading.get_ident(), caller)
            return True
        try:
            with patch.object(gpu, "_probe_ffmpeg_encoders", side_effect=encoders), patch.object(
                gpu, "_get_system_gpu_names", side_effect=names
            ), patch.object(gpu, "_encoder_works", side_effect=works):
                info = gpu.detect_gpu()
            self.assertEqual(info["encoder"], "h264_nvenc")
            self.assertEqual(info["name"], "NVIDIA Test GPU")
            self.assertEqual([e["id"] for e in info["all_encoders"]],
                             ["h264_nvenc", "hevc_nvenc", "libx264"])
        finally:
            gpu.detect_gpu.cache_clear()

    def test_target_executor_only_captures_probe_output(self):
        worker = FfmpegWorker()
        worker._init_process()
        command = [sys.executable, "-c", "print('metadata')"]
        with patch("PyEngine.workers.target_size.subprocess.Popen", wraps=subprocess.Popen) as spawn:
            self.assertEqual(_execute(worker, command), b"")
            self.assertEqual(spawn.call_args.kwargs["stdout"], subprocess.DEVNULL)
            self.assertEqual(_execute(worker, command, capture_output=True).strip(), b"metadata")
            self.assertEqual(spawn.call_args.kwargs["stdout"], subprocess.PIPE)
        self.assertIsNone(worker._process)

    def test_target_executor_preserves_failure_diagnostics(self):
        worker = FfmpegWorker()
        worker._init_process()
        with self.assertRaisesRegex(RuntimeError, "encode failed"):
            _execute(worker, [sys.executable, "-c",
                              "import sys; sys.stderr.write('encode failed'); sys.exit(2)"])
        self.assertIsNone(worker._process)

    def test_target_executor_names_the_program_when_stderr_is_empty(self):
        worker = FfmpegWorker()
        worker._init_process()
        with self.assertRaises(RuntimeError) as caught:
            _execute(worker, [sys.executable, "-c", "import sys; sys.exit(7)"])
        message = str(caught.exception)
        self.assertIn(os.path.basename(sys.executable), message)
        self.assertIn("exited with code 7", message)
        self.assertIsNone(worker._process)
