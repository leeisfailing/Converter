# Windows releases

`main` contains the Linux and Windows source. The `Windows` branch keeps the
shared UI and engines, with Windows-only CI and release workflows. Merge common
fixes into `main` before creating releases for both platforms. Windows artifacts
must be built on Windows x64 with the MSVC toolchain.

## Checks and local builds

Install Node.js 24, Python 3.11+, CMake 3.20+, stable Rust/MSVC, Visual Studio
C++ build tools, and WebView2. From the project root in PowerShell:

```powershell
python scripts/bundle_runtime.py
./scripts/build_cpp_engine.ps1
python scripts/verify_bundled_runtime.py
cd rust
npm ci --include=optional
npm run typecheck
npm test
npm run build
npm run release:check
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run build:installer
npm run build:portable
```

Runtime setup downloads pinned, hash-verified Python and media tools. The C++
script builds and runs CTest before copying the native engine. Packaged users
need WebView2; they do not need system Python, FFmpeg, or build tools.

## GitHub release setup

Enable Actions and configure the `release` environment. Store the Windows
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as protected
environment secrets. The private key must match `rust/src-tauri/updater.key.pub`.
Retain secure backups outside the checkout. The Linux environment and key are
independent; never substitute one platform's signing key for the other.

Synchronize the version in `rust/package.json`, `rust/package-lock.json`,
`rust/src-tauri/Cargo.toml`, `rust/src-tauri/Cargo.lock`, and
`rust/src-tauri/tauri.conf.json`. Push a matching `v<version>` tag from the
reviewed `main` or `Windows` commit. Manual Release runs must select that tag.
The workflow validates and tests the code, builds signed NSIS/MSI packages,
assembles the portable ZIP, and uploads them to a draft release with `latest.json`.

Review the draft assets, install the NSIS/MSI package on a clean Windows x64
machine, and run the portable ZIP from an extracted directory. Exercise
download, conversion, compression, upscaling, enhancement, and cancellation.
Test an update from an older installed version using the same signing key.
Publish the complete draft only after these checks succeed.

The ZIP requires manual replacement. In-app Windows updates apply to installed
distributions and verify signed installers. Updater signatures are separate from
Windows Authenticode code signing and do not establish a SmartScreen reputation.
Linux `linux-v*` releases do not replace the Windows latest-release pointer.

The optional Supabase backup is not required for the primary GitHub update
endpoint. Keep any service credentials in Actions secrets.
