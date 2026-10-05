# Converter

A desktop workspace for downloading, converting, compressing, upscaling, and
AI-enhancing video, audio, and images. Built with Tauri 2, React, Rust, Python,
C++, FFmpeg, yt-dlp, and ONNX Runtime.

[Downloads](https://github.com/leeisfailing/Converter/releases) ·
[Report an issue](https://github.com/leeisfailing/Converter/issues) ·
[Linux release setup](docs/releases.md)

## Download and run

The release pipeline produces the packages below. Check the release asset list
for availability; older releases may contain different packages.

| Platform | Package | Launch | Updates |
| --- | --- | --- | --- |
| Linux x86_64, glibc | Portable `.AppImage` | Make executable, then run | Signed in-app updates |
| Windows x64 | Installer | Run the installer | Maintained separately |
| Windows x64 | Portable ZIP | Extract all files; run `converter.exe` | Maintained separately |

On Linux, substitute your downloaded filename:

```bash
chmod +x Converter_<version>_amd64.AppImage
./Converter_<version>_amd64.AppImage
```

Keep the AppImage in a writable folder so the updater can replace it. FUSE 2
may be needed by your distribution. If mounting is unavailable, try:

```bash
./Converter_<version>_amd64.AppImage --appimage-extract-and-run
```

Linux release builds use Ubuntu 24.04. AppImages still need compatible glibc,
desktop libraries, and GPU drivers. Linux aarch64 runtime setup is supported
for source builds; the release pipeline publishes x86_64 only.

Windows builds and release automation are maintained separately. This release
update focuses on Linux; Windows uses its existing configuration and workflows.
Windows requires Microsoft WebView2, including for portable builds.

## Tools and queue

| Tool | Use it for |
| --- | --- |
| Download | Save supported video/audio links with format and quality choices |
| Convert | Change video, audio, or image formats |
| Transcoder | Compress by quality or reduce toward a target file size |
| Upscale | Increase video or image resolution with hardware-aware processing |
| Enhance | Apply Real-ESRGAN enhancement using ONNX models |

Add work to the queue and keep using the other tools while jobs process.
Progress, download speed, cancellation, and errors appear beside each job.
**Pause queue** holds pending work while active jobs finish; **Resume queue**
starts scheduling again. Retry failed or cancelled jobs individually, or retry
all failed jobs. Each retry starts a fresh attempt with the original options.
Clear finished jobs when you no longer need their history.

Settings control output folders, concurrency, GPU selection, and appearance.
The interface uses neutral light/dark surfaces, blue accents, keyboard focus
indicators, and reduced-motion preferences. Typography prefers locally
installed SF Pro Text and SF Pro Display, then platform system fonts. Apple
font files are not bundled or downloaded.

Hardware encoding can use NVIDIA NVENC, AMD AMF, or Intel Quick Sync when the
drivers and FFmpeg build support them. Choose CPU when hardware encoding is
unavailable. ONNX model inference and FFmpeg encoding use separate acceleration
paths. Selecting a video encoder does not install a GPU inference provider.
AI models download when first needed.

TikTok links use the third-party TikWM service, including watermark options.
Other supported sites use yt-dlp. Availability depends on websites,
authentication, and upstream services.

## Linux software updates

Open **About & Updates** to check manually. The app also checks after startup.
The Linux AppImage reads `latest-linux.json` from the dedicated `updater-linux`
GitHub Release. Tauri verifies the AppImage signature before installation,
replaces the writable AppImage, and restarts Converter. Finish or remove
pending media jobs before installing an update.

The static manifest is version metadata served over GitHub HTTPS; it is not
itself signed. Downloaded update binaries are cryptographically verified against
the embedded public key. Source executables require a supported AppImage for
automatic update installation.

Retain the private signing key matching
[`updater.key.pub`](rust/src-tauri/updater.key.pub). Changing it breaks trust for
existing installations. Linux releases use `linux-v<version>` tags and never
change the repository's Windows `latest.json` or latest-release pointer.

## Develop from source

Use **Node.js 24**, current stable Rust/Cargo, Python 3.11+, and CMake 3.20+.
All npm commands run in `rust/`; there is no root `package.json`.

```bash
git clone https://github.com/leeisfailing/Converter.git
cd Converter
```

### Linux prerequisites

Ubuntu 24.04:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential cmake \
  curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf ffmpeg pciutils libfuse2t64 libcrypt1
```

Arch Linux:

```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel cmake curl wget file \
  openssl libappindicator-gtk3 librsvg xdotool patchelf ffmpeg pciutils fuse2 libxcrypt-compat
```

Install Node.js and stable Rust separately. Other distributions need equivalent
packages and glibc; this runtime setup does not target musl.

```bash
cd rust
npm ci --include=optional
npm run setup:linux
npm run tauri dev
```

Linux's Tauri hooks also run setup before development and builds. Setup
prepares SHA-256-verified private Python, Python packages, FFmpeg/FFprobe
sidecars, and the C++ engine. First setup needs network access; subsequent runs
reuse prepared files and incremental builds. System Python is not modified.
Optional VapourSynth must come from the Linux distribution.

### Windows prerequisites

Install Node.js, Python, CMake, stable Rust with the MSVC toolchain, and Visual
Studio C++ build tools. See
[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

In PowerShell, from the project root:

```powershell
python scripts/bundle_runtime.py
./scripts/build_cpp_engine.ps1
cd rust
npm ci --include=optional
npm run tauri dev
```

Setup assembles private Python and pinned runtime tools. Packaged users do not
need Python installed separately. Windows packages are built on Windows with
MSVC; this project does not cross-build its installer from Linux.

### Frontend preview

After installing dependencies, run from `rust/`:

```bash
npm run build
npm run preview
```

The browser displays the interface. Media operations and update installation
require the desktop app.

## Build packages

Run from `rust/` after preparing the platform runtime:

```bash
# Linux portable AppImage
npm run build:linux

# Linux packaging smoke test without signing secrets
npm run build:linux -- --unsigned

# Windows NSIS installer
npm run build:installer

# Windows portable ZIP
npm run build:portable
```

AppImages appear in `rust/src-tauri/target/release/bundle/appimage/`, installers
in `rust/src-tauri/target/release/bundle/nsis/`. Portable Windows builds use the
existing packaging script and create
`rust/dist/portable/` and `rust/dist/Converter-portable.zip`.

Signed updater builds require `TAURI_SIGNING_PRIVATE_KEY` and, for encrypted
keys, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the process environment. Keep
private material out of source control and shell history.

Use Ubuntu 24.04 for release packaging. Modern Arch GDK Pixbuf can be
incompatible with Tauri's GTK packaging plugin; Arch remains supported for
development. Build output should be on a native Linux filesystem, since NTFS
can fail while recreating AppImage staging directories. Linux pull requests
also build and verify an unsigned AppImage on Ubuntu and upload it as the
`linux-appimage-smoke` Actions artifact. This artifact is for testing, not
signed updater distribution.

## Linux GitHub Actions and Releases

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [Linux](.github/workflows/linux.yml) | Main/master pushes, PRs, manual checks, release calls | Test Linux; build signed AppImage for release calls |
| [Linux Release](.github/workflows/linux-release.yml) | `linux-v*` pushes or manual runs on a version tag | Verify and publish Linux packages and update metadata |

Windows [checks](.github/workflows/ci.yml) and
[release workflow](.github/workflows/release.yml) remain separate. Linux uses
its own release tags and updater channel so the platform maintainers can work
independently.

Configure the GitHub environment **`release`**, allow tag deployments matching
`linux-v*`, and add these environment secrets:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the existing private signing key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password; omit for an unencrypted key |

GitHub supplies the workflow token; no personal access token or external update
server is needed for Linux. Linux build jobs read repository contents. Only the
Linux publisher has `contents: write`. PR checks do not sign or publish.

To release Linux:

1. Synchronize versions in `rust/package.json`, `rust/package-lock.json`,
   `rust/src-tauri/Cargo.toml`, `rust/src-tauri/Cargo.lock`, and
   `rust/src-tauri/tauri.conf.json`.
2. Run the checks below and `npm run release:check -- --linux-only` in `rust/`.
3. Commit and push the changes, then push `linux-v<version>`.
4. Watch Linux tests, signed packaging, extracted-runtime verification, and
   Linux Release publication in GitHub Actions.
5. Confirm the immutable version release includes AppImage, signature,
   `latest.json`, and `SHA256SUMS.txt`. The stable `updater-linux` release
   serves the active manifest, referencing the versioned AppImage.
6. Verify an update from the previous AppImage using the same signing key.

The Linux publisher validates signatures and uploaded bytes before publishing
its version release and advancing the Linux updater channel. Linux version and
channel releases are explicitly excluded from the repository's latest pointer.
Published binaries are immutable; recovery re-verifies existing assets rather
than replacing them. Failed checks do not advance the update channel.

Read [the Linux release guide](docs/releases.md) for secure secret upload,
release recovery, and runtime verification. `npm run signer:generate` is for
initial setup, not routine releases; preserve the existing signing key.

## Tests and checks

Frontend/release helpers, from `rust/`:

```bash
npm run typecheck
npm test
npm run build
npm run release:check -- --linux-only
node --test scripts/*.test.mjs
```

Linux engines, from the project root after setup:

```bash
ctest --test-dir cpp_engine/build-linux --output-on-failure
python3 scripts/verify_linux_runtime.py
rust/src-tauri/bin/linux/python/bin/python3 -B -m unittest discover -s PyEngine/tests -v
cargo test --locked --manifest-path rust/src-tauri/Cargo.toml
```

`python3 run_tests.py` uses system Python and needs its Python dependencies
installed. The private-runtime command above matches Linux CI. Runtime
verification checks detached engines, tool lookup, conversion, and reduction.
Releases also verify the extracted AppImage runtime.

Windows runtime checks, from the project root:

```powershell
python scripts/verify_bundled_runtime.py
rust/src-tauri/bin/python/python.exe -B -c "import runpy, sys; sys.path.insert(0, '.'); sys.argv = ['unittest', 'discover', '-s', 'PyEngine/tests', '-v']; runpy.run_module('unittest', run_name='__main__')"
cargo test --locked --manifest-path rust/src-tauri/Cargo.toml
```

## Troubleshooting

- **Missing native npm binding:** run `npm ci --include=optional` in `rust/`.
  Keep the lockfile and use separate dependencies for each operating system.
- **Missing build tools/WebKitGTK:** install the prerequisites, then run
  `npm run tauri -- info` from `rust/`.
- **Node.js 26 jsdom/localStorage failure:** on Linux, use
  `NODE_OPTIONS=--no-experimental-webstorage npm test`. CI uses Node.js 24.
- **Missing Linux update manifest:** confirm the published `updater-linux`
  channel includes `latest-linux.json`. Legacy releases may lack it.
- **Invalid update signature:** verify the signing key matches the embedded
  public key. Do not bypass signature verification.
- **AppImage cannot mount:** install FUSE 2 compatibility or try extraction mode.
- **Media job fails:** inspect the debug console (`Ctrl+Shift+D`). Website,
  codec, driver, and target-size constraints vary. Try CPU for hardware errors.

About can save a bug report as a text file. Review it and attach it to a GitHub
issue; saving does not submit it automatically.

## Architecture

```text
React UI → Tauri Rust commands → Python / C++ engines → FFmpeg
```

Rust validates requests, orchestrates processes, and manages settings/caches.
Python handles downloads and ONNX enhancement through JSON-lines IPC. C++
handles native conversion, reduction, and upscaling. React manages job state,
progress, settings, and updates.

```text
Converter/
├── rust/src/                  React interface and helpers
├── rust/tests/                Frontend regression tests
├── rust/src-tauri/            Rust shell and Tauri configuration
├── rust/scripts/              Packaging, signing, and release utilities
├── PyEngine/                  Python engine and tests
├── cpp_engine/                Native engine and CTest suite
├── scripts/                   Runtime setup and verification
├── docs/releases.md           Linux release and updater setup
└── .github/workflows/         Platform checks and release automation
```

Generated runtimes, download caches, dependencies, and build output are ignored
by Git. Recreate them with the setup commands after a fresh checkout.

## License

MIT. Third-party components and models retain their own licenses. SF Pro is a
local font preference, not a bundled font asset.
