#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync, rmSync, readFileSync, mkdtempSync, renameSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resourcePlan, copyResources } from './bundle-resources.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST_ROOT = path.join(ROOT, 'dist');
const DIST = path.join(DIST_ROOT, 'portable');
const executable = path.join(ROOT, 'src-tauri', 'target', 'release', 'converter.exe');
const config = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));

// Validate every input before replacing an existing portable distribution.
if (!existsSync(executable)) throw new Error('Missing release converter.exe. Build the app first.');
const plan = resourcePlan(path.join(ROOT, 'src-tauri'), config);
mkdirSync(DIST_ROOT, { recursive: true });
const staging = mkdtempSync(path.join(DIST_ROOT, 'portable-staging-'));
copyResources(plan, staging);
cpSync(executable, path.join(staging, 'converter.exe'));
if (path.dirname(path.resolve(DIST)) !== DIST_ROOT) throw new Error('Portable output must stay inside dist.');
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
renameSync(staging, DIST);

const zipPath = path.join(DIST_ROOT, 'Converter-portable.zip');
try {
  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync('tar', ['-a', '-cf', zipPath, '-C', DIST, '.'], { stdio: 'inherit' });
  console.log(`Portable build: ${zipPath}`);
} catch {
  console.log(`Portable build directory: ${DIST}`);
  console.log('(zip creation skipped - zip the folder manually)');
}
