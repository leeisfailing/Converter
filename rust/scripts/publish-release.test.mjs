import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishRelease } from './publish-release.mjs';

async function fixture(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'converter-publish-test-'));
  writeFileSync(path.join(directory, 'latest.json'), '{}');
  const release = { id: 42, tag_name: 'v1.2.3', draft: true, assets: [{ name: 'Converter_1.2.3_windows_x64_portable.zip', state: 'uploaded', size: 4 }] };
  const events = [];
  const options = { directory, manifest: { version: '1.2.3', notes: 'Release' }, repo: 'owner/repo', publicKey: 'public',
    gh: args => { events.push(args.slice(0, 2).join(' ')); return JSON.stringify(args.includes('--slurp') ? [] : release); },
    validate: async () => { events.push('validate'); }, verifyFiles: async () => { events.push('verify bytes'); } };
  try { await callback(options, release, events); } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('publishes only after uploads, signed manifest validation and all byte verification', async () => fixture(async (options, release, events) => {
  await publishRelease(options);
  assert.deepEqual(events, ['api repos/owner/repo/releases?per_page=100', 'release create', 'api repos/owner/repo/releases/tags/v1.2.3', 'release upload', 'api repos/owner/repo/releases/42', 'validate', 'verify bytes', 'release edit']);
}));
test('failed signature validation leaves the release unpublished', async () => fixture(async (options, release, events) => {
  options.validate = async () => { throw new Error('bad signature'); };
  await assert.rejects(() => publishRelease(options), /bad signature/);
  assert.ok(!events.includes('release edit'));
}));
test('failed portable byte verification leaves release unpublished', async () => fixture(async (options, release, events) => {
  options.verifyFiles = async () => { throw new Error('upload differs'); };
  await assert.rejects(() => publishRelease(options), /upload differs/);
  assert.ok(!events.includes('release edit'));
}));
test('rerun resumes existing draft without creating another release', async () => fixture(async (options, release, events) => {
  const original = options.gh;
  options.gh = args => args.includes('--slurp') ? JSON.stringify([[release]]) : original(args);
  await publishRelease(options);
  assert.ok(!events.includes('release create'));
  assert.equal(events.at(-1), 'release edit');
}));
test('rerun refuses to overwrite a published release', async () => fixture(async (options, release, events) => {
  release.draft = false;
  options.gh = () => JSON.stringify([[release]]);
  await assert.rejects(() => publishRelease(options), /already published/);
  assert.deepEqual(events, []);
}));

test('Linux publisher does not require a Windows portable asset', async () => fixture(async (options, release, events) => {
  release.assets = [];
  await publishRelease(options);
  assert.equal(events.at(-1), 'release edit');
}));
