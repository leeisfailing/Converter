import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isHostDisplayLibrary, pruneHostDisplayLibraries, finalizeAppImage } from './appimage-host-libraries.mjs';

test('canonical display libraries are excluded without matching hashed Python dependencies', () => {
  for (const name of ['libfontconfig.so.1', 'libgbm.so.1.0.0', 'libdrm.so.2', 'libfreetype.so.6', 'libexpat.so.1', 'libz.so.1', 'libbrotlidec.so.1']) assert.equal(isHostDisplayLibrary(name), true, name);
  for (const name of ['libdrm-b0291a67.so.2.4.0', 'libpng16-529cb57a.so.16.58.0', 'libharfbuzz.so.0', 'libglib-2.0.so.0', 'libwebkit2gtk-4.1.so.0', 'libavcodec.so.60']) assert.equal(isHostDisplayLibrary(name), false, name);
});

test('pruning covers global multiarch libraries and symlinks while preserving private runtime', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'appimage-prune-test-'));
  try {
    const privateDir = path.join(root, 'usr/lib/Converter/PyEngine/bin/python/lib');
    mkdirSync(privateDir, { recursive: true });
    mkdirSync(path.join(root, 'usr/lib/x86_64-linux-gnu'));
    writeFileSync(path.join(root, 'usr/lib/libfontconfig.so.1'), 'old');
    symlinkSync('libfontconfig.so.1', path.join(root, 'usr/lib/libfontconfig.so'));
    writeFileSync(path.join(root, 'usr/lib/x86_64-linux-gnu/libgbm.so.1'), 'old');
    writeFileSync(path.join(root, 'usr/lib/libdrm-hashed.so.2'), 'vendor');
    writeFileSync(path.join(privateDir, 'libz.so.1'), 'private');
    assert.equal(pruneHostDisplayLibraries(root).length, 3);
    assert.equal(existsSync(path.join(root, 'usr/lib/libfontconfig.so.1')), false);
    assert.equal(readFileSync(path.join(privateDir, 'libz.so.1'), 'utf8'), 'private');
    assert.equal(readFileSync(path.join(root, 'usr/lib/libdrm-hashed.so.2'), 'utf8'), 'vendor');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('finalizer repacks pruned AppDir before replacing bytes and removes stale signatures', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'appimage-final-test-'));
  try {
    const artifact = path.join(root, 'app.AppImage');
    const plugin = path.join(root, 'plugin');
    writeFileSync(artifact, 'unsigned');
    writeFileSync(`${artifact}.sig`, 'stale');
    writeFileSync(plugin, 'stub');
    let calls = 0;
    finalizeAppImage({ artifact, plugin, arch: 'x86_64', version: '4.0.10', run(command, args, options) {
      calls++;
      if (command === artifact) {
        assert.deepEqual(args, ['--appimage-extract']);
        mkdirSync(path.join(options.cwd, 'squashfs-root/usr/lib'), { recursive: true });
        writeFileSync(path.join(options.cwd, 'squashfs-root/AppRun'), 'original hook');
        writeFileSync(path.join(options.cwd, 'squashfs-root/usr/lib/libgbm.so.1'), 'old');
      } else {
        assert.equal(command, plugin);
        assert.equal(existsSync(path.join(args[2], 'usr/lib/libgbm.so.1')), false);
        assert.equal(readFileSync(path.join(args[2], 'AppRun'), 'utf8'), 'original hook');
        assert.equal(readFileSync(artifact, 'utf8'), 'unsigned');
        assert.equal(options.env.ARCH, 'x86_64');
        writeFileSync(options.env.LDAI_OUTPUT, 'final bytes');
      }
    } });
    assert.equal(calls, 2);
    assert.equal(readFileSync(artifact, 'utf8'), 'final bytes');
    assert.equal(existsSync(`${artifact}.sig`), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing repacked output fails without replacing the original artifact', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'appimage-final-fail-'));
  try {
    const artifact = path.join(root, 'app.AppImage');
    const plugin = path.join(root, 'plugin');
    writeFileSync(artifact, 'original'); writeFileSync(plugin, 'stub');
    assert.throws(() => finalizeAppImage({ artifact, plugin, run(command, args, options) {
      if (command === artifact) { mkdirSync(path.join(options.cwd, 'squashfs-root')); writeFileSync(path.join(options.cwd, 'squashfs-root/AppRun'), 'hook'); }
    } }), /did not produce/);
    assert.equal(readFileSync(artifact, 'utf8'), 'original');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
