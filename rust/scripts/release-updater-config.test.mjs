import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { releasePublicKey } from './release-updater-config.mjs';

const windows = { plugins: { updater: { pubkey: 'windows-public-key' } } };
const linux = { plugins: { updater: { pubkey: 'linux-public-key' } } };

test('Linux release key comes only from Linux override', () => {
  assert.equal(releasePublicKey(windows, linux, true), 'linux-public-key');
});
test('Windows release key remains shared config key', () => {
  assert.equal(releasePublicKey(windows, linux, false), 'windows-public-key');
});
test('Linux releases fail rather than falling back to Windows key', () => {
  assert.throws(() => releasePublicKey(windows, {}, true), /Linux updater public key is missing/);
});
