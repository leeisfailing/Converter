import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishRelease } from './publish-release.mjs';
import { validateUpdateManifest } from './validate-update-manifest.mjs';

export function compareStableVersions(left, right) {
  const parse = value => {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)) throw new Error('Linux channel version must be stable semver.');
    return value.split('.').map(BigInt);
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

/** Publish immutable Linux binaries before updating the independent Linux channel. */
export async function publishLinuxRelease({ directory, manifest, repo, publicKey, gh, publish = publishRelease, validate = validateUpdateManifest, loadPublishedManifest, loadChannelManifest }) {
  const tag = `linux-v${manifest.version}`;
  const pages = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--slurp']));
  let release = pages.flat().find(item => item.tag_name === tag);
  if (release && !release.draft) {
    // A previous run may have published binaries but failed the channel upload.
    // Reverify the existing immutable release; never upload rebuilt binaries.
    if (loadPublishedManifest) manifest = await loadPublishedManifest(tag);
    else {
      const staging = mkdtempSync(path.join(tmpdir(), 'converter-linux-resume-'));
      const filename = path.join(staging, 'latest.json');
      gh(['release', 'download', tag, '--repo', repo, '--pattern', 'latest.json', '--output', filename]);
      manifest = JSON.parse(readFileSync(filename));
    }
  } else {
    await publish({ directory, manifest, repo, publicKey, gh, tag, latest: false, requiredPlatforms: ['linux-x86_64'] });
    release = JSON.parse(gh(['api', `repos/${repo}/releases/tags/${tag}`]));
  }
  await validate(manifest, release, tag.slice('linux-v'.length), repo, { publicKey, tag, requiredPlatforms: ['linux-x86_64'] });
  if (release.draft) throw new Error('Linux binaries must be published before updating the channel.');
  const channel = pages.flat().find(item => item.tag_name === 'updater-linux');
  if (channel && (loadChannelManifest || channel.assets?.some(asset => asset.name === 'latest-linux.json'))) {
    let current;
    if (loadChannelManifest) current = await loadChannelManifest();
    else {
      const staging = mkdtempSync(path.join(tmpdir(), 'converter-linux-channel-'));
      const filename = path.join(staging, 'latest-linux.json');
      gh(['release', 'download', 'updater-linux', '--repo', repo, '--pattern', 'latest-linux.json', '--output', filename]);
      current = JSON.parse(readFileSync(filename));
    }
    if (compareStableVersions(manifest.version, current.version) < 0) {
      throw new Error(`Refusing to move Linux update channel backward from ${current.version} to ${manifest.version}.`);
    }
  }
  if (!channel) {
    gh(['release', 'create', 'updater-linux', '--repo', repo, '--target', process.env.GITHUB_SHA ?? 'HEAD', '--title', 'Linux update channel', '--notes', 'Signed Linux AppImage updates.', '--latest=false']);
  }
  const channelManifest = path.join(directory, 'latest-linux.json');
  writeFileSync(channelManifest, JSON.stringify(manifest, null, 2) + '\n');
  // Last mutation: Windows latest.json, latest release pointer and version tags stay untouched.
  gh(['release', 'upload', 'updater-linux', '--repo', repo, '--clobber', channelManifest]);
}
