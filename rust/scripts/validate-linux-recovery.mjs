import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveRepository } from './resolve-repository.mjs';

export function validateRecoveryInputs({ runId, tag, version, ref }) {
  if (ref !== 'refs/heads/main') throw new Error('Linux release recovery must run from main.');
  if (typeof runId !== 'string' || !/^[1-9]\d*$/.test(runId)) throw new Error('Source run ID must be a positive integer.');
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version) || tag !== `linux-v${version}`) {
    throw new Error('Recovery tag must match the current app version.');
  }
}

/** Bind successful signed packaging and an immutable artifact to the exact release commit. */
export function validateRecoverySource({ runId, tag, version, ref, repo, tagCommit, run, jobs, artifacts }) {
  validateRecoveryInputs({ runId, tag, version, ref });
  if (!/^[0-9a-f]{40}$/.test(tagCommit) || run.head_sha !== tagCommit) throw new Error('Source run commit does not match the immutable release tag.');
  if (String(run.id) !== runId || run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) throw new Error('Source run belongs to a different repository or run.');
  if (run.event !== 'push' || run.head_branch !== tag || run.path !== '.github/workflows/linux-release.yml') throw new Error('Source run must be the trusted Linux Release tag workflow.');
  if (run.status !== 'completed' || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) throw new Error('Source run attempt is not complete.');
  const packages = jobs.filter(job => job.name === 'linux / package');
  if (packages.length !== 1 || packages[0].run_attempt !== run.run_attempt || packages[0].status !== 'completed' || packages[0].conclusion !== 'success') {
    throw new Error('The selected run attempt has no successful Linux package job.');
  }
  const candidates = artifacts.filter(artifact => artifact.name === 'release-linux');
  if (candidates.length !== 1) throw new Error('Expected exactly one signed release-linux artifact.');
  const artifact = candidates[0];
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0 || artifact.expired !== false || !(artifact.size_in_bytes > 0)
      || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest ?? '') || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== tagCommit || artifact.workflow_run?.head_branch !== tag) {
    throw new Error('Signed Linux artifact provenance, digest or availability is invalid.');
  }
  return { artifactId: artifact.id, artifactDigest: artifact.digest, tagCommit };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const main = () => {
    const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
    const runId = process.env.RECOVERY_RUN_ID;
    const tag = process.env.RECOVERY_TAG;
    const ref = process.env.GITHUB_REF;
    const repo = resolveRepository();
    validateRecoveryInputs({ runId, tag, version: config.version, ref });
    execFileSync('git', ['fetch', '--no-tags', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], { stdio: 'inherit' });
    const tagCommit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8' }).trim();
    const gh = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
    const run = gh(['api', `repos/${repo}/actions/runs/${runId}`]);
    const jobs = gh(['api', `repos/${repo}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`, '--paginate', '--slurp']).flatMap(page => page.jobs);
    const artifacts = gh(['api', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--paginate', '--slurp']).flatMap(page => page.artifacts);
    const source = validateRecoverySource({ runId, tag, version: config.version, ref, repo, tagCommit, run, jobs, artifacts });
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required for automated recovery.');
    appendFileSync(process.env.GITHUB_OUTPUT, `artifact-id=${source.artifactId}\nartifact-digest=${source.artifactDigest}\ntag-commit=${source.tagCommit}\n`);
    console.log(`Validated signed Linux package provenance for ${tag} from run ${runId}.`);
  };
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
