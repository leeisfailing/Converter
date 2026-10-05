import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishLinuxRelease, compareStableVersions } from './publish-linux-release.mjs';

async function fixture(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'converter-linux-publish-test-'));
  const events = [];
  const release = { tag_name: 'linux-v1.2.3', draft: false };
  const options = { directory, manifest: { version: '1.2.3' }, repo: 'owner/repo', publicKey: 'pub',
    gh: args => { events.push(args); return JSON.stringify(args.includes('--slurp') ? [] : release); },
    publish: async args => { events.push(['publish', args.tag, args.latest]); },
    validate: async () => { events.push(['validate']); } };
  try { await callback(options, release, events); } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('Linux channel upload happens last after immutable publication and validation', async () => fixture(async (options, release, events) => {
  await publishLinuxRelease(options);
  assert.deepEqual(events.find(event => event[0] === 'publish'), ['publish', 'linux-v1.2.3', false]);
  assert.equal(events.at(-1)[2], 'updater-linux');
  assert.ok(events.at(-1).at(-1).endsWith('latest-linux.json'));
  assert.ok(!events.some(event => event.includes('--latest=true')));
}));
test('validation failure never updates Linux channel', async () => fixture(async (options, release, events) => {
  options.validate = async () => { throw new Error('invalid signature'); };
  await assert.rejects(() => publishLinuxRelease(options), /invalid signature/);
  assert.ok(!events.some(event => event[0] === 'release' && event[1] === 'upload'));
}));
test('channel recovery reverifies published binaries without reuploading or replacing them', async () => fixture(async (options, release, events) => {
  const original = options.gh;
  options.gh = args => args.includes('--slurp') ? JSON.stringify([[release, { tag_name: 'updater-linux' }]]) : original(args);
  options.loadPublishedManifest = async () => ({ version: '1.2.3' });
  await publishLinuxRelease(options);
  assert.ok(!events.some(event => event[0] === 'publish'));
  assert.equal(events.at(-1)[2], 'updater-linux');
}));

test('channel upload failure leaves immutable binary publication intact for recovery', async () => fixture(async (options, release, events) => {
  const original = options.gh;
  options.gh = args => {
    if (args[0] === 'release' && args[1] === 'upload') throw new Error('channel upload failed');
    return original(args);
  };
  await assert.rejects(() => publishLinuxRelease(options), /channel upload failed/);
  assert.ok(events.some(event => event[0] === 'publish' && event[1] === 'linux-v1.2.3'));
  assert.ok(events.some(event => event[0] === 'validate'));
}));

test('refuses an old-tag rerun when Linux channel already points to a newer version', async () => fixture(async (options, release, events) => {
  const original = options.gh;
  options.gh = args => args.includes('--slurp') ? JSON.stringify([[release, { tag_name: 'updater-linux' }]]) : original(args);
  options.loadPublishedManifest = async () => ({ version: '1.2.3' });
  options.loadChannelManifest = async () => ({ version: '1.10.0' });
  await assert.rejects(() => publishLinuxRelease(options), /channel backward/);
  assert.ok(!events.some(event => event[0] === 'release' && event[1] === 'upload'));
}));
test('permits same-version channel recovery after immutable verification', async () => fixture(async (options, release, events) => {
  const original = options.gh;
  options.gh = args => args.includes('--slurp') ? JSON.stringify([[release, { tag_name: 'updater-linux' }]]) : original(args);
  options.loadPublishedManifest = async () => ({ version: '1.2.3' });
  options.loadChannelManifest = async () => ({ version: '1.2.3' });
  await publishLinuxRelease(options);
  assert.equal(events.at(-1)[2], 'updater-linux');
}));
test('compares stable versions numerically without integer overflow', () => {
  assert.equal(compareStableVersions('1.10.0', '1.2.999'), 1);
  assert.equal(compareStableVersions('9007199254740993.0.0', '9007199254740992.999.999'), 1);
  assert.equal(compareStableVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareStableVersions('1.2.3', '1.2.4'), -1);
  assert.throws(() => compareStableVersions('1.2.3-beta', '1.2.3'), /stable semver/);
});
