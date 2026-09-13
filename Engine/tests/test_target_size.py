import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from Engine.core.config import find_binary
from Engine.workers.reducer import ReducerWorker


class TargetSizeTests(unittest.TestCase):
    def test_complete_media_fits_target(self):
        cases = [
            ('video', '.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15',
                              '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3',
                              '-c:v', 'libx264', '-c:a', 'aac'], 60_000),
            ('audio', '.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3'], 24_000),
            ('photo', '.webp', ['-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1'], 5_000),
        ]
        with tempfile.TemporaryDirectory() as folder:
            for kind, ext, args, target in cases:
                with self.subTest(kind=kind):
                    source = Path(folder) / (kind + ('.wav' if kind == 'audio' else '.png' if kind == 'photo' else '.mp4'))
                    output = Path(folder) / ('reduced-' + kind + ext)
                    subprocess.run([find_binary('ffmpeg'), '-v', 'error', '-y', *args, str(source)], check=True, timeout=30)
                    original = source.read_bytes()
                    results = []
                    worker = ReducerWorker(str(source), str(output), file_type=kind, target_bytes=target)
                    worker.on_finished = lambda *result: results.append(result)
                    worker._run()
                    self.assertTrue(results[0][0], results)
                    self.assertGreater(output.stat().st_size, 0)
                    self.assertLessEqual(output.stat().st_size, target)
                    self.assertEqual(source.read_bytes(), original)
                    if kind == 'photo':
                        info = json.loads(subprocess.check_output([find_binary('ffprobe'), '-v', 'error',
                            '-show_entries', 'stream=width,height', '-of', 'json', str(output)]))
                        self.assertEqual((info['streams'][0]['width'], info['streams'][0]['height']), (640, 480))
                    if kind != 'photo':
                        info = json.loads(subprocess.check_output([find_binary('ffprobe'), '-v', 'error',
                            '-show_entries', 'format=duration', '-of', 'json', str(output)]))
                        self.assertAlmostEqual(float(info['format']['duration']), 3, delta=0.2)
                    # An impossible budget must not replace an existing output.
                    before = output.read_bytes()
                    failed = []
                    worker = ReducerWorker(str(source), str(output), file_type=kind, target_bytes=1)
                    worker.on_finished = lambda *result: failed.append(result)
                    worker._run()
                    self.assertFalse(failed[0][0])
                    self.assertEqual(output.read_bytes(), before)
                    self.assertFalse(list(Path(folder).glob('.reduce-*')))
                    if kind == 'video':
                        # Already-small MP4 files should never suffer a second encode.
                        worker = ReducerWorker(str(source), str(output), file_type=kind, target_bytes=len(original))
                        worker._run()
                        self.assertEqual(output.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
