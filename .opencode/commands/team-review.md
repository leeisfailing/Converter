---
description: Review existing work — QA executes the test suites, security reviews risk areas, then the final code review
agent: orchestrator
---

Review: $ARGUMENTS

Review only — do not implement new features. Read `AGENTS.md` first.

**Step 1 — QA** (`qa-engineer`)
Run the real suites for the affected layers and report actual results:
`cd rust && npm test`, `cd rust && npm run typecheck`,
`cargo test --locked --manifest-path rust/src-tauri/Cargo.toml`,
`python3 run_tests.py`, and `ctest --test-dir cpp_engine/build-linux
--output-on-failure` when C++ changed. Also probe the changed behavior's edge
cases. Verdict: PASS / FAIL / PARTIAL with failures reproduced.

**Step 2 — security** (`security-reviewer`)
Review the same diff for: input validation at every process boundary, path
traversal in file/URL handling, shell injection, Tauri capability and command
exposure, secrets and signing-key handling, dependency risk, updater/signature
trust, and third-party calls (TikWM, model downloads, update endpoint).
Read-only; list findings by severity with file:line.

**Step 3 — final review** (`code-reviewer`)
Inspect the complete diff for bugs, regressions, architecture consistency,
maintainability, duplicated implementations, error handling, missing tests,
and obvious performance problems.

**Combine** into one report classified Critical / High / Medium / Low, each
finding with file:line, why it matters, and a concrete fix. State the verdict
explicitly: work is **blocked** while any Critical or High finding is
unresolved, otherwise **approved** (Medium/Low listed as follow-ups).

Include: files reviewed, commands run with results, and test coverage gaps.
