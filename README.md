# Converter

A desktop app for downloading, converting, compressing, and enhancing media.
Built with React, TypeScript, Tauri, Rust, and C++/Python media engines powered
by FFmpeg, yt-dlp, and ONNX Runtime.

> **Current release: v4.0.8** — Windows (installer + portable). Linux
> production packaging is coming soon.

## Features

| Tool | What it does |
| --- | --- |
| Download | Save video or audio from supported URLs with format and quality choices. |
| Convert | Convert video, audio, and images between supported formats. |
| Transcoder | Compress by quality or reduce to a target size in KB, MB, or GB. |
| Upscale | Increase video and image resolution with hardware-aware processing. |
| Enhance | Apply Real-ESRGAN 2× or 4× AI enhancement to photos and videos. |

Jobs run through a queue with progress, cancellation, and configurable output
folders. Settings include GPU selection, light and dark themes, and a debug
console. Video tasks can use NVIDIA NVENC, AMD AMF, or Intel Quick Sync when the
installed drivers and FFmpeg build support them.

TikTok links use a separate TikWM/HTTP downloader with watermarked and
no-watermark options. These links are sent to the third-party TikWM service;
availability depends on that service. Other supported sites use yt-dlp.

## Platform support

| Platform | Run from source | Production build |
| --- | --- | --- |
| Windows x64 | Supported | **Installer (NSIS) and portable zip** — the shipping formats |
| Linux with glibc | x86_64 and aarch64 runtime setup | **Coming soon** (app executable only for now) |

Windows is the primary release platform: each release publishes a signed NSIS
installer and a self-contained portable zip (no install step, just unzip and run)
via the [release workflow](.github/workflows/release.yml). Linux production
packaging (AppImage, deb/rpm, and installer) is planned but not yet built; today
Linux is supported for running from source and building the app executable.

Linux has been tested locally on Arch Linux x86_64 with NVIDIA hardware,
including conversion, reduction, upscaling, AI enhancement, and clean shutdown.
Hardware acceleration depends on the machine and its drivers.

## Get started

```bash
git clone https://github.com/leeisfailing/Converter.git
cd Converter
```

Use Node.js 24, which is also used by CI. The frontend requires Node.js 22.12 or
newer. Building requires a current stable Rust/Cargo toolchain, Python 3.11 or
newer, and CMake 3.20 or newer. Tauri's CLI is included in the npm dependencies.
Complete the platform setup below before starting the app.

## Linux

### Native dependencies

