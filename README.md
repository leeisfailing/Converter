# Converter

A desktop media converter, URL downloader, and motion blur tool built with **Tauri 2.0** (Rust + React) and a **Python engine** powered by ffmpeg and yt-dlp.

## Features

- Convert between video and image formats (MP4, MKV, JPG, PNG, WEBP, etc.)
- Reduce file sizes with target size, percentage, or quality presets
- Download videos/audio from YouTube and hundreds of sites via yt-dlp
- Auto-detect GPU hardware encoders (NVIDIA, AMD, Intel)
- Scale video resolution (1080p, 4K, or keep original)
- Queue system with real-time progress tracking
- **Motion Blur** — apply cinematic motion blur with 8 weighting functions (equal, ascending, descending, pyramid, gaussian, vegas, etc.)
- **Interpolation** — SVP and RIFE motion interpolation for smooth slow-motion or high frame rate
- **Deduplication** — detect and drop duplicate/stalled frames
- **Timescale** — time stretching and compression
- **Video filters** — sharpness, denoise, brightness, contrast, gamma, saturation
- **Encoding presets** — GPU-optimized for NVIDIA, AMD, Intel, Mac VideoToolbox, and CPU
- Liquid glass dark UI
- **Auto-Updates** — automatic updates via GitHub Releases with signature verification

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) 1.75+
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)
- Python 3.11+ (to prepare the build runtime)
- ffmpeg and ffprobe are included in `Engine/bin/`.
- The Windows app includes private Python, yt-dlp, VapourSynth, and vspipe runtimes.
- [SVP Flow](https://www.svp-team.com/) (optional, for SVP interpolation)

## Setup

```bash
# Assemble the Windows x64 runtime (pinned downloads with SHA-256 checks)
python scripts/bundle_runtime.py

# Install frontend dependencies
cd rust
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

The runtime setup installs Python 3.12.10, VapourSynth R77, and yt-dlp
2026.07.04 into `rust/src-tauri/bin/python/`. Tauri copies the extracted tree
to `Engine/bin/python/` in the app resources, including its standard library,
native libraries, and Python packages. The application uses this interpreter
before searching the system. Its installed users do not need Python or pip.
CI and release workflows run the setup script before compiling. Generated
runtime files and cached downloads are ignored by Git; rerun setup after a
fresh checkout. Earlier runtime contents are retained in `.runtime-downloads/`.
Run `python scripts/verify_bundled_runtime.py` to exercise a temporary installed
layout with system Python and media tools removed from its PATH. This checks
imports, engine IPC, ffmpeg/ffprobe, vspipe, and the bundled LSMASHSource plugin.

## Automatic Updates

Converter uses **GitHub Releases** and the **Tauri 2 Updater** plugin for automatic updates. All updates are signed and verified before installation.

### How It Works

1. The app checks for updates against GitHub Releases
2. If a newer version is found, the user is notified
3. The update is downloaded and signature-verified
4. The app installs and restarts automatically

### Versioning

Converter uses **semantic versioning** (e.g., `3.0.0`, `3.0.1`, `3.1.0`). The version is defined in three places and must stay synchronized:

- `rust/src-tauri/Cargo.toml` — `version = "3.0.0"`
- `rust/src-tauri/tauri.conf.json` — `"version": "3.0.0"`
- `rust/package.json` — `"version": "3.0.0"`
- `rust/src/App.tsx` — `v3.0` badge

### Creating a Release

1. Update the version in all four files listed above
2. Commit the changes
3. Tag the release:
   ```bash
   git tag v3.1.0
   git push origin v3.1.0
   ```
4. The GitHub Actions workflow will automatically:
   - Build the frontend
   - Build the Tauri application
   - Sign the updater artifacts
   - Create a GitHub Release with all artifacts
   - Upload the `latest.json` metadata for the updater

### Required GitHub Actions Secrets

The following secrets must be configured in **Settings → Secrets and variables → Actions** for the `leeisfailing/Converter` repository:

| Secret Name | Description |
|---|---|
| `TAURI_PRIVATE_KEY` | The private signing key (PEM format) for signing updater artifacts |
| `TAURI_PRIVATE_KEY_PASSWORD` | Password protecting the private signing key |

### Generating Signing Keys

Run the following command to generate a new signing key pair:

```bash
cd rust
npx tauri signer generate
```

This creates:
- `src-tauri/public_key.pem` — The **public key** (committed to the repo, also in `tauri.conf.json`)
- `src-tauri/private_key.pem` — The **private key** (NEVER committed; add to GitHub Actions secrets)

**Important:** The `private_key.pem` and `private_key_hex.txt` are excluded via `.gitignore`. Never commit signing keys to the repository.

### How Update Signing Works

1. The updater generates an ED25519 public/private key pair
2. The public key is embedded in `tauri.conf.json` (`plugins.updater.pubkey`)
3. During a release, `tauri-action` signs the updater artifacts with the private key
4. The `latest.json` metadata is signed
5. When the app checks for updates, it downloads the `latest.json`
6. The app verifies the signature using the embedded public key before installing
7. **Unsigned or tampered updates are rejected**

### Testing Updates

To test the update flow:

1. **Build v1.0.0**: Set version to `3.0.0`, build and install
2. **Create v1.0.1 release**: Bump version to `3.0.1`, push tag
3. **Check for updates**: Open Converter → Settings → About → "Check for Updates"
4. **Install**: Click "Update Now" and verify the app restarts with the new version

### Update UI

- **Settings → About** button triggers manual update check
- Update notifications appear in a dedicated overlay with:
  - Version comparison
  - Release notes (from GitHub)
  - Update Now / Later options
  - Progress indicators for download and install
  - Error handling for offline/timeout scenarios

### Auto-Check Behavior

- Updates are checked on-demand (user-initiated)
- The app does not check on every startup
- If GitHub is unavailable, the app continues normally without interruption
- The last check result is cached in-app

## Project Structure

```
Converter/
├── Engine/               # Python backend (ffmpeg, yt-dlp)
│   ├── __main__.py       # JSON-RPC entry via stdin/stdout
│   ├── core/             # IPC & config utilities
│   ├── workers/          # Converter & downloader workers
│   ├── handlers/         # Command handlers
│   ├── formats/          # Format definitions & detection
│   └── requirements.txt
├── rust/                 # Tauri 2.0 + React frontend
│   ├── src-tauri/        # Rust backend
│   │   ├── src/          # Rust modules (blur, settings, weighting, etc.)
│   │   ├── vapoursynth/  # VapourSynth scripts for blur pipeline
│   │   ├── public_key.pem    # Updater public key (committed)
│   │   ├── private_key.pem   # Updater private key (NEVER committed)
│   │   └── tauri.conf.json   # Includes updater config
│   ├── src/              # React + TypeScript UI
│   │   ├── components/
│   │   │   ├── About.tsx       # Update UI & About screen
│   │   │   └── Settings.tsx    # Updated with About button
│   │   └── lib/
│   │       ├── updater.ts      # Updater state management
│   │       └── tauri-commands.ts
│   └── package.json
├── .github/workflows/
│   └── release.yml     # GitHub Actions release pipeline
└── .gitignore           # Excludes private signing keys
```

## License

MIT
