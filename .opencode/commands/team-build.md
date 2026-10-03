---
description: Run the full implementation pipeline — architect, implementation agents, QA, then final review
agent: orchestrator
---

Implement: $ARGUMENTS

Run the project pipeline end to end. Read `AGENTS.md` first and follow its
Agent Rules.

**Phase 0 — scope**
Inspect `git status` / `git diff` and the involved files. Classify the task:
trivial tasks may be done directly; anything cross-layer runs the full pipeline.

**Phase 1 — plan**
Delegate to `architect`: affected modules, interfaces/contracts, risks, and a
decomposition into steps with explicit file ownership per step.

**Phase 2 — implement**
Launch the specialists the plan names, in dependency order:
- `database-engineer` — persistence/schema/settings shape, when touched
- `backend-engineer` — Rust commands, PyEngine, cpp_engine
- `frontend-engineer` — React/TypeScript UI
- `devops-engineer` — CI, packaging, build scripts, CMake

Run two specialists in parallel only when their file sets are disjoint; never
let two agents edit the same file. Give each a scoped brief: goal, owned
paths, and the validation command to run.

**Phase 3 — test**
Delegate to `qa-engineer`. It must execute the real suites
(`npm test`, `npm run typecheck`, `cargo test`, `python3 run_tests.py`,
`ctest`, runtime verification as applicable) and report actual results —
not a reading of the code. Send failures back to the owning implementer and
re-run until green.

**Phase 4 — security**
Run `security-reviewer` when the change touches input validation, paths,
process execution, external services, secrets, or the updater. Read-only
findings first; only fix what the user delegates.

**Phase 5 — final review**
Delegate to `code-reviewer` for the whole diff. Do not declare completion with
unresolved Critical or High findings — return them to the owning implementer.

**Report** with: what changed and why, the complete file list, every check run
with its result, remaining risks, and anything deferred.
