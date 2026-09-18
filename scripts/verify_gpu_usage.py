"""Run a real NVIDIA 4K upscale and sample NVENC/NVDEC usage via nvidia-smi."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from PyEngine.core.config import find_binary
from PyEngine.workers.upscaler import UpscalerWorker


def sample():
    output = subprocess.check_output(['nvidia-smi', '--query-gpu=utilization.gpu,utilization.encoder,utilization.decoder',
                                      '--format=csv,noheader,nounits'], text=True, timeout=5)
    values = [int(value.strip()) for value in output.splitlines()[0].split(',')]
    return dict(zip(('gpu', 'encoder', 'decoder'), values))


def main():
    with tempfile.TemporaryDirectory(prefix='converter-gpu-usage-') as directory:
        source = Path(directory) / '1080p.mp4'
        output = Path(directory) / '4k.mp4'
        subprocess.run([find_binary('ffmpeg'), '-v', 'error', '-nostdin', '-f', 'lavfi', '-i',
                        'testsrc2=size=1920x1080:rate=60:duration=8', '-c:v', 'libx264', '-preset',
                        'ultrafast', str(source)], check=True, capture_output=True, timeout=60)
        worker = UpscalerWorker(str(source), str(output), '4k', preferred_encoder='h264_nvenc')
        command = worker._build_command()
        assert '-hwaccel_output_format' in command
        assert 'scale_cuda=w=3840:h=2160:interp_algo=lanczos' in command
        assert command[command.index('-c:v') + 1] == 'h264_nvenc'
        result = []
        worker.on_finished = lambda *values: result.append(values)
        baseline = sample()
        samples = []
        started = time.perf_counter()
        worker.start()
        try:
            while worker._thread.is_alive():
                if time.perf_counter() - started > 90:
                    raise TimeoutError('GPU upscale exceeded 90 seconds')
                samples.append(sample())
                worker._thread.join(0.25)
        finally:
            if worker._thread.is_alive():
                worker.stop()
                worker._thread.join(10)
        assert result and result[0][0], result
        info = json.loads(subprocess.check_output([find_binary('ffprobe'), '-v', 'error', '-show_streams',
                                                  '-of', 'json', str(output)], timeout=15))['streams'][0]
        assert (info['width'], info['height']) == (3840, 2160)
        assert int(info['nb_frames']) == 480
        peaks = {key: max(s[key] for s in samples) for key in ('gpu', 'encoder', 'decoder')}
        assert peaks['encoder'] > 0 and peaks['decoder'] > 0, peaks
        report = {'seconds': time.perf_counter() - started, 'frames': 480, 'resolution': '3840x2160',
                  'baseline_percent': baseline, 'peak_percent': peaks, 'samples': samples,
                  'pipeline': 'NVDEC -> CUDA Lanczos scaling -> NVENC H.264'}
        destination = ROOT / '.runtime-downloads/gpu-usage.json'
        destination.parent.mkdir(exist_ok=True)
        destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({key: value for key, value in report.items() if key != 'samples'}))


if __name__ == '__main__':
    main()
