import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateUpdateManifest, collectAssets } from './generate-update-manifest.mjs';
import { verifyUpdaterSignature } from './updater-signature.mjs';

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'converter-release-test-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = Buffer.alloc(8, 7);
  const packet = Buffer.concat([Buffer.from('Ed'), keyId, publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]);
  const encodedKey = Buffer.from(`untrusted comment: test key\n${packet.toString('base64')}\n`).toString('base64');
  const bytes = Buffer.from('artifact payload');
  const rawSignature = sign(null, createHash('blake2b512').update(bytes).digest(), privateKey);
  const comment = 'timestamp:123\tfile:artifact';
  const globalSignature = sign(null, Buffer.concat([rawSignature, Buffer.from(comment)]), privateKey);
  const signature = Buffer.from(`untrusted comment: test signature\n${Buffer.concat([Buffer.from('ED'), keyId, rawSignature]).toString('base64')}\ntrusted comment: ${comment}\n${globalSignature.toString('base64')}\n`).toString('base64');
  for (const name of ['Converter_1.2.3_amd64.AppImage', 'Converter_1.2.3_x64-setup.exe']) {
    writeFileSync(path.join(directory, name), bytes);
    writeFileSync(path.join(directory, `${name}.sig`), signature);
  }
  writeFileSync(path.join(directory, 'Converter_1.2.3_windows_x64_portable.zip'), Buffer.from('PK\x03\x04test archive'));
  return { directory, encodedKey, bytes, signature };
}

function withFixture(callback) {
  const f = fixture();
  try { callback(f); } finally { rmSync(f.directory, { recursive: true, force: true }); }
}
const generate = f => generateUpdateManifest(collectAssets(f.directory), '1.2.3', 'owner/repo', f.encodedKey);

test('generates one manifest containing both cryptographically verified updater targets', () => withFixture(f => {
  const manifest = generate(f);
  assert.deepEqual(Object.keys(manifest.platforms), ['linux-x86_64', 'windows-x86_64']);
  assert.match(manifest.platforms['linux-x86_64'].url, /\/v1\.2\.3\/Converter_1\.2\.3_amd64\.AppImage$/);
}));
test('rejects corrupted AppImage payload before publication', () => withFixture(f => {
  writeFileSync(path.join(f.directory, 'Converter_1.2.3_amd64.AppImage'), 'corrupted');
  assert.throws(() => generate(f), /signature verification failed/);
}));
test('rejects a signature from a different public key', () => withFixture(f => {
  const other = fixture();
  try { assert.throws(() => verifyUpdaterSignature(f.bytes, f.signature, other.encodedKey), /verification failed/); }
  finally { rmSync(other.directory, { recursive: true, force: true }); }
}));
test('rejects missing Windows portable archive', () => withFixture(f => {
  rmSync(path.join(f.directory, 'Converter_1.2.3_windows_x64_portable.zip'));
  assert.throws(() => generate(f), /Expected one release asset/);
}));
test('rejects ambiguous installer selection', () => withFixture(f => {
  writeFileSync(path.join(f.directory, 'Other_1.2.3_x64-setup.exe'), f.bytes);
  assert.throws(() => generate(f), /found 2/);
}));
test('rejects tampered authenticated signature comment', () => withFixture(f => {
  const modified = Buffer.from(f.signature, 'base64').toString().replace('timestamp:123', 'timestamp:456');
  assert.throws(() => verifyUpdaterSignature(f.bytes, Buffer.from(modified).toString('base64'), f.encodedKey), /trusted comment verification failed/);
}));

test('Linux-only releases require neither Windows artifacts nor a portable ZIP', () => withFixture(f => {
  for (const name of ['Converter_1.2.3_x64-setup.exe', 'Converter_1.2.3_x64-setup.exe.sig', 'Converter_1.2.3_windows_x64_portable.zip']) rmSync(path.join(f.directory, name));
  const manifest = generateUpdateManifest(collectAssets(f.directory), '1.2.3', 'owner/repo', f.encodedKey, { requiredPlatforms: ['linux-x86_64'], requirePortable: false, tag: 'linux-v1.2.3' });
  assert.match(manifest.platforms['linux-x86_64'].url, /\/linux-v1\.2\.3\//);
  assert.deepEqual(Object.keys(manifest.platforms), ['linux-x86_64']);
}));

test('preserves tracked release notes in the updater manifest', () => withFixture(f => {
  const notes = '# Linux release\n\nSigned portable update.';
  const manifest = generateUpdateManifest(collectAssets(f.directory), '1.2.3', 'owner/repo', f.encodedKey, { requiredPlatforms: ['linux-x86_64'], notes });
  assert.equal(manifest.notes, notes);
}));
