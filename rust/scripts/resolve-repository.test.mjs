import { test } from './test-runner.mjs';
import assert from 'node:assert/strict';
import { parseGitHubRemote, resolveRepository } from './resolve-repository.mjs';

test('prefers GITHUB_REPOSITORY when set', () => {
  const repo = resolveRepository({ env: { GITHUB_REPOSITORY: 'example/project' }, readOrigin: () => 'github.com/other/repo' });
  assert.equal(repo, 'example/project');
});

test('rejects a malformed GITHUB_REPOSITORY', () => {
  assert.throws(
    () => resolveRepository({ env: { GITHUB_REPOSITORY: 'not-a-repository' }, readOrigin: () => null }),
    /owner\/repository/
  );
});

test('falls back to the origin remote', () => {
  const repo = resolveRepository({ env: {}, readOrigin: () => 'https://github.com/example/project.git' });
  assert.equal(repo, 'example/project');
});

test('fails instead of guessing a repository', () => {
  assert.throws(() => resolveRepository({ env: {}, readOrigin: () => null }), /GITHUB_REPOSITORY is unset/);
});

test('parses github remote URLs', () => {
  assert.equal(parseGitHubRemote('https://github.com/example/project.git'), 'example/project');
  assert.equal(parseGitHubRemote('git@github.com:example/project.git'), 'example/project');
  assert.equal(parseGitHubRemote('ssh://git@github.com/example/project'), 'example/project');
  assert.equal(parseGitHubRemote('https://gitlab.com/example/project.git'), null);
  assert.equal(parseGitHubRemote('not a remote'), null);
});
