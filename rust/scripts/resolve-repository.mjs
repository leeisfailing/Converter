import { execFileSync } from 'node:child_process';

/**
 * `owner/repository` as accepted by the GitHub API.
 * Deliberately strict so a malformed GITHUB_REPOSITORY fails instead of
 * silently validating URLs for some other repository.
 */
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Resolve the GitHub repository this checkout publishes to.
 *
 * Order: GITHUB_REPOSITORY (set by GitHub Actions), then the `origin` remote
 * of the local checkout. There is intentionally no hardcoded fallback: a
 * misconfigured fork must fail loudly instead of validating upstream URLs.
 *
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, readOrigin?: (cwd?: string) => string | null }} [options]
 * @returns {string} `owner/repository`
 */
export function resolveRepository(options = {}) {
  const env = options.env ?? process.env;
  const fromEnv = typeof env.GITHUB_REPOSITORY === 'string' ? env.GITHUB_REPOSITORY.trim() : '';
  if (fromEnv) {
    if (!REPOSITORY_PATTERN.test(fromEnv)) {
      throw new Error(`GITHUB_REPOSITORY ("${fromEnv}") is not an owner/repository pair.`);
    }
    return fromEnv;
  }
  const fromOrigin = (options.readOrigin ?? readGitOrigin)(options.cwd);
  const parsed = fromOrigin ? parseGitHubRemote(fromOrigin) : null;
  if (parsed) return parsed;
  throw new Error(
    'Cannot determine the GitHub repository: GITHUB_REPOSITORY is unset and the git origin remote is not a github.com repository. '
      + 'Set GITHUB_REPOSITORY instead of guessing a repository.'
  );
}

/** Parse a git remote URL into `owner/repository`, or null when it is not github.com. */
export function parseGitHubRemote(url) {
  const match = /^(?:(?:https?|ssh):\/\/(?:git@)?|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
    String(url).trim()
  );
  if (!match) return null;
  const repository = `${match[1]}/${match[2]}`;
  return REPOSITORY_PATTERN.test(repository) ? repository : null;
}

function readGitOrigin(cwd) {
  let output;
  try {
    output = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return output;
}
