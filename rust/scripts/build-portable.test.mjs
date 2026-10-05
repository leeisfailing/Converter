import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from './test-runner.mjs';
import { buildPortable } from './build-portable.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'converter-portable-'));
  for (const file of ['src-tauri/target/release/converter.exe', 'src-tauri/engine/main.py', 'dist/Converter-portable.zip']) {
    const name = path.join(root, file);
    mkdirSync(path.dirname(name), { recursive: true });
    writeFileSync(name, file);
  }
  writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '4.0.10', bundle: {
    resources: { 'engine/main.py': 'PyEngine/main.py' }, externalBin: [],
  } }));
  return root;
}

function withFixture(run) {
  const root = fixture();
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('portable ZIP packages executable/resources and publishes archive only after success', () => withFixture(root => {
  const zip = buildPortable(root, (command, args) => {
    assert.equal(command, 'tar');
    assert.equal(existsSync(path.join(root, 'dist/Converter-portable.zip')), false);
    assert.match(readFileSync(path.join(root, 'dist/portable/converter.exe'), 'utf8'), /converter.exe/);
    assert.match(readFileSync(path.join(root, 'dist/portable/PyEngine/main.py'), 'utf8'), /main.py/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'dist/portable/converter-portable.json'), 'utf8')), { version: '4.0.10', distribution: 'portable' });
    writeFileSync(args[2], Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32)]));
  });
  assert.equal(existsSync(zip), true);
  assert.deepEqual(readdirSync(path.join(root, 'dist')), ['Converter-portable.zip', 'portable']);
}));

test('portable ZIP propagates archive failures and removes old/partial archives', () => withFixture(root => {
  assert.throws(() => buildPortable(root, (_, args) => {
    writeFileSync(args[2], 'partial');
    throw new Error('archive failed');
  }), /archive failed/);
  assert.deepEqual(readdirSync(path.join(root, 'dist')), ['portable']);
}));

test('portable ZIP rejects missing, empty and non-ZIP archives', () => {
  for (const payload of [null, Buffer.alloc(0), Buffer.alloc(40)]) {
    withFixture(root => {
      assert.throws(() => buildPortable(root, (_, args) => {
        if (payload !== null) writeFileSync(args[2], payload);
      }), /archive is missing or empty|archive is not a ZIP/);
      assert.deepEqual(readdirSync(path.join(root, 'dist')), ['portable']);
    });
  }
});

test('portable ZIP missing input removes stale archive and retains previous directory', () => withFixture(root => {
  mkdirSync(path.join(root, 'dist/portable'));
  writeFileSync(path.join(root, 'dist/portable/previous.txt'), 'previous');
  rmSync(path.join(root, 'src-tauri/engine/main.py'));
  assert.throws(() => buildPortable(root), /Missing bundle resource/);
  assert.equal(existsSync(path.join(root, 'dist/Converter-portable.zip')), false);
  assert.equal(readFileSync(path.join(root, 'dist/portable/previous.txt'), 'utf8'), 'previous');
}));
