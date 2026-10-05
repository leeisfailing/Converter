# Linux and Windows shipping review

Review date: 2026-10-06. This records local source validation, not approval of
unbuilt release binaries. The existing uncommitted v4.0.10 AppImage, update UI,
and release-note changes were preserved in the combined source revision.

## Branch layout

- `main`: combined Linux and Windows open-source project.
- `Windows`: shared application and engines, Windows-focused README, Windows
  checks/releases only. Linux source/configuration remains available; the three
  Linux workflow files are removed on this branch only.
- Branches are prepared locally. No remote push, release tag, release upload,
  or signing-key change was performed.

## Corrections

- Windows push CI includes `Windows`; checkout credentials are not persisted.
- Windows release runs require the matching version tag and reject an existing
  published release. Portable ZIPs are uploaded to the same installer draft.
- Portable packaging fails on archive errors and rejects missing/empty/non-ZIP
  archives. Its adjacent marker prevents automatic installer updates.
- Windows private Python now installs the existing six pinned AI wheels and
  checks NumPy, OpenCV, and ONNX Runtime imports and CPU execution support.
- Native Windows processing uses UTF-16 filesystem/process/probe boundaries
  and Windows argument escaping. Regression tests cover Unicode and spaces.
- NVIDIA Wayland startup defaults the explicit-sync workaround before Tauri
  initialization, preserving explicit environment overrides and X11 choices.
- Newly constructed ONNX sessions verify cached model bytes against their
  pinned digest; corrupt cached bytes require a verified replacement.
- Both sidecar streaming paths validate ID and JSON limits before spawning.
- The documented Node script-test command now supports every script test.
- Linux private-key filename variants are ignored by Git.

## Validation

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 291 passed across 30 files |
| `npm run build` | Passed |
| `node --test scripts/*.test.mjs` | 145 passed |
| Bundled Linux Python unittest discovery | 109 passed, 1 Windows-only skip |
| Cached model integrity regressions | 24 enhancement-cache tests passed |
| `cargo test --locked --manifest-path rust/src-tauri/Cargo.toml` | 75 library + 4 startup tests passed |
| Linux debug executable build | Passed |
| C++ build and CTest | Passed, 2 CTests |
| `python3 scripts/verify_linux_runtime.py` | Passed |
| `npm run release:check -- --linux-only --resources` | Passed |
| NVIDIA Wayland desktop startup | Survived 20-second timed launch, no GDK/WebKit errors logged |
| `git diff --check` | Passed |
| Tracked private-key filenames/PEM markers and files above 50 MiB | No matches |

Node.js 26 tests used `NODE_OPTIONS=--no-experimental-webstorage`; CI uses Node.js
24. Sandbox restrictions initially blocked local sockets, subprocesses, and CUDA;
approved reruns passed. NVIDIA H.264/HEVC media pipelines were exercised. Local
logs are in `/tmp/converter-audit/` and are not committed.

## Remaining release validation

Windows compilation, private-runtime execution, Unicode regressions, installer
and portable launch, and installed old-to-new updates require a Windows runner
and clean Windows machine. Linux production AppImage packaging and signed
old-to-new updates require the Ubuntu release workflow and retained signing key.
No new signed package was produced by this review. AMD/Intel hardware and wider
distribution compatibility were not tested. Workflow changes were reviewed as
source; no local PowerShell or dedicated workflow YAML validator was available.

Two nonblocking audit findings remain: downloader DNS resolution/redirects are
not constrained by the literal-host checks, and FFmpeg archive documentation/
notices are not currently copied alongside extracted Windows executables.
Third-party distribution attribution and source notices need review before
publishing binary packages. This source audit is not a dependency advisory or
legal compliance certification.

Architecture, QA, security, and final code review found no outstanding Critical
or High issue in the reviewed changes after corrections.

## Files changed in the combined revision

This list includes the preserved pre-existing changes:

```text
.github/workflows/ci.yml
.github/workflows/release.yml
.gitignore
AGENTS.md
PyEngine/core/model_manager.py
PyEngine/tests/test_enhancement_cache.py
PyEngine/tests/test_windows_runtime.py
README.md
cpp_engine/include/native_paths.h
cpp_engine/include/process_pipe.h
cpp_engine/src/config.cpp
cpp_engine/src/ffmpeg_worker.cpp
cpp_engine/src/formats.cpp
cpp_engine/src/handlers.cpp
cpp_engine/src/security.cpp
cpp_engine/src/target_size.cpp
cpp_engine/tests/worker_tests.cpp
docs/releases.md
docs/releases/linux-v4.0.10.md
docs/shipping-review.md
docs/windows-releases.md
rust/package-lock.json
rust/package.json
rust/scripts/appimage-host-libraries.mjs
rust/scripts/appimage-host-libraries.test.mjs
rust/scripts/build-linux.mjs
rust/scripts/build-portable.mjs
rust/scripts/build-portable.test.mjs
rust/scripts/bundle-resources.test.mjs
rust/scripts/test-runner.mjs
rust/src-tauri/Cargo.lock
rust/src-tauri/Cargo.toml
rust/src-tauri/src/commands/updater.rs
rust/src-tauri/src/cpp_engine.rs
rust/src-tauri/src/engine.rs
rust/src-tauri/src/linux_graphics.rs
rust/src-tauri/src/main.rs
rust/src-tauri/tauri.conf.json
rust/src/components/ReleaseNotes.tsx
rust/src/components/UpdatePanel.tsx
rust/src/index.css
rust/tests/release-notes.test.tsx
rust/tests/update-panel.test.tsx
scripts/bundle_runtime.py
scripts/verify_bundled_runtime.py
```

The Windows specialization changes only `README.md` and removes
`.github/workflows/linux.yml`, `.github/workflows/linux-release.yml`, and
`.github/workflows/linux-release-recovery.yml` relative to `main`.
