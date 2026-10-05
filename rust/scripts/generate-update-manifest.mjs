import { readReleasePublicKey } from './release-updater-config.mjs';
import { readFileSync, readdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRepository } from './resolve-repository.mjs';
import { verifyUpdaterSignature } from './updater-signature.mjs';

export function collectAssets(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? collectAssets(filename) : [filename];
  });
}

export function generateUpdateManifest(files, version, repo, publicKey, options = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be stable semver.');
  if (new Set(files.map(file => path.basename(file))).size !== files.length) throw new Error('Duplicate release asset names.');
  const select = pattern => {
    const matches = files.filter(file => pattern.test(path.basename(file)));
    if (matches.length !== 1) throw new Error(`Expected one release asset matching ${pattern}; found ${matches.length}.`);
    return matches[0];
  };
  const tag = options.tag ?? `v${version}`;
  const platforms = {};
  const targets = { 'linux-x86_64': /_amd64\.AppImage$/, 'windows-x86_64': /_x64-setup\.exe$/ };
  const requiredPlatforms = options.requiredPlatforms ?? Object.keys(targets);
  for (const platform of requiredPlatforms) {
    const pattern = targets[platform];
    if (!pattern) throw new Error(`Unsupported updater platform: ${platform}`);
    const artifact = select(pattern);
    if (!path.basename(artifact).includes(version)) throw new Error(`Artifact version mismatch: ${artifact}`);
    const signatureFile = files.find(file => path.basename(file) === `${path.basename(artifact)}.sig`);
    if (!signatureFile) throw new Error(`Missing signature for ${artifact}.`);
    const signature = readFileSync(signatureFile, 'utf8').trim();
    verifyUpdaterSignature(readFileSync(artifact), signature, publicKey);
    platforms[platform] = { signature, url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(path.basename(artifact))}` };
  }
  if (options.requirePortable ?? requiredPlatforms.includes('windows-x86_64')) {
    const portable = select(new RegExp(`^Converter_${version.replaceAll('.', '\\.')}\\_windows_x64_portable\\.zip$`));
    if (!readFileSync(portable).subarray(0, 2).equals(Buffer.from('PK'))) throw new Error('Portable release asset is not a ZIP archive.');
  }
  return { version, notes: options.notes ?? (requiredPlatforms.length === 1 && requiredPlatforms[0] === 'linux-x86_64' ? 'Linux portable AppImage update.' : 'Linux AppImage and Windows installer updates.'), pub_date: new Date().toISOString(), platforms };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2]);
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  const files = collectAssets(directory).filter(file => !['latest.json', 'latest-linux.json', 'SHA256SUMS.txt'].includes(path.basename(file)));
  const repo = resolveRepository();
  const notesPath = new URL(`../../docs/releases/linux-v${config.version}.md`, import.meta.url);
  const releaseNotes = process.argv.includes('--linux-only') && existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : undefined;
  const manifest = generateUpdateManifest(files, config.version, repo, readReleasePublicKey(config, process.argv.includes('--linux-only')), process.argv.includes('--linux-only') ? { requiredPlatforms: ['linux-x86_64'], requirePortable: false, tag: `linux-v${config.version}`, notes: releaseNotes } : {});
  for (const file of files) if (path.dirname(file) !== directory) copyFileSync(file, path.join(directory, path.basename(file)));
  writeFileSync(path.join(directory, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const checksums = files.map(file => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${path.basename(file)}`).join('\n');
  writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checksums + '\n');
  console.log(`Verified signed ${Object.keys(manifest.platforms).join(', ')} artifacts.`);
}
