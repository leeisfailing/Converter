import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { validateRecoveryInputs, validateRecoverySource } from './validate-linux-recovery.mjs';

function fixture() {
  const sha = 'a'.repeat(40);
  return { runId: '123', tag: 'linux-v4.0.9', version: '4.0.9', ref: 'refs/heads/main', repo: 'example/project', tagCommit: sha,
    run: { id: 123, head_sha: sha, head_branch: 'linux-v4.0.9', repository: { full_name: 'example/project' }, head_repository: { full_name: 'example/project' }, event: 'push', path: '.github/workflows/linux-release.yml', status: 'completed', run_attempt: 2 },
    jobs: [{ name: 'linux / package', run_attempt: 2, status: 'completed', conclusion: 'success' }],
    artifacts: [{ id: 456, name: 'release-linux', expired: false, size_in_bytes: 10, digest: `sha256:${'b'.repeat(64)}`, workflow_run: { id: 123, head_sha: sha, head_branch: 'linux-v4.0.9' } }] };
}
test('accepts successful signed package from exact immutable tag commit and attempt', () => {
  const result = validateRecoverySource(fixture());
  assert.equal(result.artifactId, 456);
});
for (const [name, mutate] of [
  ['old branch', f => { f.ref = 'refs/tags/linux-v4.0.9'; }],
  ['shell input', f => { f.runId = '123; echo unsafe'; }],
  ['wrong version', f => { f.tag = 'linux-v4.0.8'; }],
  ['branch push instead of tag', f => { f.run.head_branch = 'main'; }],
  ['wrong artifact tag', f => { f.artifacts[0].workflow_run.head_branch = 'main'; }],
  ['wrong tag commit', f => { f.run.head_sha = 'c'.repeat(40); }],
  ['fork repository', f => { f.run.head_repository.full_name = 'attacker/project'; }],
  ['wrong repository', f => { f.run.repository.full_name = 'attacker/project'; }],
  ['wrong run', f => { f.run.id = 999; }],
  ['pull request artifact', f => { f.run.event = 'pull_request'; }],
  ['unsigned workflow', f => { f.run.path = '.github/workflows/linux.yml'; }],
  ['unfinished run', f => { f.run.status = 'in_progress'; }],
  ['failed packaging', f => { f.jobs[0].conclusion = 'failure'; }],
  ['earlier attempt success', f => { f.jobs[0].run_attempt = 1; }],
  ['ambiguous package jobs', f => { f.jobs.push({ ...f.jobs[0] }); }],
  ['unsigned artifact', f => { f.artifacts[0].name = 'linux-appimage-smoke'; }],
  ['expired artifact', f => { f.artifacts[0].expired = true; }],
  ['empty artifact', f => { f.artifacts[0].size_in_bytes = 0; }],
  ['missing digest', f => { delete f.artifacts[0].digest; }],
  ['wrong artifact commit', f => { f.artifacts[0].workflow_run.head_sha = 'c'.repeat(40); }],
  ['wrong artifact run', f => { f.artifacts[0].workflow_run.id = 999; }],
  ['ambiguous artifact names', f => { f.artifacts.push({ ...f.artifacts[0], id: 999 }); }],
]) {
  test(`rejects recovery from ${name}`, () => {
    const f = fixture(); mutate(f); assert.throws(() => validateRecoverySource(f));
  });
}
test('rejects inputs before any repository or GitHub operation', () => {
  assert.throws(() => validateRecoveryInputs({ ...fixture(), runId: '../123' }), /positive integer/);
});
