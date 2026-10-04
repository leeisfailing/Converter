# Converter — Agent Instructions

Shared knowledge for every agent working in this repository. Read this file
before substantial work.

## Project Overview

**Purpose**: A desktop application for downloading, converting, compressing,
upscaling, and AI-enhancing media files.

**Architecture**: A Tauri v2 desktop app with four cooperating layers.

| Layer | Tech | Role |
| --- | --- | --- |
| UI | React 18 + TypeScript + Tailwind + framer-motion | User interface, queue state, settings |
| Shell | Rust (Tauri commands) | Process orchestration, settings, caches, validation, IPC surface |
| Media engine (Python) | Python 3.11+ `PyEngine` | yt-dlp/TikTok download, FFmpeg workers, ONNX enhancement |
| Media engine (C++) | `cpp_engine` (CMake) | High-performance conversion/reduction/upscale pipeline |

The UI talks to Rust through Tauri commands (`rust/src-tauri/src/commands/`).
Rust spawns the Python engine (`PyEngine/__main__.py`, JSON-lines IPC) and the
native C++ engine, both of which shell out to FFmpeg/FFprobe sidecars.

**Package manager**: npm only, in `rust/` (there is no root `package.json`).

**Major subsystems**:
- Download (yt-dlp, plus a separate TikWM HTTP downloader for TikTok links)
- Convert / Transcoder (quality and target-size reduction)
- Upscale (video/image, hardware-aware) and Enhance (Real-ESRGAN via ONNX)
- Job queue with progress, cancellation, and cancellation-safe cleanup
- Settings (GPU selection, themes, output folders) and a debug console
- Signed updater (Windows releases only; `updater.key.pub` is public, the
  private key must never be committed)

**Platform**: Windows x64 (installer/portable builds) and Linux glibc
(x86_64/aarch64, app executable only). CI runs on Node.js 24, Python 3.12,
stable Rust.

## Repository Structure

```text
Converter/
├── AGENTS.md                  This file — project + agent instructions
├── opencode.json              OpenCode project config (allow-all permissions, default agent)
├── .opencode/                 Project agents and commands (see below)
├── run_tests.py               Python test runner (system Python)
├── rust/
│   ├── src/                   React components (components/) and TS logic (lib/)
│   ├── src/lib/               Pure TS helpers + hooks-adjacent logic (unit tested)
│   ├── tests/                 Vitest frontend regression tests (mirrors src/)
│   ├── scripts/               Release/utility scripts (.mjs) + their tests
│   ├── src-tauri/src/         Rust: main.rs, lib.rs, commands/, engine glue
│   ├── src-tauri/src/commands/ Tauri command surface (media, detect, config)
│   ├── src-tauri/tests/       Rust integration tests
│   ├── src-tauri/tauri.conf.json / tauri.linux.conf.json  Build config
│   └── src-tauri/capabilities/ Tauri capability/permission grants
├── PyEngine/
│   ├── __main__.py            JSON-lines engine entry point
│   ├── core/                  Tool lookup, GPU detection, config, security, models
│   ├── handlers/              Command dispatch (convert, download, reduce, ...)
│   ├── workers/               FFmpeg, downloader, enhancer, upscaler, reducer
│   ├── formats/               Format tables and detection
│   └── tests/                 Python unit/integration tests
├── cpp_engine/
│   ├── src/ include/          Native engine sources and headers
│   ├── tests/worker_tests.cpp CTest suite
│   └── CMakeLists.txt         Native build definition
├── scripts/                   Runtime setup/verification (Python) + build scripts
└── .github/workflows/         ci.yml (Windows), linux.yml, release.yml
```

Generated/ignored: `node_modules/`, `rust/src-tauri/target/`,
`cpp_engine/build-linux/`, `rust/src-tauri/bin/linux/`,
`rust/src-tauri/bin/python/`, `.runtime-downloads/`, `__pycache__/`,
`.token-savior-cache.json` (MCP token-savior search cache; regenerates
on demand — never edit or commit it).
Never edit files under those paths; regenerate them with the setup scripts.

## Development Commands

All npm commands run from `rust/`. Commands below are the real ones; do not
invent alternatives.

### Install / setup

```bash
cd rust && npm ci --include=optional      # JS deps (keeps native bindings intact)
cd rust && npm run setup:linux            # Linux: private Python runtime + C++ engine
python scripts/bundle_runtime.py          # Windows: bundled runtime
./scripts/build_cpp_engine.ps1            # Windows: native engine
```

### Develop

