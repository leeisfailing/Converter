import { readFileSync } from 'node:fs';

/** Linux has an independent signing key; never silently reuse Windows trust. */
export function releasePublicKey(config, linux, linuxOnly) {
  const key = linuxOnly ? linux?.plugins?.updater?.pubkey : config?.plugins?.updater?.pubkey;
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error(`${linuxOnly ? 'Linux' : 'Windows'} updater public key is missing.`);
  }
  return key.trim();
}

export function readReleasePublicKey(config, linuxOnly) {
  const linux = linuxOnly ? JSON.parse(readFileSync(new URL('../src-tauri/tauri.linux.conf.json', import.meta.url))) : undefined;
  return releasePublicKey(config, linux, linuxOnly);
}
