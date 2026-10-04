---
description: Investigate a bug or failure with read-only diagnosis before changing anything, then apply a scoped fix
agent: orchestrator
---

Investigate and fix: $ARGUMENTS

Read `AGENTS.md` first. Investigate before editing.

**Phase 1 — read-only diagnosis (no edits)**
1. Restate the report: exact steps/inputs, observed result, expected result.
2. Locate the code path across layers — UI (`rust/src/`) → Rust commands
   (`rust/src-tauri/src/`) → Python (`PyEngine/`) → C++ (`cpp_engine/`).
   Use `explore` for searching; read the actual implementation.
3. Reproduce it. Prefer a failing test written first (hand that to
   `qa-engineer`, or use the ECC `tdd` workflow). Show the failure before
   changing code.
4. State a root cause with file:line evidence. If evidence is missing, gather
   more — do not guess and patch.

**Phase 2 — scoped fix**
1. Route the fix to the owning specialist:
   `frontend-engineer` / `backend-engineer` / `database-engineer` /
   `devops-engineer`. One owner per file.
2. Modify the smallest surface that fixes the root cause. Do not refactor
   unrelated code and do not delete anything not implicated.
3. If the fix changes a contract (Tauri command, IPC shape, settings key) or a
   persisted format, call that out and involve `database-engineer` /
   `frontend-engineer` as needed.

**Phase 3 — verify**
- Re-run the failing test until green, then run the layer's full suite:
  `cd rust && npm test`, `cargo test --locked --manifest-path
  rust/src-tauri/Cargo.toml`, `python3 run_tests.py`, `ctest --test-dir
  cpp_engine/build-linux --output-on-failure`, plus `cd rust && npm run
  typecheck` for TS changes.
- Run `security-reviewer` when validation, paths, process execution, or
  external calls were touched.

**Report**: root cause, fix with reasoning, files changed, checks run with
results, and any similar latent issue you noticed but did not fix.
