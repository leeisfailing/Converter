import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Keep portable resources in sync with the installer manifest.
export function resourcePlan(tauriRoot, config) {
  const files = [];
  for (const [pattern, target] of Object.entries(config.bundle.resources)) {
    const source = path.resolve(tauriRoot, pattern);
    if (path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) {
      throw new Error(`Resource target must stay inside the bundle: ${target}`);
    }
    if (pattern.includes('*')) {
      const name = path.basename(pattern);
      const matcher = new RegExp(`^${name.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      const directory = path.dirname(source);
      const matches = existsSync(directory) ? readdirSync(directory).filter(file =>
        matcher.test(file) && statSync(path.join(directory, file)).isFile()) : [];
      if (!matches.length) throw new Error(`Resource pattern matched no files: ${pattern}`);
      for (const file of matches) files.push({ source: path.join(directory, file), target: path.join(target, file) });
    } else {
      if (!existsSync(source)) throw new Error(`Missing bundle resource: ${pattern}`);
      files.push({ source, target });
    }
  }
  for (const binary of config.bundle.externalBin) {
    const source = path.resolve(tauriRoot, `${binary}-x86_64-pc-windows-msvc.exe`);
    if (!existsSync(source)) throw new Error(`Missing Windows sidecar: ${binary}`);
    files.push({ source, target: `${path.basename(binary)}.exe` });
  }
  return files;
}

export function copyResources(plan, destination) {
  for (const file of plan) {
    const target = path.join(destination, file.target);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(file.source, target, {
      recursive: true,
      filter: source => path.basename(source) !== '__pycache__' && !source.endsWith('.pyc'),
    });
  }
}
