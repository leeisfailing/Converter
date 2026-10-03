/**
 * Test entry point shared by the two harnesses used in this repository.
 *
 * - `node --test rust/scripts/*.test.mjs` (used to verify these scripts)
 * - `npm test` → vitest, which globs `scripts/*.test.mjs` as well
 *
 * Vitest exports its own `test`, and `node:test`'s `test` never runs when the
 * file is loaded by vitest (vitest then fails with "No test suite found").
 * Loading exactly one runner — vitest sets `VITEST` — keeps the same file
 * green under both without pulling either harness into the other.
 */
const runner = process.env.VITEST ? await import('vitest') : await import('node:test');

/** Register a test with whichever harness loaded this file. */
export const test = runner.test ?? runner.it;
