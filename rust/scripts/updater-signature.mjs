import { createHash, createPublicKey, verify } from 'node:crypto';

/** Verify Tauri's base64-encoded minisign packet and authenticated comment. */
export function verifyUpdaterSignature(bytes, signature, publicKey) {
  const publicLines = Buffer.from(publicKey, 'base64').toString('utf8').trim().split(/\r?\n/);
  const keyPacket = Buffer.from(publicLines[1] ?? '', 'base64');
  const lines = Buffer.from(signature.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  const packet = Buffer.from(lines[1] ?? '', 'base64');
  const globalSignature = Buffer.from(lines[3] ?? '', 'base64');
  if (keyPacket.length !== 42 || keyPacket.subarray(0, 2).toString() !== 'Ed'
      || packet.length !== 74 || globalSignature.length !== 64
      || !lines[2]?.startsWith('trusted comment: ')) throw new Error('Invalid Tauri updater signature packet.');
  if (!packet.subarray(2, 10).equals(keyPacket.subarray(2, 10))) throw new Error('Updater signature does not match the embedded public key.');
  const algorithm = packet.subarray(0, 2).toString();
  if (!['Ed', 'ED'].includes(algorithm)) throw new Error('Unsupported updater signature algorithm.');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), keyPacket.subarray(10)]), format: 'der', type: 'spki' });
  const payload = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  const rawSignature = packet.subarray(10);
  if (!verify(null, payload, key, rawSignature)) throw new Error('Updater artifact signature verification failed.');
  const comment = Buffer.from(lines[2].slice('trusted comment: '.length));
  if (!verify(null, Buffer.concat([rawSignature, comment]), key, globalSignature)) throw new Error('Updater trusted comment verification failed.');
}