```bash
cd rust && npm run tauri dev              # start the app (applies tauri.linux.conf.json on Linux)
cd rust && npm run preview                # frontend-only preview
```

### Build

```bash
cd rust && npm run build                  # typecheck + Vite bundle (frontend only)
cd rust && npm run build:linux            # Linux app -> src-tauri/target/release/converter
cd rust && npm run build:installer        # Windows NSIS installer
cd rust && npm run build:portable         # Windows portable zip
```

### Static checks (there is no linter/formatter configured)

```bash
cd rust && npm run typecheck              # tsc --noEmit  (the type gate)
cd rust && npm run build                  # tsc runs as part of build
cd rust && npm run release:check          # version/manifest consistency (releases)
```

### Tests

```bash
# Frontend (Vitest, jsdom)
cd rust && npm test

# Python (system Python, fast)
python3 run_tests.py

# Python (bundled Linux runtime, matches CI)
rust/src-tauri/bin/linux/python/bin/python3 -B -m unittest discover -s PyEngine/tests -v

# Rust
cargo test --locked --manifest-path rust/src-tauri/Cargo.toml

# C++ (requires `npm run setup:linux` first)
ctest --test-dir cpp_engine/build-linux --output-on-failure

# Runtime verification
python3 scripts/verify_linux_runtime.py          # Linux
python scripts/verify_bundled_runtime.py         # Windows
```

On Node.js 26+, jsdom tests may fail with an unavailable `localStorage`:
`NODE_OPTIONS=--no-experimental-webstorage npm test`.

There is **no** Playwright/E2E harness and **no** root-level integration test
command. Integration coverage lives in `PyEngine/tests/test_integration.py`,
`rust/tests/*.test.tsx`, and `rust/src-tauri/tests/`.

### What CI runs (mirror this before declaring work done)

`.github/workflows/linux.yml`, in order:

```bash
npm ci --include=optional                 # in rust/
npm run setup:linux                       # in rust/
ctest --test-dir cpp_engine/build-linux --output-on-failure
python3 scripts/verify_linux_runtime.py
rust/src-tauri/bin/linux/python/bin/python3 -B -m unittest discover -s PyEngine/tests -v
npm test                                  # in rust/
npm run build                             # in rust/
cargo test --locked --manifest-path rust/src-tauri/Cargo.toml
```

## Coding Standards

Derived from the existing code — match it rather than introducing a new style.

- **Small, focused modules.** `rust/src/lib/` is one concern per file
  (`file-size.ts`, `clipboard.ts`, `media-paths.ts`). Keep functions short.
- **TypeScript is strict** (`"strict": true`). No `any` unless unavoidable;
  prefer explicit interfaces (`interface Props { ... }`) and discriminated
  unions for state. Use the `@/` path alias for `src/`.
- **React**: function components with a local `interface Props`, default
  export, Tailwind utilities plus the existing semantic classes (`panel`,
  `section-header`, `text-app-text-*`). Reuse `components/Select`, `SliderField`,
  `Toggle`, `Section`, `Toast` — do not hand-roll equivalents. `framer-motion`
  for motion, `lucide-react` for icons, `aria-*` attributes on interactive
  elements. Respect the light/dark theme tokens in `index.css`/`tailwind.config.js`.
- **Rust**: explicit error handling with `Result<T, String>` and descriptive
  messages; validation centralized in `validation.rs` (`validate_path`,
  `validate_url`, ...) — call it at every new command boundary. Named constants
  for limits (`MAX_PATH_LENGTH`, `MAX_URL_LENGTH`). No `unwrap()` on
  user-supplied input.
- **Python**: module docstrings, type hints on public functions, module-level
  constants for limits, `ValueError` with a descriptive f-string for bad input.
  Validation helpers live in `PyEngine/core/security.py` — reuse them.
- **C++**: keep worker logic in `cpp_engine/src/`, headers in `include/`, and
  add coverage to `cpp_engine/tests/worker_tests.cpp`.
- **Explicit error handling everywhere.** Never swallow a failure; surface a
  message the UI can show and log it through the existing debug console path.
- **Validate all external input.** URLs, paths, file names, and sizes cross a
  process boundary (UI → Rust → Python/C++). Every boundary validates.
- **Minimal duplication.** Check `rust/src/lib/`, `PyEngine/core/`, and
  `cpp_engine/src/` for an existing helper before writing a new one.
- **No unnecessary abstraction.** No speculative interfaces, no premature
  factories, no new dependencies without a stated need.
