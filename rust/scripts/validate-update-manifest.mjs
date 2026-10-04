import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resolveRepository } from './resolve-repository.mjs';

/** Where to download a release asset from: the API URL (works for drafts) or the public URL. */
function assetUrl(asset) {
  if (typeof asset.url === 'string' && asset.url) return asset.url;
  if (typeof asset.browser_download_url === 'string' && asset.browser_download_url) return asset.browser_download_url;
  return null;
}

/**
 * Download a release asset as raw bytes. GitHub token comes from GH_TOKEN /
 * GITHUB_TOKEN when present; it is only ever sent as an Authorization header,
 * never logged.
 */
async function defaultFetchBytes(url) {
  const headers = { 'user-agent': 'converter-release-verify' };
  if (/^https:\/\/api\.github\.com\//.test(url)) headers.accept = 'application/octet-stream';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, { headers, redirect: 'follow' });
  } catch (error) {
    throw new Error(`network error while downloading ${url}: ${error instanceof Error ? error.message : error}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} while downloading ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function download(fetchBytes, url, label) {
  let bytes;
  try {
    bytes = await fetchBytes(url);
  } catch (error) {
    throw new Error(`Could not download ${label} to verify it: ${error instanceof Error ? error.message : error}`);
  }
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  return bytes;
}

/** Compare signature text independent of line endings / whitespace (base64 ignores it). */
function normalizeSignature(bytes, label) {
  const text = Buffer.from(bytes).toString('utf8');
  if (text.includes('\uFFFD')) throw new Error(`${label} is not valid UTF-8; refusing to treat it as an updater signature.`);
  return text.replace(/^\uFEFF/, '').replace(/\s+/g, '');
}

/** The GitHub asset digest must be a sha256 digest, otherwise there is nothing to verify against. */
function sha256DigestHex(digest, name) {
  const value = typeof digest === 'string' ? digest.trim() : '';
  const match = /^sha256[:=]([0-9a-fA-F]{64})$/.exec(value);
  if (!match) {
    const found = value ? `"${value}"` : 'nothing';
    throw new Error(`Release asset ${name} has no usable sha256 digest (${found}); its uploaded bytes cannot be verified. Refusing to publish.`);
  }
  return match[1].toLowerCase();
}

async function verifySignatureAsset({ platform, name, artifact, sigAsset }, fetchBytes) {
  const url = assetUrl(sigAsset);
  if (!url) throw new Error(`Signature asset ${name}.sig has no download URL.`);
  const downloaded = normalizeSignature(await download(fetchBytes, url, `signature asset ${name}.sig`), `${name}.sig`);
  if (!downloaded) throw new Error(`The uploaded signature asset ${name}.sig is empty; re-upload it before publishing.`);
  const expected = String(artifact.signature).replace(/\s+/g, '');
  if (downloaded !== expected) {
    throw new Error(
      `Signature mismatch for ${platform}: the manifest signature for ${name} does not match the uploaded ${name}.sig asset. `
        + 'Refusing to publish an updater manifest that is not backed by the uploaded signature.'
    );
  }
}

async function verifyArtifactBytes({ platform, name, asset }, fetchBytes) {
  const expected = sha256DigestHex(asset.digest, name);
  const url = assetUrl(asset);
  if (!url) throw new Error(`Updater asset ${name} has no download URL.`);
  const bytes = await download(fetchBytes, url, name);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `Digest mismatch for ${platform}: the bytes of ${name} do not match the sha256 digest recorded for the release asset. `
        + 'The uploaded installer may have been replaced; refusing to publish.'
    );
  }
}

/**
 * Validate the updater manifest against the release it describes.
 *
 * Structural checks (version, tag, URLs, uploaded state) run first, then the
 * content of every artifact is verified: the uploaded `.sig` asset must equal
 * `artifact.signature`, and the artifact bytes must hash to the `sha256`
 * digest GitHub recorded for the asset. Anything unverifiable fails closed.
 *
 * @param {object} manifest parsed latest.json
 * @param {object} release release object from the GitHub API (assets included)
 * @param {string} version app version the manifest must describe
 * @param {string} repo `owner/repository` the download URLs must belong to
 * @param {{ fetchBytes?: (url: string) => Promise<Buffer> }} [options] fetchBytes is injectable for tests
 */
export async function validateUpdateManifest(manifest, release, version, repo, options = {}) {
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  if (manifest.version !== version) throw new Error('Updater manifest version does not match the app.');
  if (release.tag_name !== `v${version}`) throw new Error('Release tag does not match the app.');
  if (!manifest.platforms || typeof manifest.platforms !== 'object') throw new Error('Updater platforms are missing.');
  if (!manifest.platforms['windows-x86_64']) throw new Error('Windows x64 updater artifact is missing.');
  const assets = new Map((release.assets ?? []).map(asset => [asset.name, asset]));
  const prefix = `https://github.com/${repo}/releases/download/v${version}/`;
  const targets = [];
  for (const [platform, artifact] of Object.entries(manifest.platforms)) {
    if (!artifact || typeof artifact.url !== 'string' || !artifact.url.startsWith(prefix)) {
      throw new Error(`Unexpected download URL for ${platform}.`);
    }
    const name = decodeURIComponent(artifact.url.slice(prefix.length));
    const asset = assets.get(name);
    if (!asset || asset.size <= 0 || asset.state !== 'uploaded') throw new Error(`Missing or incomplete updater asset: ${name}.`);
    if (asset.browser_download_url !== artifact.url) throw new Error(`Updater URL does not match uploaded asset: ${name}.`);
    if (typeof artifact.signature !== 'string' || !artifact.signature.trim()) throw new Error(`Missing updater signature for ${platform}.`);
    const sigAsset = assets.get(`${name}.sig`);
    if (!sigAsset || sigAsset.size <= 0 || sigAsset.state !== 'uploaded') throw new Error(`Missing uploaded signature for ${name}.`);
    targets.push({ platform, name, artifact, asset, sigAsset });
  }
  for (const target of targets) {
    await verifySignatureAsset(target, fetchBytes);
    await verifyArtifactBytes(target, fetchBytes);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const readJson = filename => JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  const main = async () => {
    const manifest = readJson(process.argv[2]);
    const release = readJson(process.argv[3]);
    const config = readJson(fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
    const repo = resolveRepository({ cwd: fileURLToPath(new URL('../', import.meta.url)) });
    await validateUpdateManifest(manifest, release, config.version, repo);
    console.log(`Validated updater assets for v${config.version}: ${Object.keys(manifest.platforms).join(', ')}`);
  };
  main().catch(error => {
    console.error(`Updater manifest validation failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
