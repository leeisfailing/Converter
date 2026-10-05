#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync, rmSync, readFileSync, writeFileSync, mkdtempSync, renameSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resourcePlan, copyResources } from './bundle-resources.mjs';

export function buildPortable(root, archive = execFileSync) {
  const distRoot = path.resolve(root, 'dist');
  const dist = path.join(distRoot, 'portable');
  const zipPath = path.join(distRoot, 'Converter-portable.zip');
  const temporaryZip = path.join(distRoot, 'Converter-portable-staging.zip');
  // A failed build must not leave an old ZIP looking ready for release.
  for (const file of [zipPath, temporaryZip]) {
    if (existsSync(file)) rmSync(file);
  }
  const executable = path.join(root, 'src-tauri', 'target', 'release', 'converter.exe');
  const config = JSON.parse(readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  // Validate every input before replacing an existing portable directory.
  if (!existsSync(executable)) throw new Error('Missing release converter.exe. Build the app first.');
  const plan = resourcePlan(path.join(root, 'src-tauri'), config);
  mkdirSync(distRoot, { recursive: true });
  const staging = mkdtempSync(path.join(distRoot, 'portable-staging-'));
  try {
    copyResources(plan, staging);
    cpSync(executable, path.join(staging, 'converter.exe'));
    writeFileSync(path.join(staging, 'converter-portable.json'), JSON.stringify({ version: config.version, distribution: 'portable' }, null, 2) + '\n');
    if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
    renameSync(staging, dist);
    archive('tar', ['-a', '-cf', temporaryZip, '-C', dist, '.'], { stdio: 'inherit' });
    // Windows bsdtar supports ZIP; GNU tar may silently produce a tar file.
    if (!existsSync(temporaryZip) || statSync(temporaryZip).size < 22) {
      throw new Error('Portable archive is missing or empty.');
    }
    const header = Buffer.alloc(4);
    const descriptor = openSync(temporaryZip, 'r');
    try {
      readSync(descriptor, header, 0, header.length, 0);
    } finally {
      closeSync(descriptor);
    }
    if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new Error('Portable archive is not a ZIP. Use the Windows tar executable with ZIP support.');
    }
    renameSync(temporaryZip, zipPath);
    console.log(`Portable build: ${zipPath}`);
    return zipPath;
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (existsSync(temporaryZip)) rmSync(temporaryZip);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPortable(path.resolve(import.meta.dirname, '..'));
}
