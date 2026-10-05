import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
if (process.platform !== 'linux') throw new Error('AppImage packaging requires Linux.');
execFileSync('npm', ['run', 'setup:linux'], { cwd: root, stdio: 'inherit' });
const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`;
const runtime = path.join(root, 'src-tauri/bin/linux/python');
function libraries(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? libraries(filename) : /\.so(?:\.|$)/.test(entry.name) ? [filename] : [];
  });
}
const binaries = [path.join(runtime, 'bin/python3'), ...libraries(runtime),
  path.join(root, '../cpp_engine/build-linux/gpu_engine'),
  ...['ffmpeg', 'ffprobe'].map(name => path.join(root, `src-tauri/bin/converter-${name}-${triple}`))];
const files = {};
// Bundle dependencies of all media binaries and Python extensions. glibc and
// GPU drivers remain host-provided, as required by AppImage's compatibility model.
const hostLibraries = /^(?:ld-linux|libc\.|libm\.|libpthread\.|libdl\.|librt\.|libresolv\.|libnss_|libcuda\.|libnvidia|libGLX_nvidia)/;
for (const binary of binaries) {
  const output = execFileSync('ldd', [binary], { encoding: 'utf8' });
  if (/=> not found/.test(output)) throw new Error(`Unresolved shared library for ${binary}: ${output}`);
  for (const match of output.matchAll(/=>\s+(\/[^\s]+)\s+\(/g)) {
    const source = match[1];
    const name = path.basename(source);
    if (hostLibraries.test(name) || realpathSync(source).startsWith(realpathSync(runtime) + path.sep)) continue;
    const target = `usr/lib/${name}`;
    if (files[target] && realpathSync(files[target]) !== realpathSync(source)) throw new Error(`Conflicting shared library: ${name}`);
    files[target] = source;
  }
}
const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.linux.conf.json')));
config.bundle.linux.appimage.files = files;
const buildArgs = process.argv.slice(2);
if (buildArgs.includes('--unsigned')) config.bundle.createUpdaterArtifacts = false;
const staging = mkdtempSync(path.join(tmpdir(), 'converter-appimage-config-'));
const configPath = path.join(staging, 'linux.json');
writeFileSync(configPath, JSON.stringify(config));
console.log(`Bundling ${Object.keys(files).length} media runtime libraries.`);
execFileSync('npm', ['run', 'tauri', '--', 'build', '--bundles', 'appimage', '--config', configPath, ...buildArgs.filter(argument => argument !== '--unsigned')], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, NO_STRIP: process.env.NO_STRIP ?? '1', APPIMAGE_EXTRACT_AND_RUN: process.env.APPIMAGE_EXTRACT_AND_RUN ?? '1' },
});
