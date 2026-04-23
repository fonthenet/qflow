import 'server-only';

/**
 * App-level AES-256-GCM encrypt/decrypt helpers.
 *
 * Key source: ENCRYPTION_SECRET env var (32 raw bytes, hex-encoded = 64 hex chars).
 * Stored format: base64(iv) + '.' + base64(ciphertext+authTag)
 *   - IV: 12 bytes (96-bit, recommended for GCM)
 *   - Auth tag: 16 bytes (appended by Node crypto to ciphertext)
 */

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_SECRET?.trim();
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_SECRET must be a 64-char hex string (32 bytes). ' +
      'Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

export async function encrypt(plaintext: string): Promise<string> {
  const { createCipheriv, randomBytes } = await import('crypto');
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([enc, tag]);
  return `${iv.toString('base64')}.${payload.toString('base64')}`;
}

export async function decrypt(stored: string): Promise<string> {
  const { createDecipheriv } = await import('crypto');
  const key = getKey();
  const dot = stored.indexOf('.');
  if (dot === -1) throw new Error('Invalid encrypted value format');
  const iv = Buffer.from(stored.slice(0, dot), 'base64');
  const payload = Buffer.from(stored.slice(dot + 1), 'base64');
  const ciphertext = payload.slice(0, payload.length - TAG_BYTES);
  const tag = payload.slice(payload.length - TAG_BYTES);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf-8');
}
