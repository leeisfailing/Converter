import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PyEngine.core.config import find_binary
from PyEngine.workers.reducer import ReducerWorker


class TargetSizeTests(unittest.TestCase):
    def test_hardware_resolution_retries_change_bitrate_and_preserve_encoder(self):
        from PyEngine.workers import target_size
        for encoder in ('h264_nvenc', 'h264_amf'):
            with self.subTest(encoder=encoder), tempfile.TemporaryDirectory() as folder:
                source = Path(folder) / 'source.mp4'
                source.write_bytes(b'x' * 100000)
                output = Path(folder) / 'output.mp4'
                worker = ReducerWorker(str(source), str(output), target_bytes=60000, preferred_encoder=encoder)
                trials = []
                fallback_rates = []
                def execute(worker, command, **kwargs):
                    if kwargs.get('capture_output'):
                        return json.dumps({'streams': [{'codec_type': 'video', 'codec_name': 'h264',
                            'pix_fmt': 'yuv420p', 'width': 640}], 'format': {'duration': '3'}}).encode()
                    self.assertEqual(command[command.index('-c:v') + 1], encoder)
                    self.assertNotIn('-pass', command)
                    trials.append(command)
                    size = 120000
                    if len(trials) > 12:
                        self.assertEqual(command[command.index('-rc') + 1], 'vbr' if encoder.endswith('_nvenc') else 'vbr_peak')
                        self.assertNotIn('-qp', command)
                        rate = int(command[command.index('-b:v') + 1])
                        fallback_rates.append(rate)
                        size = int(72000 * rate / fallback_rates[0])
                    Path(command[-1]).write_bytes(b'x' * size)
                    return b''
                with patch.object(target_size, '_execute', side_effect=execute), patch.object(target_size, 'get_video_encoder', return_value=encoder):
                    target_size.reduce_to_target(worker)
                self.assertGreaterEqual(len(fallback_rates), 2)
                self.assertLess(fallback_rates[1], fallback_rates[0])
                self.assertLessEqual(output.stat().st_size, 60000)

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
                    output = (Path(folder) / ('reduced-' + kind + ext)).resolve()
                    subprocess.run([find_binary('ffmpeg'), '-v', 'error', '-y', *args, str(source)], check=True, timeout=30)
                    original = source.read_bytes()
                    results = []
                    worker = ReducerWorker(str(source), str(output), file_type=kind, target_bytes=target, use_gpu=False)
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
                        results = []
                        worker = ReducerWorker(str(source), str(output), file_type=kind, target_bytes=len(original))
                        worker.on_finished = lambda *r: results.append(r)
                        worker._run()
                        self.assertTrue(results[0][0], results[0][1])
                        self.assertEqual(output.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
