import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateUpdateManifest } from './validate-update-manifest.mjs';

const REPO = 'leeisfailing/Converter';
const VERSION = '3.0.0';
const SIGNATURE = 'signed-package';
const INSTALLER_BYTES = Buffer.from('pretend installer bytes');
const INSTALLER_DIGEST = `sha256:${createHash('sha256').update(INSTALLER_BYTES).digest('hex')}`;

function fixture() {
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/Converter-setup.exe`;
  const artifactUrl = `https://api.github.com/repos/${REPO}/releases/assets/1001`;
  const signatureUrl = `https://api.github.com/repos/${REPO}/releases/assets/1002`;
  return {
    manifest: { version: VERSION, platforms: { 'windows-x86_64': { url, signature: SIGNATURE } } },
    release: { tag_name: `v${VERSION}`, assets: [
      { name: 'Converter-setup.exe', size: INSTALLER_BYTES.length, state: 'uploaded', browser_download_url: url, url: artifactUrl, digest: INSTALLER_DIGEST },
      { name: 'Converter-setup.exe.sig', size: SIGNATURE.length, state: 'uploaded', browser_download_url: `${url}.sig`, url: signatureUrl },
    ] },
    downloads: { [artifactUrl]: INSTALLER_BYTES, [signatureUrl]: Buffer.from(SIGNATURE) },
  };
}

const artifactUrl = f => f.release.assets[0].url;
const signatureUrl = f => f.release.assets[1].url;

/** Network-free stand-in for the downloader: serves bytes recorded in the fixture. */
function fetchBytesFor(f) {
  return async url => {
    const bytes = f.downloads[url];
    if (!bytes) throw new Error(`unexpected download in test: ${url}`);
    return bytes;
  };
}

function validate(f) {
  return validateUpdateManifest(f.manifest, f.release, VERSION, REPO, { fetchBytes: fetchBytesFor(f) });
}

test('accepts complete release assets and verifies their bytes', async () => {
  const f = fixture();
  await validate(f);
});

test('accepts a signature asset with trailing newline', async () => {
  const f = fixture();
  f.downloads[signatureUrl(f)] = Buffer.from(`${SIGNATURE}\n`);
  await validate(f);
});

for (const [name, mutate] of [
  ['wrong version', f => { f.manifest.version = '2.0.0'; }],
  ['wrong tag', f => { f.release.tag_name = 'v2.0.0'; }],
  ['missing target', f => { f.manifest.platforms = {}; }],
  ['wrong URL', f => { f.manifest.platforms['windows-x86_64'].url = 'https://example.com/setup.exe'; }],
  ['empty signature', f => { f.manifest.platforms['windows-x86_64'].signature = ''; }],
  ['missing binary', f => { f.release.assets.shift(); }],
  ['empty binary', f => { f.release.assets[0].size = 0; }],
  ['unfinished upload', f => { f.release.assets[0].state = 'new'; }],
  ['missing signature asset', f => { f.release.assets.pop(); }],
  ['mismatched asset URL', f => { f.release.assets[0].browser_download_url = 'https://example.com/setup.exe'; }],
]) {
  test(`rejects ${name}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(() => validate(f));
  });
}

test('rejects a signature asset that differs from the manifest signature', async () => {
  const f = fixture();
  f.downloads[signatureUrl(f)] = Buffer.from('garbage-that-was-never-signed');
  await assert.rejects(() => validate(f), /Signature mismatch/);
});

test('rejects an empty signature asset', async () => {
  const f = fixture();
  f.downloads[signatureUrl(f)] = Buffer.alloc(0);
  await assert.rejects(() => validate(f), /is empty/);
});

test('rejects a release asset without a sha256 digest', async () => {
  const f = fixture();
  delete f.release.assets[0].digest;
  await assert.rejects(() => validate(f), /no usable sha256 digest/);
});

test('rejects an unsupported digest format', async () => {
  const f = fixture();
  f.release.assets[0].digest = 'md5:0123456789abcdef0123456789abcdef';
  await assert.rejects(() => validate(f), /no usable sha256 digest/);
});

test('rejects an installer whose bytes do not match the recorded digest', async () => {
  const f = fixture();
  f.downloads[artifactUrl(f)] = Buffer.from('swapped installer payload');
  await assert.rejects(() => validate(f), /Digest mismatch/);
});

test('rejects an installer whose recorded digest was tampered with', async () => {
  const f = fixture();
  f.release.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(() => validate(f), /Digest mismatch/);
});

test('fails closed when an asset cannot be downloaded', async () => {
  const f = fixture();
  delete f.downloads[artifactUrl(f)];
  await assert.rejects(() => validate(f), /Could not download/);
});
