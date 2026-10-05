import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishRelease } from './publish-release.mjs';

async function fixture(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'converter-publish-test-'));
  writeFileSync(path.join(directory, 'latest.json'), '{}');
  const release = { id: 42, tag_name: 'v1.2.3', draft: true, assets: [{ name: 'Converter_1.2.3_windows_x64_portable.zip', state: 'uploaded', size: 4 }] };
  const events = [];
  const options = { directory, manifest: { version: '1.2.3', notes: 'Release' }, repo: 'owner/repo', publicKey: 'public',
    gh: args => { events.push(args.slice(0, 2).join(' ')); if (args[0] === 'release' && args[1] === 'view') return JSON.stringify({ databaseId: release.id });
      if (args[0] === 'api' && args[1].includes('/releases/tags/')) throw new Error('Draft by-tag lookup must not be used.');
      return JSON.stringify(args.includes('--slurp') ? [] : release); },
    validate: async () => { events.push('validate'); }, verifyFiles: async () => { events.push('verify bytes'); } };
  try { await callback(options, release, events); } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('publishes only after uploads, signed manifest validation and all byte verification', async () => fixture(async (options, release, events) => {
  await publishRelease(options);
  assert.deepEqual(events, ['api repos/owner/repo/releases?per_page=100', 'release create', 'release view', 'api repos/owner/repo/releases/42', 'release upload', 'api repos/owner/repo/releases/42', 'validate', 'verify bytes', 'release edit']);
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

for (const [label, args] of [['Linux', ['--linux-only']], ['default', []]]) {
  test(`${label} publisher CLI finishes module loading and reaches GitHub CLI`, () => {
    if (process.platform === 'win32') return; // Executable stub targets the Linux release runner.
    const directory = mkdtempSync(path.join(tmpdir(), 'converter-publisher-cli-test-'));
    try {
      writeFileSync(path.join(directory, 'latest.json'), JSON.stringify({ version: '1.2.3', notes: 'Test' }));
      writeFileSync(path.join(directory, 'gh'), `#!${process.execPath}\nprocess.stderr.write('publisher-gh-sentinel\\n');\nprocess.exit(42);\n`, { mode: 0o700 });
      const env = { ...process.env, GITHUB_REPOSITORY: 'example/project', PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}` };
      for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']) delete env[name];
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./publish-release.mjs', import.meta.url)), directory, ...args], {
        env, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /publisher-gh-sentinel/);
      assert.doesNotMatch(result.stderr, /unsettled top-level await/i);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('creates drafts using GitHub CLI database ID rather than REST tag lookup', async () => fixture(async (options, release, events) => {
  await publishRelease(options);
  assert.ok(events.includes('release view'));
  assert.ok(events.includes('api repos/owner/repo/releases/42'));
  assert.ok(!events.some(event => event.includes('/releases/tags/')));
}));
