import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Canonical SONAMEs only: hashed OpenCV dependencies and private Python resources
// must remain bundled. Keep WebKit, GLib and Harfbuzz with their packaged ABI.
const hostNames = new Set([
  'libgbm.so', 'libdrm.so', 'libfontconfig.so', 'libfreetype.so',
  'libexpat.so', 'libz.so', 'libbz2.so', 'libpng16.so',
  'libbrotlidec.so', 'libbrotlicommon.so',
]);

export function isHostDisplayLibrary(name) {
  return [...hostNames].some(base => name === base || name.startsWith(`${base}.`));
}

export function pruneHostDisplayLibraries(appdir) {
  const removed = [];
  // linuxdeploy uses usr/lib and occasionally a multiarch directory. Never walk
  // application resources or vendored site-packages beneath usr/lib/Converter.
  for (const relative of ['usr/lib', 'usr/lib/x86_64-linux-gnu', 'usr/lib/aarch64-linux-gnu', 'usr/lib64']) {
    const directory = path.join(appdir, relative);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      const filename = path.join(directory, name);
      if (isHostDisplayLibrary(name) && !lstatSync(filename).isDirectory()) {
        rmSync(filename);
        removed.push(`${relative}/${name}`);
      }
    }
  }
  return removed;
}

function checkExtractedFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) checkExtractedFiles(filename);
    else if (!entry.isSymbolicLink() && (entry.name === 'AppRun' || /\.desktop$|\.so(?:\.|$)/.test(entry.name)) && statSync(filename).size === 0) {
      throw new Error(`AppImage extraction produced an empty runtime file: ${filename}`);
    }
  }
}

export function finalizeAppImage({ artifact, plugin, arch, version, run = execFileSync }) {
  if (!existsSync(plugin)) throw new Error(`Tauri AppImage output plugin is missing: ${plugin}`);
  const staging = mkdtempSync(path.join(tmpdir(), 'converter-appimage-final-'));
  try {
    run(artifact, ['--appimage-extract'], { cwd: staging, stdio: 'ignore' });
    const appdir = path.join(staging, 'squashfs-root');
    if (!existsSync(path.join(appdir, 'AppRun'))) throw new Error('Extracted AppImage is missing AppRun.');
    checkExtractedFiles(appdir);
    const removed = pruneHostDisplayLibraries(appdir);
    const output = path.join(staging, path.basename(artifact));
    run(plugin, ['--appimage-extract-and-run', '--appdir', appdir], {
      cwd: staging, stdio: 'inherit',
      env: { ...process.env, ARCH: arch, VERSION: version, LINUXDEPLOY_OUTPUT_VERSION: version, OUTPUT: output, LDAI_OUTPUT: output },
    });
    if (!existsSync(output)) throw new Error('AppImage repack did not produce the final artifact.');
    chmodSync(output, 0o755);
    // Signing is performed by the caller only after these final bytes replace
    // the unsigned intermediate. No old signature may survive this replacement.
    rmSync(`${artifact}.sig`, { force: true });
    const adjacent = `${artifact}.repacked-${process.pid}`;
    try {
      copyFileSync(output, adjacent);
      chmodSync(adjacent, 0o755);
      renameSync(adjacent, artifact);
    } finally { rmSync(adjacent, { force: true }); }
    console.log(`Final AppImage uses host graphics/font libraries (${removed.length} bundled files removed).`);
    return removed;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
