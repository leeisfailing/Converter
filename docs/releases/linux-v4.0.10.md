# Converter 4.0.10 — Linux

This update makes software updates easier to read and improves AppImage compatibility with Arch Linux.

## What’s improved

- A cleaner update panel with a clear version summary and a prominent **Install & Restart** button.
- Readable release notes with headings, lists, and code examples, plus a collapsible notes section.
- Clear download progress, retry messages, and reminders to finish queued jobs before restarting.
- Host graphics and font libraries replace bundled distribution-specific loaders, addressing the Mesa and Fontconfig warnings reported on Arch Linux.
- Fixed Linux release publication and upgraded Linux artifact actions to Node.js 24.

## Install or update

Open **About Converter**, select **Check for Updates**, then **Install & Restart**. Updates use the same Linux signing key as version 4.0.9.

For a fresh installation, download `Converter_4.0.10_amd64.AppImage` and run:

```bash
chmod +x Converter_4.0.10_amd64.AppImage
./Converter_4.0.10_amd64.AppImage
```

Keep the AppImage in a writable folder. This build targets Linux x86_64 with glibc and requires compatible host graphics drivers. Linux releases use a separate signed updater channel from Windows.
