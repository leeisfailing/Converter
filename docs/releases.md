# Linux releases and signed AppImage updates

The **Linux** workflow tests the application on pushes and pull requests, then
builds an unsigned AppImage and checks its extracted media runtime without signing
secrets. The test AppImage is available as a short-lived Actions artifact. The
**Linux Release** workflow calls it to build a signed x64 portable AppImage, verifies
its contents, and publishes the complete Linux release through GitHub Releases.
Windows release integration is being handled separately; the existing Windows
checks, packaging script, and shared Tauri configuration remain unchanged.

## Configure GitHub

1. Enable GitHub Actions in this repository.
2. Create an Actions environment named **linux-release** and permit tags matching `linux-v*`.
3. Add **TAURI_SIGNING_PRIVATE_KEY** to that environment using the Linux private
   key corresponding to `rust/src-tauri/updater.linux.key.pub`.
4. For an encrypted key, add **TAURI_SIGNING_PRIVATE_KEY_PASSWORD**. For a key with
   an empty password, omit the password secret; the workflow passes an empty string.
5. Keep GitHub Releases publicly downloadable for the static updater endpoint.

Set secrets using private files outside the checkout, without placing their contents
in arguments or shell history:

```bash
gh auth login
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo OWNER/REPO --env linux-release < /secure/path/updater.key
# Encrypted key only:
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo OWNER/REPO --env linux-release < /secure/path/updater-password
gh secret list --repo OWNER/REPO --env linux-release
```

Protect those files with owner-only permissions. Never upload the `.pub` file as the
private-key secret, commit signing material, or change the Linux public key after shipping: doing so prevents existing Linux
installations from trusting updates. The original Windows public key and shared
configuration remain independent and unchanged.

The original signing private key was lost. Linux therefore starts with a newly
generated, independent key in `tauri.linux.conf.json` and `updater.linux.key.pub`.
Install the first release using this key manually; installations trusting an old
key cannot migrate through a signature from the new key. Future Linux updates
must use this same Linux key. Back up its private file and password securely in a
second location outside this repository and retain them across machine changes.
The **linux-release** environment isolates signing secrets from Windows releases.

Linux overrides the updater endpoint to use only
`https://github.com/OWNER/REPO/releases/download/updater-linux/latest-linux.json`.
No Supabase service or extra access token is required. Build/check jobs use read-only
repository permissions; only the final publish job receives `contents: write`.

## Publish Linux

1. Synchronize versions in `rust/package.json`, `rust/package-lock.json`,
   `rust/src-tauri/Cargo.toml`, `rust/src-tauri/Cargo.lock`, and `rust/src-tauri/tauri.conf.json`.
2. Run `npm run release:check -- --linux-only` from `rust/` and the appropriate Linux test suites.
3. Commit the release change and push the matching stable `linux-v<version>` tag.
   A manual Linux Release run must also select a matching tag, not a branch.
4. Linux runs the frontend, C++, private Python and Rust tests before packaging.
   The packaging job uses the **linux-release** environment, builds a signed AppImage,
   extracts it, checks resource layout and exercises its Python/media tools.
5. The final job verifies the AppImage signature against the retained public key,
   creates `latest.json` using release notes from
   `docs/releases/linux-v<version>.md` when available, uploads a draft and verifies uploaded assets before publishing.

The release contains `Converter_<version>_amd64.AppImage`, its `.sig`, `latest.json`
and `SHA256SUMS.txt`. One publisher writes the manifest and assets. Failed builds or
verification leave no incomplete published release; a failed publisher leaves a
resumable draft. Reruns refuse to overwrite a published version.

Linux uses immutable `linux-v<version>` releases and a separate **updater-linux**
release containing `latest-linux.json`. Both use `--latest=false`, so Windows'
latest-release pointer, `v*` tags, workflow and `latest.json` remain untouched.
The Linux channel manifest points to the signed AppImage in its immutable version
release. The publisher updates the channel only after published native artifacts,
signatures and hashes have been verified. A rerun after channel failure revalidates
the already published immutable release without replacing its binaries. Older
version reruns cannot move the Linux channel backward.

The generator and validator accept explicit `requiredPlatforms` and tag options;
Linux release commands use `--linux-only`. Linux publication is serialized across
version tags to prevent simultaneous writes to the stable Linux channel.

The manifest itself is not signed. Tauri verifies the AppImage artifact signature
when installing an update. Keep the AppImage in a writable location so it can be replaced.

## Recover publication from a successful signed package

Rerunning an old tagged workflow executes the old publisher code at that tag. Use
**Linux Release Recovery** from **main** to run the current fixed publisher against
the original signed artifact without rebuilding, retagging or changing the version.

```bash
gh workflow run linux-release-recovery.yml --repo OWNER/REPO --ref main \
  -f run_id=37323830893 -f tag=linux-v4.0.9
```

The read-only validation job tests the current scripts and requires the source run
to be a completed, same-repository `push` run of the Linux Release workflow. Its
commit must match the existing immutable tag, its selected attempt must contain a
successful Linux package job, and its unique `release-linux` artifact must remain
available with valid provenance and a SHA-256 digest. Recovery accepts only the
current app version, not arbitrary earlier versions or unsigned smoke artifacts.

The workflow downloads that exact artifact ID and verifies its signature using the
current Linux public key before a separate job receives release write permission.
The publisher repeats signature checks, validates uploaded assets, preserves already
published binaries, and refuses to move the Linux updater channel backward. It uses
no signing secrets and does not relax the **linux-release** environment's tag policy.
If the artifact has expired or provenance/signature validation fails, recovery stops.

## Local build

Run npm commands from `rust/`:

```bash
npm run setup:linux
npm run release:check -- --linux-only
npm run build:linux
```

Set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as environment
variables for signed updater artifacts. Runtime setup downloads private Python and
its packages. Linux packaging also requires `libcrypt1` on Ubuntu/Debian or
`libxcrypt-compat` on Arch because Python's `_crypt` extension needs `libcrypt.so.1`.

The AppImage contains Python, its packages, FFmpeg/FFprobe, the C++ engine and their
shared dependencies. glibc and GPU drivers remain host-provided. Releases build on
Ubuntu 24.04; older glibc distributions and musl systems are not guaranteed compatible.
Source builds support additional architectures, but this release workflow ships x64 only.

Use Ubuntu 24.04 for production AppImage packaging. Current Arch GDK Pixbuf 2.44
removes loader paths expected by the upstream GTK packaging plugin, so an Arch
source development environment may be unable to package an AppImage. Building on
a Linux-native filesystem also avoids AppImage staging cleanup issues observed on
NTFS. The wrapper defaults `NO_STRIP=1` because older linuxdeploy stripping tools
cannot handle some modern ELF relocation formats; extraction mode is enabled for
packaging tools. An unsigned local smoke build is available with
`npm run build:linux -- --unsigned`; it cannot be installed as a signed updater artifact.

## Validate an update

On a clean Linux x64 machine, download the AppImage, mark it executable, and run it
from a writable directory. Exercise media download, conversion, compression and
enhancement. Publish a higher version using the same Linux signing key and verify the
old AppImage offers and installs the update, then relaunches successfully.

A successful hosted build and an actual old-to-new install are required to confirm
distribution behavior. Local unit tests cannot verify real signing secrets, hosted
runners or compatibility with every Linux distribution.

## References

- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [Tauri AppImage distribution](https://v2.tauri.app/distribute/appimage/)
- [GitHub reusable workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows)
