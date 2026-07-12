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

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) 1.75+
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)
- Python 3.10+
- [ffmpeg & ffprobe](https://ffmpeg.org/download.html) (in PATH)
- [VapourSynth](https://www.vapoursynth.com/) + vspipe (for blur mode)
- [SVP Flow](https://www.svp-team.com/) (optional, for SVP interpolation)

## Setup

```bash
# Install Python dependencies
pip install -r Engine/requirements.txt

# Install frontend dependencies
cd rust
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

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
└── rust/                 # Tauri 2.0 + React frontend
    ├── src-tauri/        # Rust backend
    │   ├── src/          # Rust modules (blur, settings, weighting, etc.)
    │   └── vapoursynth/  # VapourSynth scripts for blur pipeline
    ├── src/              # React + TypeScript UI
    └── package.json
```

## License

MIT
