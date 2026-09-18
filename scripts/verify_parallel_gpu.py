"""Run AMD and NVIDIA video jobs simultaneously through each sidecar engine."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    ffmpeg = ROOT / 'PyEngine/bin/ffmpeg.exe'
    ffprobe = ROOT / 'PyEngine/bin/ffprobe.exe'
    env = dict(os.environ)
    env['PATH'] = str(ffmpeg.parent) + os.pathsep + env['PATH']
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / 'source.mp4'
        subprocess.run([str(ffmpeg), '-v', 'error', '-f', 'lavfi', '-i',
                        'testsrc2=s=1280x720:r=30:d=8', '-c:v', 'libx264', '-preset', 'ultrafast', str(source)],
                       check=True, capture_output=True, timeout=60)
        for engine, command in [('cpp', [str(ROOT / 'cpp_engine/build/gpu_engine.exe')]),
                                ('python', [sys.executable, '-m', 'PyEngine'])]:
            for operation in ['start_transcoder', 'start_upscale']:
                processes = []
                events = queue.Queue()
                started = time.monotonic()
                def reader(process, encoder):
                    for line in process.stdout:
                        event = json.loads(line)
                        if event.get('type') == 'finished':
                            events.put((encoder, event))
                try:
                    for encoder in ['h264_nvenc', 'h264_amf']:
                        output = Path(folder) / f'{engine}-{operation}-{encoder}.mp4'
                        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                                   stderr=subprocess.DEVNULL, text=True, env=env, cwd=ROOT,
                                                   creationflags=0x08000000)
                        processes.append((process, encoder, output))
                        threading.Thread(target=reader, args=(process, encoder), daemon=True).start()
                    # Both children are alive before either job is dispatched.
                    assert all(process.poll() is None for process, _, _ in processes)
                    for process, encoder, output in processes:
                        process.stdin.write(json.dumps(dict(cmd=operation, input=str(source), output=str(output),
                                                            file_type='video', target='2k', quality=50,
                                                            use_gpu=True, selected_gpu=encoder)) + '\n')
                        process.stdin.flush()
                    for _ in processes:
                        encoder, event = events.get(timeout=60)
                        assert event.get('ok'), (encoder, event)
                    for process, encoder, output in processes:
                        info = json.loads(subprocess.check_output([str(ffprobe), '-v', 'error', '-show_streams', '-of', 'json', str(output)], timeout=15))
                        tag = info['streams'][0].get('tags', {}).get('encoder', '')
                        assert encoder in tag, (encoder, tag)
                    print(f'{engine} {operation}: AMD + NVIDIA simultaneous requests PASS ({time.monotonic() - started:.1f}s)', flush=True)
                finally:
                    for process, _, _ in processes:
                        process.stdin.close()
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=10)


if __name__ == '__main__':
    main()
