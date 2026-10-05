import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateUpdateManifest, defaultFetchBytes } from './validate-update-manifest.mjs';

const REPO = 'leeisfailing/Converter';
const VERSION = '3.0.0';
const SIGNATURE = 'signed-package';
const INSTALLER_BYTES = Buffer.from('pretend installer bytes');
const INSTALLER_DIGEST = `sha256:${createHash('sha256').update(INSTALLER_BYTES).digest('hex')}`;

function fixture() {
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/Converter-setup.exe`;
  const artifactUrl = `https://api.github.com/repos/${REPO}/releases/assets/1001`;
  const signatureUrl = `https://api.github.com/repos/${REPO}/releases/assets/1002`;
  const linuxUrl = `https://github.com/${REPO}/releases/download/v${VERSION}/Converter_3.0.0_amd64.AppImage`;
  const linuxArtifactUrl = `https://api.github.com/repos/${REPO}/releases/assets/1003`;
  const linuxSignatureUrl = `https://api.github.com/repos/${REPO}/releases/assets/1004`;
  return {
    manifest: { version: VERSION, platforms: { 'windows-x86_64': { url, signature: SIGNATURE }, 'linux-x86_64': { url: linuxUrl, signature: SIGNATURE } } },
    release: { tag_name: `v${VERSION}`, assets: [
      { name: 'Converter-setup.exe', size: INSTALLER_BYTES.length, state: 'uploaded', browser_download_url: url, url: artifactUrl, digest: INSTALLER_DIGEST },
      { name: 'Converter-setup.exe.sig', size: SIGNATURE.length, state: 'uploaded', browser_download_url: `${url}.sig`, url: signatureUrl },
      { name: 'Converter_3.0.0_amd64.AppImage', size: INSTALLER_BYTES.length, state: 'uploaded', browser_download_url: linuxUrl, url: linuxArtifactUrl, digest: INSTALLER_DIGEST },
      { name: 'Converter_3.0.0_amd64.AppImage.sig', size: SIGNATURE.length, state: 'uploaded', browser_download_url: `${linuxUrl}.sig`, url: linuxSignatureUrl },
    ] },
    downloads: { [artifactUrl]: INSTALLER_BYTES, [signatureUrl]: Buffer.from(SIGNATURE), [linuxArtifactUrl]: INSTALLER_BYTES, [linuxSignatureUrl]: Buffer.from(SIGNATURE) },
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
  return validateUpdateManifest(f.manifest, f.release, VERSION, REPO, { requiredPlatforms: ['windows-x86_64', 'linux-x86_64'], fetchBytes: fetchBytesFor(f) });
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

test('rejects release missing Linux updater target', async () => {
  const f = fixture();
  delete f.manifest.platforms['linux-x86_64'];
  await assert.rejects(() => validate(f), /linux-x86_64/);
});

test('rejects corrupted Linux AppImage bytes', async () => {
  const f = fixture();
  f.downloads[f.release.assets[2].url] = Buffer.from('corrupted AppImage');
  await assert.rejects(() => validate(f), /linux-x86_64/);
});

for (const hostile of [
  'https://api.github.com.evil.test/repos/leeisfailing/Converter/releases/assets/1001',
  'https://api.github.com@evil.test/repos/leeisfailing/Converter/releases/assets/1001',
  'https://evil.test@api.github.com/repos/leeisfailing/Converter/releases/assets/1001',
  'http://api.github.com/repos/leeisfailing/Converter/releases/assets/1001',
  'https://api.github.com/repos/attacker/repo/releases/assets/1001',
  'https://api.github.com/repos/leeisfailing/Converter/releases/assets/not-a-number',
  'https://github.com/attacker/repo/releases/download/v3.0.0/asset',
]) {
  for (const index of [0, 1, 2, 3]) {
    test(`rejects hostile asset URL before fetch: ${index} ${hostile}`, async () => {
      const f = fixture();
      f.release.assets[index].url = hostile;
      let downloads = 0;
      await assert.rejects(() => validateUpdateManifest(f.manifest, f.release, VERSION, REPO, {
        fetchBytes: async () => { downloads++; return Buffer.alloc(0); },
      }), /Untrusted download URL/);
      assert.equal(downloads, 0);
    });
  }
}

test('drops token explicitly when GitHub API redirects to asset CDN', async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'synthetic-test-token';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/test' } })
      : new Response('artifact');
  };
  try {
    await defaultFetchBytes(`https://api.github.com/repos/${REPO}/releases/assets/1001`);
    assert.equal(calls[0].options.headers.authorization, 'Bearer synthetic-test-token');
    assert.equal(calls[1].options.headers.authorization, undefined);
    assert.equal(calls[0].options.redirect, 'manual');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = previousToken;
  }
});

test('validates a Linux-only manifest when explicitly requested', async () => {
  const f = fixture();
  delete f.manifest.platforms['windows-x86_64'];
  await validateUpdateManifest(f.manifest, f.release, VERSION, REPO, { requiredPlatforms: ['linux-x86_64'], fetchBytes: fetchBytesFor(f) });
});

test('preserves default Windows-only validation for the unchanged Windows release workflow', async () => {
  const f = fixture();
  delete f.manifest.platforms['linux-x86_64'];
  await validateUpdateManifest(f.manifest, f.release, VERSION, REPO, { fetchBytes: fetchBytesFor(f) });
});
