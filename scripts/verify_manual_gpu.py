"""Verify direct C++ and Python requests honor manual NVIDIA/AMD encoders."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from PyEngine.handlers import convert, reduce, upscale


def main():
    ffmpeg = ROOT / 'PyEngine/bin/ffmpeg.exe'
    ffprobe = ROOT / 'PyEngine/bin/ffprobe.exe'
    env = dict(os.environ)
    env['PATH'] = str(ffmpeg.parent) + os.pathsep + env['PATH']
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / 'source.mp4'
        subprocess.run([str(ffmpeg), '-v', 'error', '-f', 'lavfi', '-i',
                        'testsrc2=s=256x256:d=2', '-c:v', 'mpeg4', str(source)],
                       check=True, capture_output=True, timeout=30)
        for encoder in ['h264_amf', 'h264_nvenc']:
            probe = subprocess.run([str(ffmpeg), '-v', 'error', '-f', 'lavfi', '-i',
                                    'color=s=256x256:d=0.1', '-c:v', encoder, '-f', 'null', '-'],
                                   capture_output=True, timeout=30)
            if probe.returncode:
                print(f'SKIP {encoder}: hardware unavailable')
                continue
            for engine in ['cpp', 'python']:
                for module, command in [(convert, 'start_convert'), (reduce, 'start_transcoder'), (upscale, 'start_upscale'), (reduce, 'target_size')]:
                    output = Path(folder) / f'{engine}-{encoder}-{command}.mp4'
                    request = dict(cmd='start_transcoder' if command == 'target_size' else command, input=str(source), output=str(output), format='mp4',
                                   quality=50, file_type='video', target='2k', use_gpu=True, selected_gpu=encoder)
                    if command == 'target_size':
                        request['target_bytes'] = source.stat().st_size // 2
                    if engine == 'python':
                        results = []
                        with patch.object(module, 'send_finished', side_effect=lambda *args: results.append(args)), patch.object(module, 'send_progress'):
                            worker = getattr(module, 'handle_' + request['cmd'])(request)
                            assert worker is not None, results
                            worker._thread.join(45)
                            if worker._thread.is_alive():
                                worker.stop()
                                worker._thread.join(10)
                                raise TimeoutError(request)
                        assert results and results[-1][0], results
                    else:
                        proc = subprocess.Popen([str(ROOT / 'cpp_engine/build/Release/gpu_engine.exe')],
                                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                                text=True, env=env, creationflags=0x08000000)
                        events = queue.Queue()
                        def read_events():
                            for line in proc.stdout:
                                events.put(json.loads(line))
                        reader = threading.Thread(target=read_events, daemon=True)
                        reader.start()
                        try:
                            proc.stdin.write(json.dumps(request) + '\n')
                            proc.stdin.flush()
                            while True:
                                event = events.get(timeout=45)
                                if event.get('type') == 'finished':
                                    break
                            assert event['ok'], event
                        finally:
                            proc.stdin.close()
                            proc.wait(timeout=10)
                            reader.join(timeout=2)
                    info = json.loads(subprocess.check_output([str(ffprobe), '-v', 'error', '-show_streams', '-of', 'json', str(output)], timeout=15))
                    tag = info['streams'][0].get('tags', {}).get('encoder', '')
                    assert encoder in tag, (encoder, tag)
                    print(engine, command, encoder, 'PASS', flush=True)


if __name__ == '__main__':
    main()
