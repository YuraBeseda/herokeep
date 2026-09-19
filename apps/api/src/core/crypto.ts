/**
 * Password/session/recovery-code crypto primitives (ADR-012 §Auth exact values). WebCrypto
 * (`crypto.subtle`/`getRandomValues`) only — no `node:crypto` — so this file runs unchanged on
 * both the Node adapter (>= 20) and Cloudflare Workers, and stays inside the `src/core/**`
 * boundary rule (no `node:*`/`cloudflare:*` imports). Referenced as the bare global `crypto`, not
 * `globalThis.crypto` — see `core/ids.ts`'s doc comment for why the dotted form fails to compile
 * under `src/adapters/cloudflare/tsconfig.json`'s separate program even though both forms resolve
 * identically at runtime.
 */

function toBytes(input: Uint8Array | string): Uint8Array {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of `bytes` (or the UTF-8 encoding of a string), as lowercase hex. */
export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toBytes(bytes));
  return toHex(digest);
}

/** HMAC-SHA256(key, msg) as lowercase hex — used for the unknown-username "fake salt" (ADR-012). */
export async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', toBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, toBytes(msg));
  return toHex(signature);
}

/**
 * Constant-time string equality: always compares every byte of the longer input (padding the
 * shorter with zero bytes) so elapsed time doesn't leak *how much* of the two strings matched,
 * and a length mismatch alone still forces the full comparison rather than a fast-exit before
 * the loop. Used to compare verifier/session/recovery-code hashes.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = toBytes(a);
  const bufB = toBytes(b);
  const len = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}

/** `bytes` cryptographically-random bytes, as lowercase hex (session tokens, recovery codes). */
export function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
