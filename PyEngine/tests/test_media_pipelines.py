"""Exercise actual media, frame memory, muxing, and output preservation."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PyEngine.core.config import find_binary
from PyEngine.core.gpu import detect_gpu
from PyEngine.tests.test_integration import run_worker
from PyEngine.workers.converter import ConverterWorker
from PyEngine.workers.reducer import ReducerWorker
from PyEngine.workers.upscaler import UpscalerWorker


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="converter-pipelines-")
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / "source.mp4"
        cls.ffmpeg = find_binary("ffmpeg")
        cls.encode(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=0.3',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3',
                    '-c:v', 'libx264', '-c:a', 'aac', str(cls.source)])
        cls.photo = cls.root / "photo.png"
        cls.encode(['-i', str(cls.source), '-frames:v', '1', str(cls.photo)])

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @classmethod
    def encode(cls, args):
        result = subprocess.run([cls.ffmpeg, '-v', 'error', '-nostdin', '-y', *args],
                                capture_output=True, timeout=60)
        if result.returncode:
            raise AssertionError(result.stderr.decode(errors='replace'))

    def streams(self, output):
        result = subprocess.check_output([find_binary('ffprobe'), '-v', 'error',
                                          '-show_streams', '-of', 'json', str(output)], timeout=15)
        return json.loads(result)['streams']

    def check_worker(self, worker, width, height):
        ok, message, path = run_worker(worker, timeout=60)
        self.assertTrue(ok, message)
        stream = self.streams(path)[0]
        self.assertEqual((stream['width'], stream['height']), (width, height))
        return stream

    def test_upscale_cpu_and_every_working_hardware_encoder(self):
        for info in detect_gpu()['all_encoders']:
            encoder = info['id']
            with self.subTest(encoder=encoder):
                output = self.root / (encoder + '-upscale.mp4')
                worker = UpscalerWorker(str(self.source), str(output), '2k', preferred_encoder=encoder)
                stream = self.check_worker(worker, 2560, 1440)
                expected = 'hevc' if encoder.startswith('hevc') else 'av1' if encoder.startswith('av1') else 'h264'
                self.assertEqual(stream['codec_name'], expected)

    def test_reported_1080p_to_4k_gpu_pipeline(self):
        if not any(e['id'] == 'h264_nvenc' for e in detect_gpu()['all_encoders']):
            self.skipTest('Working NVIDIA encoder required')
        source = self.root / '1080p.mp4'
        self.encode(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60:duration=0.05',
                     '-c:v', 'libx264', '-preset', 'ultrafast', str(source)])
        worker = UpscalerWorker(str(source), str(self.root / '4k.mp4'), '4k', use_gpu=True)
        self.assertIn('scale_cuda=w=3840:h=2160:interp_algo=lanczos', worker._build_command())
        self.check_worker(worker, 3840, 2160)

    def test_photo_upscale_with_gpu_setting_and_rgb_video_conversion(self):
        self.check_worker(UpscalerWorker(str(self.photo), str(self.root / 'photo-2k.png'),
                                         '2k', file_type='photo', use_gpu=True), 2560, 1440)
        for use_gpu in ([False, True] if detect_gpu()['available'] else [False]):
            with self.subTest(use_gpu=use_gpu):
                self.check_worker(ConverterWorker(str(self.photo), str(self.root / f'photo-video-{use_gpu}.mp4'),
                                                  'mp4', use_gpu=use_gpu), 320, 240)

    def test_copy_preserves_video_packets_and_converts_incompatible_audio(self):
        source = self.root / 'flac-source.mkv'
        self.encode(['-i', str(self.source), '-c:v', 'copy', '-c:a', 'flac', str(source)])
        output = self.root / 'remux.flv'
        worker = ConverterWorker(str(source), str(output), 'flv')
        args = worker._build_command()
        self.assertEqual(args[args.index('-c:v') + 1], 'copy')
        self.assertEqual(args[args.index('-c:a') + 1], 'aac')
        self.assertNotIn('-hwaccel', args)
        self.check_worker(worker, 320, 240)
        self.assertEqual(self.streams(output)[1]['codec_name'], 'aac')
        def packet_hashes(path):
            result = subprocess.check_output([find_binary('ffprobe'), '-v', 'error', '-select_streams', 'v:0',
                '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', str(path)], timeout=15)
            return [p['data_hash'] for p in json.loads(result)['packets']]
        self.assertEqual(packet_hashes(source), packet_hashes(output))

    def test_resize_disables_copy(self):
        for use_gpu in ([False, True] if detect_gpu()['available'] else [False]):
            with self.subTest(use_gpu=use_gpu):
                worker = ConverterWorker(str(self.source), str(self.root / f'resized-{use_gpu}.mp4'),
                                         'mp4', use_gpu=use_gpu)
                worker.max_width = 160
                args = worker._build_command()
                self.assertNotEqual(args[args.index('-c:v') + 1], 'copy')
                self.check_worker(worker, 160, 120)

    def test_missing_gpu_rejects_video_jobs_without_creating_output(self):
        from PyEngine.core import gpu
        output = self.root / 'missing-gpu.mp4'
        workers = [
            ConverterWorker(str(self.photo), str(output), 'mp4', use_gpu=True),
            ConverterWorker(str(self.source), str(output), 'mp4', use_gpu=True),
            ReducerWorker(str(self.source), str(output), use_gpu=True),
            UpscalerWorker(str(self.source), str(output), '2k', use_gpu=True),
        ]
        workers[1].max_width = 160
        with patch.object(gpu, '_encoder_works', return_value=False):
            for worker in workers:
                with self.subTest(worker=type(worker).__name__, source=worker.input_path):
                    with patch.object(worker, '_execute') as execute:
                        ok, message, _ = run_worker(worker)
                    self.assertFalse(ok)
                    self.assertIn('No working GPU', message)
                    execute.assert_not_called()
                    self.assertFalse(output.exists())

    def test_hardware_failure_never_switches_to_cpu(self):
        from PyEngine.workers.ffmpeg import FfmpegError
        worker = UpscalerWorker(str(self.source), str(self.root / 'gpu-failure.mp4'), '2k', use_gpu=True)
        command = [self.ffmpeg, '-y', '-i', str(self.source), '-c:v', 'h264_nvenc', worker.output_path]
        with patch.object(worker, '_build_command', return_value=command), patch.object(worker, '_execute', side_effect=FfmpegError('GPU unavailable')) as execute:
            ok, message, _ = run_worker(worker)
        self.assertFalse(ok)
        self.assertIn('GPU unavailable', message)
        execute.assert_called_once()
        self.assertFalse(Path(worker.output_path).exists())

    def test_target_size_uses_each_working_gpu_without_cpu_video_encoding(self):
        from PyEngine.workers import target_size
        source = self.root / 'target-source.mp4'
        self.encode(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15:duration=3',
                     '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                     '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', str(source)])
        available = [e['id'] for e in detect_gpu()['all_encoders'] if e['id'] != 'libx264']
        if not available:
            self.skipTest('Working GPU encoder required')
        for encoder in available:
            with self.subTest(encoder=encoder):
                output = self.root / f'target-{encoder}.mp4'
                worker = ReducerWorker(str(source), str(output), target_bytes=60000, preferred_encoder=encoder)
                with patch.object(target_size, '_execute', wraps=target_size._execute) as execute:
                    stream = self.check_worker(worker, 320, 240)
                self.assertLessEqual(output.stat().st_size, 60000)
                self.assertAlmostEqual(float(stream['duration']), 3, delta=0.2)
                commands = [call.args[1] for call in execute.call_args_list]
                video_commands = [cmd for cmd in commands if '-c:v' in cmd]
                self.assertTrue(video_commands)
                for command in video_commands:
                    self.assertEqual(command[command.index('-c:v') + 1], encoder)
                    self.assertNotIn('-pass', command)
                    self.assertNotIn('libx264', command)

    def test_failure_and_cancel_preserve_existing_output_for_all_workers(self):
        broken = self.root / 'broken.mp4'
        broken.write_bytes(b'not media')
        output = self.root / 'protected.mp4'
        for factory in [lambda src: ConverterWorker(src, str(output), 'mp4'),
                        lambda src: ReducerWorker(src, str(output)),
                        lambda src: UpscalerWorker(src, str(output), '2k')]:
            for cancelled in [False, True]:
                output.write_bytes(b'existing result')
                worker = factory(str(self.source if cancelled else broken))
                if cancelled:
                    worker.on_progress = lambda _: worker.stop()
                ok, message, _ = run_worker(worker)
                self.assertFalse(ok, message)
                self.assertEqual(output.read_bytes(), b'existing result')
                self.assertFalse(list(self.root.glob('.convert-*')))

    def test_target_size_does_not_run_trial_encode_or_gpu_detection(self):
        output = self.root / 'already-small.mp4'
        worker = ReducerWorker(str(self.source), str(output), target_bytes=self.source.stat().st_size, use_gpu=True)
        with patch.object(worker, '_build_command', side_effect=AssertionError('Unnecessary trial encode')):
            self.check_worker(worker, 320, 240)
        self.assertEqual(output.read_bytes(), self.source.read_bytes())
