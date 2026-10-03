---
description: Analyze a feature or change request and have the Architect produce an implementation plan (no code changes)
agent: orchestrator
---

Produce an implementation plan for: $ARGUMENTS

Do not implement anything in this command — planning only.

1. Read `AGENTS.md` for project architecture, commands, and agent rules.
2. Inspect the repository: `git status`, `git diff`, and the files/subsystems
   involved. Plan from the real state of the code, not from assumptions.
3. Delegate to `architect` with a brief containing: the request, the relevant
   existing modules, and what must not break (Tauri command signatures, IPC
   message shapes, settings keys).
4. If persistence, on-disk formats, or migrations are involved, get the
   `database-engineer` perspective on the data change before finalizing.
5. Ask `qa-engineer` only if the plan needs a testing feasibility check.

Return a plan with:

- **Affected modules** — exact paths per layer (UI / Rust / Python / C++).
- **Interfaces & contracts** — commands, IPC messages, settings keys, file
  formats that change, with before/after shapes.
- **Task decomposition** — ordered steps, each small enough for one agent,
  marked parallel-safe or dependent.
- **Dependency order** — which steps must be sequential
  (persistence → backend → frontend → tests → security → review).
- **Risks** — breaking changes, migration/rollback, security exposure,
  hardware/runtime assumptions.
- **Validation** — the exact commands each step must pass.

Finish by asking the user whether to proceed to `/team-build`.
