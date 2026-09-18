"""Compare local media jobs against a Git revision, using identical fixtures.

Run: python scripts/benchmark_media.py --compare-ref HEAD --output results.json
No network access or user media is required. Each sample uses a fresh engine.
"""
import argparse
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r'''
import json, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from PyEngine.workers.converter import ConverterWorker
from PyEngine.workers.reducer import ReducerWorker
job, source, output = sys.argv[2:]
if job == 'remux':
    worker = ConverterWorker(source, output, 'mkv')
elif job == 'already_under_target':
    worker = ReducerWorker(source, output, target_bytes=Path(source).stat().st_size)
elif job == 'gpu_reduce':
    worker = ReducerWorker(source, output, use_gpu=True, max_width=640)
elif job == 'gpu_target':
    worker = ReducerWorker(source, output, use_gpu=True, max_width=640, target_bytes=100000)
else:
    raise ValueError(job)
result = []
worker.on_finished = lambda *args: result.append(args)
started = time.perf_counter()
worker._run()
elapsed = time.perf_counter() - started
print(json.dumps({'seconds': elapsed, 'ok': result[0][0], 'error': result[0][1],
                  'bytes': Path(output).stat().st_size if Path(output).exists() else 0,
                  'identical_to_source': Path(output).read_bytes() == Path(source).read_bytes() if Path(output).exists() else False}))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compare-ref', default='HEAD')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.runs < 1:
        parser.error('--runs must be positive')
    ffmpeg = ROOT / 'PyEngine/bin/ffmpeg.exe'
    environment = dict(os.environ)
    environment['PATH'] = str(ffmpeg.parent) + os.pathsep + environment.get('PATH', '')
    result = {'baseline_ref': subprocess.check_output(['git', 'rev-parse', args.compare_ref], cwd=ROOT, text=True).strip(),
              'fixture': '2 seconds, 1280x720, 30 fps, H.264 + AAC', 'runs': args.runs, 'jobs': {}}
    with tempfile.TemporaryDirectory(prefix='converter-benchmark-') as folder:
        directory = Path(folder)
        baseline = directory / 'baseline'
        files = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', args.compare_ref, 'Engine'], cwd=ROOT, text=True).splitlines()
        for name in files:
            if not name.endswith('.py') or '/tests/' in name:
                continue
            destination = baseline / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(subprocess.check_output(['git', 'show', f'{args.compare_ref}:{name}'], cwd=ROOT))
        source = directory / 'source.mp4'
        subprocess.run([str(ffmpeg), '-v', 'error', '-nostdin', '-f', 'lavfi', '-i',
                        'testsrc2=size=1280x720:rate=30:duration=2', '-f', 'lavfi', '-i',
                        'sine=frequency=440:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast',
                        '-c:a', 'aac', str(source)], check=True, capture_output=True, timeout=60)
        for job in ('remux', 'already_under_target', 'gpu_reduce', 'gpu_target'):
            samples = {'baseline': [], 'current': []}
            for index in range(args.runs):
                # Interleave revisions to reduce temperature/cache bias.
                for label, checkout in [('baseline', baseline), ('current', ROOT)]:
                    suffix = '.mkv' if job == 'remux' else '.mp4'
                    output = directory / f'{job}-{label}-{index}{suffix}'
                    run = subprocess.run([sys.executable, '-c', HARNESS, str(checkout), job, str(source), str(output)],
                                         cwd=directory, env=environment, capture_output=True, text=True, timeout=120)
                    if run.returncode:
                        raise RuntimeError(run.stderr)
                    sample = json.loads(run.stdout)
                    if not sample['ok']:
                        raise RuntimeError(sample['error'])
                    samples[label].append(sample)
            medians = {label: statistics.median(s['seconds'] for s in rows) for label, rows in samples.items()}
            result['jobs'][job] = {'samples': samples, 'median_seconds': medians,
                                   'speedup': medians['baseline'] / medians['current']}
            print(f"{job}: {medians['baseline']:.3f}s -> {medians['current']:.3f}s ({result['jobs'][job]['speedup']:.2f}x)", flush=True)
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