- **Formatting**: match the surrounding file (2-space indent, double quotes in
  TS/TSX). There is no auto-formatter configured — do not add one as a side
  effect of another task.

## Agent Team

ECC is installed globally at `~/.config/opencode` (profile `full`, v2.2.3).
**Do not reinstall or duplicate it.** Its agents, commands, and skills are
already available; reuse them.

### Project agents (`.opencode/agents/`)

| Agent | Scope |
| --- | --- |
| `orchestrator` | Team lead: reads the request, plans, delegates, sequences, reports |
| `frontend-engineer` | `rust/src/**`, `rust/tests/**`, frontend config |
| `backend-engineer` | `rust/src-tauri/src/**`, `PyEngine/**`, `cpp_engine/{src,include,tests}` |
| `database-engineer` | Persistence/data layer: settings, caches, models, config, migrations |
| `devops-engineer` | `.github/`, `scripts/`, `rust/scripts/`, CMake, Tauri build config |
| `qa-engineer` | Test suites and test-only files; runs the real test commands |

### Reused ECC agents (do not recreate)

| Need | ECC agent |
| --- | --- |
| Architecture/design | `architect` (advises first; prefers not to edit) |
| Planning breakdown | `planner` |
| Security review | `security-reviewer` (read-only by preference; edits only a delegated fix) |
| Final code review | `code-reviewer` (read-only, blocks on Critical/High) |
| Test-first implementation | `tdd-guide` |
| E2E (when a harness exists) | `e2e-runner` |
| Language review | `rust-reviewer`, `cpp-reviewer`, `python-reviewer` |
| Build/type errors | `build-error-resolver`, `rust-build-resolver`, `cpp-build-resolver` |
| Docs | `doc-updater`, `refactor-cleaner`, `explore`, `general` |

### Delegation flow

Substantial tasks follow this pipeline:

```text
architect  →  implementation agent(s)  →  qa-engineer  →  security-reviewer  →  code-reviewer
```

- **Parallel only when independent** (e.g. a React component + an unrelated
  Rust command + their own tests). Never let two agents edit the same file at
  the same time — one owner per artifact.
- **Sequential when dependent**: schema/persistence → backend → frontend →
  tests → security → review.
- The orchestrator owns conflict prevention: assign file ownership before
  fanning out, and reconcile results before review.
- Keep delegation to two levels: orchestrator → specialist → `explore`.
  Do not spawn further editing agents below a specialist — this is a rule, not
  a permission gate.

### Commands

| Command | Runs |
| --- | --- |
| `/team-plan <feature>` | orchestrator → architect plan |
| `/team-build <feature>` | architect → implementers → qa-engineer → code-reviewer |
| `/team-review <target>` | qa-engineer → security-reviewer → code-reviewer |
| `/team-debug <issue>` | read-only investigation, then a scoped fix |

ECC commands are available too (`/plan`, `/tdd`, `/code-review`, `/security`,
`/orchestrate`, `/verify`, `/rust-review`, `/cpp-review`, `/python-review`, ...).

## Agent Rules

Every agent must:

1. Read `AGENTS.md` before substantial work.
2. Inspect existing implementations before creating new ones.
3. Prefer modifying existing systems over duplicating them.
4. Follow the existing project architecture (UI → Rust → Python/C++).
5. Keep changes scoped to the assigned task.
6. Never delete unrelated code.
7. Never silently introduce breaking changes (public Tauri commands, IPC
   message shapes, and settings keys are contracts).
8. Run appropriate validation after changes — at minimum the type check for
   TS changes, and the matching test suite for the layer touched.
9. Report every file changed.
10. Report every test/check performed, with its result.

## Safety

`opencode.json` grants **allow-all** permissions (by choice), so nothing is
blocked mechanically — these rules are the actual guardrail:

- Never commit or echo secrets: `rust/src-tauri/private_key.pem`,
  `private_key_hex.txt`, `**/updater.key`, `**/updater.key.password`, `.env*`.
  `TAURI_SIGNING_PRIVATE_KEY` exists only as a CI secret.
- Third-party calls (TikWM for TikTok, model downloads, update endpoints) must
  stay behind explicit error handling; availability is never assumed.
- Prefer read-only shell for inspection (`git status`, `git diff`, `git log`).
  Confirm destructive or repo-wide commands (`rm -rf`, `git push --force`,
  `git reset --hard`, dropping files outside the repo) with the user first.
- Do not regenerate bundled runtimes or build artifacts unless the task is
  about them; they are large and git-ignored.
