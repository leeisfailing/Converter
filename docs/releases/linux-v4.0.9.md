# Converter 4.0.9 — Linux

This release brings Converter to Linux as a portable AppImage, with signed Tauri updates delivered through a dedicated Linux release channel.

## What’s new

- Portable x64 AppImage with bundled Python, FFmpeg/FFprobe, and the native media engine.
- Signed update infrastructure with signature and asset verification before the Linux channel advances.
- Pause and resume the queue, retry failed or cancelled jobs, and retry all failed jobs.
- Cleaner light and dark interfaces, calmer controls, and local SF Pro/system font support.
- Neutral app branding and portable release documentation suitable for an open-source project.
- Rewritten README and Linux build, installation, and release documentation.

## Install

Download `Converter_4.0.9_amd64.AppImage`, make it executable, and launch it:

```bash
chmod +x Converter_4.0.9_amd64.AppImage
./Converter_4.0.9_amd64.AppImage
```

Keep the AppImage in a writable folder so the updater can replace it. This release targets Linux x86_64 and builds on Ubuntu 24.04; older glibc distributions and musl systems are not guaranteed compatible. GPU acceleration requires compatible host drivers.

## Verification

Ubuntu 24.04 CI passed the frontend, Rust, Python, and C++ tests, built the signed AppImage, and exercised conversion and compression using its extracted runtime. Before publication, the AppImage signature, SHA-256 digests, and uploaded files were verified. A real installed old-to-new update has not yet been verified.

This first release using the new Linux signing key requires manual installation.
Back up the Linux private signing key securely; future AppImage updates must use
the same key. The Windows signing key and updater channel remain unchanged.

Linux releases and their updater channel are independent of the Windows release channel.
