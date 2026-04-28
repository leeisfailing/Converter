# Converter (Video, Photo & URL Downloader)

A modern, GPU-accelerated desktop application for converting media, reducing file sizes, and downloading content from the web. Built with Python and PySide6, powered by `ffmpeg` and `yt-dlp`.

## ✨ Key Features

- **Media Conversion**: Convert between various video and image formats (MP4, MKV, JPG, PNG, WEBP, etc.).
- **Advanced Size Reduction**:
  - Target file size in MB
  - Percentage-based reduction
  - Quality presets (High/Medium/Low)
- **URL Downloader**:
  - Download videos or extract audio (MP3) from YouTube and hundreds of other sites.
  - Supports direct HTTP downloads for generic files.
  - Integrated progress tracking with cancellation support.
- **Smart GPU Acceleration**:
  - Auto-detects GPU hardware (NVIDIA, AMD, Intel)
  - Hardware-accelerated encoders (NVENC, QSV, AMF, VAAPI)
  - Automatic codec prioritization based on detected hardware
- **Resolution Scaling**: Quickly scale videos to 1080p, 4K, or keep original resolution.
- **Caching System**: Persistent caching for video metadata and download paths.
- **Modern UI**:
  - Beautiful liquid glass theme with dark mode
  - Drag & drop support for easy file selection
  - Real-time progress bars for downloads and encoding
  - Intuitive format selection with combo boxes

## Requirements

### Option 1: Pre-compiled Executable (Recommended)
- **Windows 10/11**
- **No installation required** - Download the latest `Converter.exe` from [Releases](https://github.com/yourusername/converter/releases)
- Includes bundled ffmpeg binaries

### Option 2: Run from Source
- **Python 3.10+**
- **ffmpeg & ffprobe** (optional - bundled with exe):
  - Download from [ffmpeg.org](https://ffmpeg.org/download.html)
  - Or place `ffmpeg.exe` and `ffprobe.exe` in the `bin` folder
- **Python Dependencies**:
  ```bash
  pip install -r requirements.txt
  ```
  *(Includes PySide6 and yt-dlp)*

## Installation & Running

### Using Pre-compiled Executable
1. Download `Converter.exe` from the [Releases](https://github.com/yourusername/converter/releases) page
2. Double-click to run - no installation required!

### Running from Source
1. Clone or download the repository:
   ```bash
   git clone https://github.com/yourusername/converter.git
   cd converter
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. (Optional) Add ffmpeg binaries to `bin/` folder for bundled support
4. Run the application:
   ```bash
   python main.py
   ```

## Usage

### Converting or Reducing Files
1. Select **Convert format** or **Size reduce**.
2. **Drag and drop** a file onto the dashed area, or **click** it to browse your computer.
3. Choose **Output format** from the dropdown (Auto, MP4, MKV, JPG, PNG, WEBP, etc.).
4. For **Size reduce**, select reduction method:
   - **Target size (MB)**: Enter desired file size
   - **Reduce by (%)**: Enter percentage reduction
   - **Quality preset**: Choose High/Medium/Low quality
5. (Optional) Choose **Resolution** for videos (Original, 1080p, 4K).
6. Select **GPU Encoder** (Auto-detects your hardware: NVIDIA, AMD, Intel).
7. Click **Start**. The new file will be saved in the same folder as the original.

### Downloading from URL
1. Select **Download URL**.
2. Paste the video/audio URL into the URL field.
3. If it's a YouTube link, choose format (Best available, MP4 video, MP3 audio).
4. Click **Download**.
5. Choose save location when download completes.

## GPU Support Details

The app automatically detects your GPU hardware and prioritizes the best available encoders:

### Hardware Detection
- **NVIDIA GPUs**: NVENC encoders (`h264_nvenc`, `hevc_nvenc`)
- **AMD GPUs**: AMF encoders (`h264_amf`, `hevc_amf`)
- **Intel GPUs**: QSV encoders (`h264_qsv`, `hevc_qsv`)
- **Generic/Linux**: VAAPI encoders

### Features
- Auto-detection of installed GPU hardware
- Smart encoder prioritization based on detected hardware
- Fallback to CPU encoding (`libx264`) if no GPU acceleration available
- Manual encoder selection available

## Additional Features

- **Caching System**: Remembers video metadata and download paths for faster processing
- **Bundled ffmpeg**: No external dependencies required when using the exe version
- **Security**: SSL verification enabled, timeout protections
- **Cross-platform**: Windows support (Linux/Mac support possible)

## Changelog

### v2.0.0
- ✨ Bundled ffmpeg support - no external dependencies
- 🎯 Advanced size reduction (MB, %, quality presets)
- 🔍 GPU hardware auto-detection
- 💾 Persistent caching system
- 🎨 Modern liquid glass UI theme
- 📦 Pre-compiled exe available for easy installation
- 🛡️ Enhanced security and timeout protections
- 📱 Improved UI with combo box selections

### v1.0.0
- Initial release with basic conversion and download features


