import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyResources, resourcePlan } from './bundle-resources.mjs';

const temporary = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'converter-bundle-'));
  temporary.push(root);
  const write = (name) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, name);
  };
  for (const file of ['engine/main.py', 'engine/helper.py', 'engine/ignored.txt',
    'bin/python/python.exe', 'bin/python/Lib/package.py', 'bin/python/__pycache__/package.pyc',
    'bin/plugins/LSMASHSource.dll', 'gpu_engine.exe', 'bin/ffmpeg-x86_64-pc-windows-msvc.exe']) write(file);
  const config = { bundle: {
    resources: { 'engine/*.py': 'PyEngine/', 'bin/python/': 'PyEngine/bin/python/',
      'bin/plugins/': 'PyEngine/bin/plugins/', 'gpu_engine.exe': 'gpu_engine.exe' },
    externalBin: ['bin/ffmpeg'],
  } };
  return { root, config };
}
afterEach(() => {
  for (const root of temporary.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw new Error('Invalid test cleanup path');
    rmSync(root, { recursive: true, force: true });
  }
});

describe('portable bundle resources', () => {
  it('copies manifest globs, nested runtime, plugins, native engine and renamed sidecars', () => {
    const { root, config } = fixture();
    const destination = path.join(root, 'output');
    copyResources(resourcePlan(root, config), destination);
    for (const file of ['PyEngine/main.py', 'PyEngine/helper.py', 'PyEngine/bin/python/python.exe',
      'PyEngine/bin/python/Lib/package.py', 'PyEngine/bin/plugins/LSMASHSource.dll', 'gpu_engine.exe', 'ffmpeg.exe']) {
      expect(readFileSync(path.join(destination, file), 'utf8')).not.toBe('');
    }
    expect(existsSync(path.join(destination, 'PyEngine/ignored.txt'))).toBe(false);
    expect(existsSync(path.join(destination, 'PyEngine/bin/python/__pycache__'))).toBe(false);
  });
  it('fails before copying when a required engine is missing', () => {
    const { root, config } = fixture();
    config.bundle.resources['missing-engine.exe'] = 'missing-engine.exe';
    expect(() => resourcePlan(root, config)).toThrow('Missing bundle resource');
  });
  it('rejects empty resource globs and missing sidecars', () => {
    const { root, config } = fixture();
    config.bundle.resources['missing/*.py'] = 'missing/';
    expect(() => resourcePlan(root, config)).toThrow('matched no files');
    delete config.bundle.resources['missing/*.py'];
    config.bundle.externalBin.push('bin/ffprobe');
    expect(() => resourcePlan(root, config)).toThrow('Missing Windows sidecar');
  });
  it('rejects resource destinations outside the distribution', () => {
    const { root, config } = fixture();
    config.bundle.resources['gpu_engine.exe'] = '../escaped.exe';
    expect(() => resourcePlan(root, config)).toThrow('must stay inside');
  });
});
