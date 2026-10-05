import { readReleasePublicKey } from './release-updater-config.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveRepository } from './resolve-repository.mjs';
import { validateUpdateManifest } from './validate-update-manifest.mjs';

async function digest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyUploadedFiles(gh, directory, files, release, repo, tag) {
  const staging = mkdtempSync(path.join(tmpdir(), 'converter-upload-verify-'));
  for (const file of files) {
    const asset = release.assets.find(item => item.name === path.basename(file));
    if (!asset || asset.state !== 'uploaded' || asset.size <= 0) throw new Error(`Release asset incomplete: ${file}`);
    const downloaded = path.join(staging, asset.name);
    gh(['release', 'download', tag, '--repo', repo, '--pattern', asset.name, '--output', downloaded]);
    if (await digest(downloaded) !== await digest(file)) throw new Error(`Uploaded bytes differ: ${asset.name}`);
  }
}

/** Only the final operation publishes; failed verification leaves a resumable draft. */
export async function publishRelease({ directory, manifest, repo, publicKey, tag: releaseTag, latest = true, requiredPlatforms = ['linux-x86_64'], requirePortable = false, gh, validate = validateUpdateManifest, verifyFiles = verifyUploadedFiles }) {
  const tag = releaseTag ?? `v${manifest.version}`;
  const pages = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--slurp']));
  let release = pages.flat().find(value => value.tag_name === tag);
  if (release && !release.draft) throw new Error('Refusing to replace an already published release. Bump the version.');
  if (!release) {
    gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', `Converter ${tag}`, '--notes', manifest.notes]);
    release = JSON.parse(gh(['api', `repos/${repo}/releases/tags/${tag}`]));
  }
  const files = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name !== 'latest-linux.json').map(entry => path.join(directory, entry.name));
  gh(['release', 'upload', tag, '--repo', repo, '--clobber', ...files]);
  release = JSON.parse(gh(['api', `repos/${repo}/releases/${release.id}`]));
  await validate(manifest, release, manifest.version, repo, { publicKey, requiredPlatforms, tag });
  if (requirePortable) {
    const portable = release.assets.find(asset => asset.name === `Converter_${manifest.version}_windows_x64_portable.zip`);
    if (!portable || portable.state !== 'uploaded' || portable.size <= 0) throw new Error('Windows portable ZIP upload is missing or incomplete.');
  }
  await verifyFiles(gh, directory, files, release, repo, tag);
  gh(['release', 'edit', tag, '--repo', repo, '--draft=false', `--latest=${latest}`]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2]);
  const manifest = JSON.parse(readFileSync(path.join(directory, 'latest.json')));
  const repo = resolveRepository();
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  const publicKey = readReleasePublicKey(config, process.argv.includes('--linux-only'));
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (process.argv.includes('--linux-only')) {
    const { publishLinuxRelease } = await import('./publish-linux-release.mjs');
    await publishLinuxRelease({ directory, manifest, repo, publicKey, gh });
  } else {
    await publishRelease({ directory, manifest, repo, publicKey, gh });
  }
  const tag = `${process.argv.includes('--linux-only') ? 'linux-v' : 'v'}${manifest.version}`;
  console.log(`Published complete release ${tag}: https://github.com/${repo}/releases/tag/${tag}`);
}