WebKitGTK is required to display the application; npm does not install it.
These commands include [Tauri's Linux prerequisites](https://v2.tauri.app/start/prerequisites/)
and the tools used by Converter's media engines.

**Arch Linux**

```bash
sudo pacman -Syu
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool \
  cmake python ffmpeg pciutils patchelf
```

Install Node.js and Rust/Cargo separately if needed. Arch's `rust` package is
supported, as is a stable toolchain installed with [rustup](https://rustup.rs/).

**Ubuntu 24.04 / Debian**

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  cmake python3 ffmpeg pciutils patchelf
```

Install Node.js and stable Rust/Cargo separately if needed. Other distributions
need equivalent packages and glibc; this project's runtime setup does not target
musl.

### Run in development

From the project root:

```bash
cd rust
npm ci --include=optional
npm run tauri dev
```

Tauri automatically applies
[`tauri.linux.conf.json`](rust/src-tauri/tauri.linux.conf.json). Its startup hook
runs `npm run setup:linux` to prepare:

- Private, SHA-256-verified Python in `rust/src-tauri/bin/linux/python/`.
- yt-dlp, Deno, ONNX Runtime, OpenCV, and NumPy inside that runtime.
- Linux FFmpeg and FFprobe sidecars copied from the system installation.
- The native C++ engine in `cpp_engine/build-linux/`.

The first run needs internet access. Later runs reuse the runtime and incremental
C++ build. System Python is not modified, and Linux runtime files are kept
separate from Windows runtime files. Run `npm run setup:linux` from `rust/` to
prepare or diagnose the runtime independently.

### Build and run the executable

From `rust/`:

```bash
npm run build:linux
./src-tauri/target/release/converter
```

The default output is `rust/src-tauri/target/release/converter`. If
`CARGO_TARGET_DIR` is set, the executable is written under that directory instead.
The Linux build produces no installer, AppImage, DEB, or RPM — Linux production
packaging is coming soon.

Keep the source checkout, prepared runtime, FFmpeg, and WebKitGTK dependencies
available when running this executable. It is not a standalone portable bundle.
Build on the distribution where you intend to run it: newer system libraries
on the build machine may not be available on an older distribution.

### GPU and AI behavior

Select a working hardware encoder in Settings, or choose CPU for software
encoding. GPU video mode reports hardware errors rather than silently changing
to a CPU video encoder. Available encoders are probed before selection.

AI enhancement uses ONNX Runtime on CPU by default. A compatible GPU execution
provider can accelerate inference; this is separate from FFmpeg hardware
encoding. Model files are downloaded when first needed. All three configured
models support photo and video enhancement.

Optional VapourSynth tooling must come from the Linux distribution. Linux does
not load the bundled Windows DLLs.

## Windows

### Prepare and run

Install Node.js, stable Rust with the Windows MSVC toolchain, Python, and CMake.
The native engine requires Visual Studio C++ build tools. Follow
[Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows)
for the C++ tools and WebView2 runtime.

Run these commands in PowerShell from the project root:

```powershell
python scripts/bundle_runtime.py
./scripts/build_cpp_engine.ps1
cd rust
npm ci --include=optional
npm run tauri dev
```

The setup prepares private Python, yt-dlp, Deno, VapourSynth, and media tools
using pinned downloads. Installed Windows users do not need their own Python
or pip.

### Build

These are the two shipping Windows artifacts. After setup, run the desired
command from `rust/`:

```powershell
# Windows NSIS installer (signed, auto-update capable)
npm run build:installer

# Windows portable zip (no install step — unzip and run)
npm run build:portable
```

Installer output is under `rust/src-tauri/target/release/bundle/`. The portable
build creates `rust/dist/portable/` and `rust/dist/Converter-portable.zip`.

Both require a **Windows host with the MSVC toolchain and NSIS** — Tauri cannot
cross-compile a Windows installer from Linux/macOS. In this repository the
Windows artifacts are produced on Windows runners by
[`.github/workflows/release.yml`](.github/workflows/release.yml) (see
[Updates and Windows releases](#updates-and-windows-releases)).

## Troubleshooting

### Missing Tauri or Rollup native binding

For errors such as `Cannot find module '@tauri-apps/cli-linux-x64-gnu'`, run this
from `rust/`:

```bash
npm ci --include=optional
```

Keep `package-lock.json`. Do not reuse a Windows `node_modules` directory on
Linux or share one across operating systems. npm's
[optional dependency issue](https://github.com/npm/cli/issues/4828) can leave
native bindings missing.

### Missing WebKitGTK or build tools

Install the platform dependencies above, then run `npm run tauri -- info` from
`rust/`. An Arch system using the distribution's Rust package can report that
`rustup` is absent; a working `rustc` and `cargo` are sufficient for this build.

### Frontend tests fail on Node.js 26

If jsdom tests report unavailable `localStorage`, run this from `rust/` on Linux:

```bash
NODE_OPTIONS=--no-experimental-webstorage npm test
```

CI uses Node.js 24.

### Downloads or media jobs fail

Open the debug console with `Ctrl+Shift+D` and inspect the operation's error.
Website availability, authentication, drivers, supported codecs, and achievable
target sizes vary. For hardware encoder errors, verify the driver and FFmpeg
support or select CPU in Settings.

The About dialog can save a bug report as a text file. Attach it to a
[GitHub issue](https://github.com/leeisfailing/Converter/issues); saving the report
does not submit it automatically.

## Development checks

Run the frontend checks from `rust/`:

```bash
npm test
npm run typecheck
npm run build
```

Run the Linux backend checks from the project root after runtime setup:

```bash
ctest --test-dir cpp_engine/build-linux --output-on-failure
python3 scripts/verify_linux_runtime.py
rust/src-tauri/bin/linux/python/bin/python3 -B -m unittest discover -s PyEngine/tests -v
cargo test --locked --manifest-path rust/src-tauri/Cargo.toml
```

The detached-runtime check copies the engines and dependencies into a temporary
directory, then tests tool lookup, conversion, and reduction without system
tools on its `PATH`. The Windows equivalent is:

```powershell
python scripts/verify_bundled_runtime.py
rust/src-tauri/bin/python/python.exe -B -c "import runpy, sys; sys.path.insert(0, '.'); sys.argv = ['unittest', 'discover', '-s', 'PyEngine/tests', '-v']; runpy.run_module('unittest', run_name='__main__')"
cargo test --locked --manifest-path rust/src-tauri/Cargo.toml
```

The [Linux workflow](.github/workflows/linux.yml) tests on Ubuntu 24.04 and builds
the app executable. The [Windows checks](.github/workflows/ci.yml) prepare and
test the Windows runtime and native engine.

## Updates and Windows releases

The Windows release workflow builds signed updater artifacts for GitHub
Releases. The app checks shortly after startup and supports manual checks
through About & Updates. Installing an update requires a published release with
matching signed artifacts and `latest.json`. Linux installer distribution and
automatic-update artifacts are not configured by this development setup.

For a Windows release:

1. Synchronize versions in `rust/package.json`, `rust/package-lock.json`,
   `rust/src-tauri/Cargo.toml`, `rust/src-tauri/Cargo.lock`, and
   `rust/src-tauri/tauri.conf.json`.
2. Run `npm run release:check` from `rust/`.
3. Commit the release changes and push a matching `v<version>` tag.
4. Verify the artifacts from the [release workflow](.github/workflows/release.yml),
   then publish its draft.

GitHub Actions requires `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep the original private key matching the
public key embedded in the app; changing it breaks trust for existing installs.
Private signing material must not be committed. `npm run signer:generate` is
available for initial key creation, not routine releases.

## Project layout

```text
Converter/
├── rust/
│   ├── src/                    React interface and shared UI helpers
│   ├── tests/                  Frontend regression tests
│   ├── src-tauri/
│   │   ├── src/                Rust commands, processes, settings, and caches
│   │   ├── tauri.conf.json     Shared configuration and Windows build settings
│   │   └── tauri.linux.conf.json
│   └── scripts/                Frontend and release utilities
├── PyEngine/
│   ├── __main__.py             JSON-lines engine entry point
│   ├── core/                   Tool lookup, GPU detection, and AI models
│   ├── handlers/               Command dispatch
│   ├── workers/                Media, download, and enhancement operations
│   └── tests/                  Python unit and integration tests
├── cpp_engine/                 Native media engine and lifecycle tests
├── scripts/                    Runtime setup and verification
└── .github/workflows/          Windows, Linux, and release automation
```

Generated runtimes, Linux build output, and download caches are ignored by Git.
Prepare them again after a fresh checkout.

## License

MIT
