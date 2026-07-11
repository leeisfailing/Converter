# Converter

A desktop media converter and URL downloader built with **Tauri 2.0** (Rust + React) and a **Python engine** powered by ffmpeg and yt-dlp.

## Features

- Convert between video and image formats (MP4, MKV, JPG, PNG, WEBP, etc.)
- Reduce file sizes with target size, percentage, or quality presets
- Download videos/audio from YouTube and hundreds of sites via yt-dlp
- Auto-detect GPU hardware encoders (NVIDIA, AMD, Intel)
- Scale video resolution (1080p, 4K, or keep original)
- Queue system with real-time progress tracking
- Liquid glass dark UI

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) 1.75+
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)
- Python 3.10+
- [ffmpeg & ffprobe](https://ffmpeg.org/download.html) (in PATH)

## Setup

```bash
# Install Python dependencies
pip install -r python-engine/requirements.txt

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
├── python-engine/        # Python backend (ffmpeg, yt-dlp)
│   ├── engine.py         # JSON-RPC entry via stdin/stdout
│   ├── converter_worker.py
│   ├── download_worker.py
│   └── requirements.txt
└── rust/                 # Tauri 2.0 + React frontend
    ├── src-tauri/        # Rust backend
    ├── src/              # React + TypeScript UI
    └── package.json
```

## License

MIT
