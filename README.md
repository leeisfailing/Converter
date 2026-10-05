# Converter for Windows

A Windows x64 desktop workspace for downloading, converting, compressing,
upscaling, and AI-enhancing video, audio, and images. Built with Tauri 2,
React, Rust, Python, C++, FFmpeg, yt-dlp, and ONNX Runtime.

This is the **Windows** branch. It retains the shared application and engines,
with Windows-only checks and release workflows. The **main** branch is the
combined Linux and Windows open-source project. Linux source and packaging
helpers remain here for shared development, while Linux automation runs from
`main`. Open shared-feature pull requests against `main`.

[Windows release guide](docs/windows-releases.md) ·
[Shipping review](docs/shipping-review.md) · [Privacy](PRIVACY.md)

## Download and run

Download Windows x64 packages from this repository's **Releases** tab:

- **NSIS installer / MSI:** install Converter, then launch it. Installed copies
  can check for signed updates in **About & Updates**.
- **Converter-portable.zip:** extract every file and run `converter.exe`.
  Portable copies use manual replacement when updating. Keep the bundled
  `converter-portable.json` beside the executable.

Microsoft WebView2 is required, including for portable builds. Packaged users
need no separate Python, FFmpeg, or build tools. Older release assets may vary.

## Tools and queue

Download saves supported video/audio links. Convert changes video, audio, and
image formats. Transcoder compresses by quality or toward a target size.
Upscale increases resolution, and Enhance uses Real-ESRGAN ONNX models.
Models download when first needed.

The queue supports progress, cancellation, and retry. Pause suspends running
media processes and holds waiting jobs; Resume continues from the same position.
Paused jobs can still be cancelled.
Settings control output folders, concurrency, GPU selection, and appearance.
Hardware encoding depends on compatible NVIDIA, AMD, or Intel drivers and codec
support. ONNX inference providers are separate from FFmpeg encoders; the bundled
Windows AI runtime includes CPU inference. The selected media GPU controls
encoding; another GPU may render the desktop. Dedicated encoder utilization
can be high while general GPU utilization is low. Audio, I/O, and unsupported
decoding/filtering operations can still use CPU resources. TikTok uses the third-party TikWM
service; other supported sites use yt-dlp.

## Develop and build

Install Node.js 24, Python 3.11+, CMake 3.20+, stable Rust with MSVC, Visual
Studio C++ build tools, and WebView2. In PowerShell from the project root:

```powershell
python scripts/bundle_runtime.py
./scripts/build_cpp_engine.ps1
cd rust
npm ci --include=optional
npm run tauri dev
```

Runtime setup downloads hash-pinned private Python, media tools, and AI wheels.
Generated dependencies, runtimes, caches, and binaries are ignored by Git.
Keep signing keys and environment files outside source control.

All npm commands run from `rust/`:

```powershell
npm run typecheck
npm test
npm run build
npm run release:check
npm run build:installer
npm run build:portable
```

The installer is written under `rust/src-tauri/target/release/bundle/nsis/`.
The portable directory and ZIP are in `rust/dist/`.

Engine verification, from the project root:

```powershell
python scripts/verify_bundled_runtime.py
rust/src-tauri/bin/python/python.exe -B -c "import runpy, sys; sys.path.insert(0, '.'); sys.argv = ['unittest', 'discover', '-s', 'PyEngine/tests', '-v']; runpy.run_module('unittest', run_name='__main__')"
cargo test --locked --manifest-path rust/src-tauri/Cargo.toml
```

The C++ setup script runs CTest. Frontend-only preview is available with
`npm run preview` after a build; media operations require the desktop app.

## GitHub automation

[Windows checks](.github/workflows/ci.yml) run on `main`, `master`, and `Windows`
pushes and pull requests. [Release](.github/workflows/release.yml) requires a
matching `v<version>` tag and creates a draft with signed NSIS/MSI packages,
portable ZIP, and `latest.json`. Review and test the draft before publication.
Windows signing credentials belong in the protected `release` environment.
The [release guide](docs/windows-releases.md) explains versioning and validation.

Report bugs through **Issues**. Inspect the debug console with `Ctrl+Shift+D`
and use About to save a local bug report. Review logs and paths before sharing.

## License

[MIT](LICENSE). Third-party dependencies, tools, and models retain their own
licenses. Typography prefers locally installed system fonts; no Apple font
files are bundled or downloaded.
