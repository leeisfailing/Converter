# Update, performance, and queue review

Review date: 2026-10-06. These fixes extend the Linux/Windows shipping review.
The user authorized pushing `main` and `Windows` and restoring the verified
Linux releases. Shared source changes belong on both branches; Windows keeps
its Windows build workflows and platform README.

## Queue and performance

Pause now suspends owned running media processes and their children and holds
waiting jobs. Resume continues those processes. Cancellation resumes suspended
processes before cleanup. The UI waits for backend acknowledgment, prevents
concurrent pause requests, and reports failures instead of displaying a false
paused state. Linux uses owned process groups; Windows tracks process threads,
checks their owners, and preserves suspension counts it did not introduce.

The screenshot showed NVIDIA encoder utilization at 100%; low general GPU
utilization does not mean NVENC was unused. The other GPU may render the desktop.
GPU selection controls media encoding, with CPU use still possible for audio,
I/O, and unsupported decoding/filtering. A real target-size bug was fixed:
NVENC/AMF fallback trials now use bitrate-controlled modes so retry budgets
change output size. Python trial progress now advances during encoding.

## Update diagnosis and recovery

The public `updater-linux/latest-linux.json` and `linux-v4.0.9` release were
missing. Retained original signed v4.0.9 assets were recovered and verified;
no binary was rebuilt or re-signed. The AppImage SHA-256 is
`dd43935b93e9b0865e137fbcfabaaf47ba515b2495e95a6402e02e0bcd1b566d`.
The recovery restored that version release and the Linux update channel.
The public manifest returned HTTP 200 with version 4.0.9; an anonymous AppImage
download matched the original hash and passed signature verification. Windows
latest remained tag `2.0`. Missing manifests now produce a
specific diagnostic instead of a generic network error.

The actual `/home/lee/Converter_4.0.8_amd64.AppImage` embeds the Windows signing
key, despite the tagged v4.0.8 Linux configuration containing the Linux key.
That installed binary cannot authenticate v4.0.9 automatically. Manually
install the verified v4.0.9 AppImage once; its actual binary was inspected and
contains the correct Linux key and endpoint. Signature checks remain enabled.
The restored v4.0.9 binary predates these new fixes. They are v4.0.10 source
changes and require a new signed package before installed users receive them.

## Validation and limits

- Frontend: 297 tests across 30 files passed; typecheck and production build passed.
- Final targeted queue/updater/command checks: 74 tests passed.
- Bundled Python: 113 tests run, one Windows-only skip, all others passed.
- Rust: 79 library and four startup tests passed.
- Native C++ build and both CTests passed.
- Linux runtime/native verification and v4.0.10 release/resource validation passed.
- Actual Linux process/descendant pause, resume, cancellation, late registration,
  and rollback checks passed.
- Final Windows conditional typecheck and Linux pause tests passed after the
  thread-owner safeguard; independent security/code review found no Critical
  or High blocker. Whitespace checks passed.

Windows process suspension still requires execution on Windows; a conditional
compile is not a Windows runtime test. AMD/Intel hardware and an installed
AppImage update/restart were not exercised. No new v4.0.10 binary was published.

## Files changed

```text
PyEngine/tests/test_inventory_performance.py
PyEngine/tests/test_media_pipelines.py
PyEngine/tests/test_target_size.py
PyEngine/workers/target_size.py
README.md
cpp_engine/src/target_size.cpp
rust/src-tauri/src/cpp_engine.rs
rust/src-tauri/src/engine.rs
rust/src-tauri/src/lib.rs
rust/src-tauri/src/media_engine.rs
rust/src-tauri/src/operations.rs
rust/src-tauri/src/process_output.rs
rust/src-tauri/src/process_pause.rs
rust/src/App.tsx
rust/src/components/QueueManager.tsx
rust/src/components/Settings.tsx
rust/src/lib/tauri-commands.ts
rust/src/lib/updater.ts
rust/src/lib/useQueue.ts
rust/tests/queue-manager.test.tsx
rust/tests/queue.test.tsx
rust/tests/updater.test.ts
docs/shipping-review.md
docs/update-performance-review.md
```
