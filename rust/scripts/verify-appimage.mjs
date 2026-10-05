import { readdirSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function appImageLayout(config, linux, cargoPackageName) {
  return { binaryName: linux.mainBinaryName ?? config.mainBinaryName ?? cargoPackageName,
    resourceName: linux.productName ?? config.productName ?? cargoPackageName };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {

const directory = path.resolve(process.argv[2]);
const images = readdirSync(directory).filter(name => name.endsWith('.AppImage'));
if (images.length !== 1) throw new Error('Expected exactly one AppImage.');
const staging = mkdtempSync(path.join(tmpdir(), 'converter-appimage-'));
execFileSync(path.join(directory, images[0]), ['--appimage-extract'], { cwd: staging, stdio: 'ignore' });
const appdir = path.join(staging, 'squashfs-root');
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
const linux = JSON.parse(readFileSync(new URL('../src-tauri/tauri.linux.conf.json', import.meta.url)));
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const cargoPackageName = cargo.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
if (!cargoPackageName) throw new Error('Cargo package name is missing.');
const { binaryName, resourceName } = appImageLayout(config, linux, cargoPackageName);
if (!existsSync(path.join(appdir, 'usr/bin', binaryName))) throw new Error(`AppImage is missing main executable ${binaryName}.`);
const resources = path.join(appdir, 'usr/lib', resourceName);
for (const relative of ['PyEngine/__main__.py', 'PyEngine/bin/python/bin/python3', 'gpu_engine']) {
  if (!existsSync(path.join(resources, relative))) throw new Error(`AppImage is missing ${relative}.`);
}
// Execute detached resources using only the AppImage's bundled libraries.
const env = { ...process.env, PATH: path.join(appdir, 'usr/bin'), PYTHONDONTWRITEBYTECODE: '1', LD_LIBRARY_PATH: [path.join(appdir, 'usr/lib'), path.join(appdir, 'usr/lib/x86_64-linux-gnu')].join(':') };
delete env.PYTHONHOME;
delete env.PYTHONPATH;
execFileSync(path.join(resources, 'PyEngine/bin/python/bin/python3'), ['-I', '-B', '-c', 'import ssl, sqlite3, yt_dlp, yt_dlp_ejs, deno, onnxruntime, cv2, numpy'], { env, cwd: resources, stdio: 'inherit' });
for (const name of ['converter-ffmpeg', 'converter-ffprobe']) {
  const tool = path.join(appdir, 'usr/bin', name);
  if (!existsSync(tool)) throw new Error(`AppImage is missing ${name}.`);
  execFileSync(tool, ['-version'], { env, stdio: 'ignore' });
}
// Reuse the detached-runtime harness, but execute the actual extracted package.
const harness = fileURLToPath(new URL('../../scripts/verify_linux_runtime.py', import.meta.url));
const smoke = `
import asyncio, json, os, runpy, sys, tempfile
from pathlib import Path
helpers = runpy.run_path(sys.argv[1])
run = helpers['run']
request_engine = helpers['request_engine']
resources, tools = Path(sys.argv[2]), Path(sys.argv[3])
env = dict(os.environ)
sys.path.insert(0, str(resources))
from PyEngine.core.config import find_binary
for name in ('ffmpeg', 'ffprobe'):
    assert Path(find_binary(name)).resolve().is_relative_to(tools), name
with tempfile.TemporaryDirectory(prefix='AppImage media smoke ') as directory:
    source = Path(directory) / "source 'clip'.mp4"
    run([tools / 'converter-ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
         'testsrc2=size=160x120:rate=10:duration=1', '-c:v', 'libx264', source], env=env)
    for backend, command in (('python', [sys.executable, '-B', resources / 'PyEngine/__main__.py']),
                             ('cpp', [resources / 'gpu_engine'])):
        output = Path(directory) / f'{backend} output.mp4'
        request = {'cmd': 'start_convert', 'input': str(source), 'output': str(output),
                   'format': 'mp4', 'use_gpu': False, 'preferred_encoder': ''}
        asyncio.run(request_engine(command, request, resources, env))
        metadata = json.loads(run([tools / 'converter-ffprobe', '-v', 'error',
                                  '-show_streams', '-of', 'json', output], env=env).stdout)
        assert metadata['streams'][0]['width'] == 160
        reduced = Path(directory) / f'{backend} reduced.mp4'
        request.update(cmd='start_transcoder', output=str(reduced), file_type='video', quality=60)
        asyncio.run(request_engine(command, request, resources, env))
        assert reduced.stat().st_size > 0
`;
execFileSync(path.join(resources, 'PyEngine/bin/python/bin/python3'), ['-I', '-B', '-c', smoke, harness, resources, path.join(appdir, 'usr/bin')], { env, cwd: resources, stdio: 'inherit', timeout: 300_000 });
console.log('Extracted AppImage imports, bundled tools, Python/C++ conversion and reduction verified.');
}
