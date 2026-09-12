import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const keyPath = path.join(root, 'src-tauri/updater.key');
const passwordPath = `${keyPath}.password`;
if ([keyPath, `${keyPath}.pub`, passwordPath].some(existsSync)) {
  throw new Error('Signing files already exist. Keep the original key; do not rotate keys for routine releases.');
}
const password = randomBytes(32).toString('base64');
// Save the password first so it remains recoverable if the CLI is interrupted.
writeFileSync(passwordPath, password, { flag: 'wx', mode: 0o600 });
const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
  'signer', 'generate', '--ci', '--password', password, '--write-keys', keyPath,
], { cwd: root, encoding: 'utf8', windowsHide: true });
// The signer output is captured because it can contain signing material.
if (result.status !== 0) throw new Error('Tauri key generation failed. Signing files have been preserved; inspect locally before retrying.');
const configPath = path.join(root, 'src-tauri/tauri.conf.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.plugins.updater.pubkey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log('Generated encrypted src-tauri/updater.key and updater.key.password (both ignored by Git).');
console.log('Public key saved to src-tauri/updater.key.pub and embedded in tauri.conf.json.');
