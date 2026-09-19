/** Client-side password key derivation (ADR-012 §Passwords, `docs/01-decisions/`): "Key
 * derivation in the browser: PBKDF2-HMAC-SHA-256 via WebCrypto, 600,000 iterations ... 16-byte
 * per-user salt. The browser sends the 32-byte derived verifier" — the raw password NEVER leaves
 * the browser and is never persisted.
 *
 * This is the REAL client implementation `apps/api/scripts/seed-api.ts`'s own `deriveVerifierHex`
 * stands in for until this task shipped (see that file's header comment). The two are independent
 * implementations of the same ADR-012 algorithm, not a shared import (the server seed script is
 * intentionally self-contained) — the cross-pinned test vector in `auth-crypto.spec.ts` /
 * `apps/api/test/adapters/node/seed.test.ts` is what proves they agree byte-for-byte; keep both
 * updated together if ADR-012's constants ever change.
 *
 * WebCrypto only (`crypto.subtle`) — no third-party PBKDF2/crypto library, per the plan's Tech
 * Stack constraint ("Native WebSocket + WebCrypto, no new runtime deps").
 */

const PBKDF2_ITERATIONS = 600_000;
const VERIFIER_BYTE_LENGTH = 32; // 256 bits.
const SALT_BYTE_LENGTH = 16; // 128 bits — the server's `GET /api/auth/salt` hex length (32 chars).

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Derives the 32-byte PBKDF2-HMAC-SHA-256 password verifier ADR-012 specifies, hex-encoded.
 * `saltHex` is the 32-hex-char (16-byte) salt string the server's `GET /api/auth/salt` endpoint
 * returns (register instead generates one locally via `randomSaltHex`). `password` is encoded as
 * UTF-8 with NO normalization (NFC or otherwise) — matching `apps/api/scripts/seed-api.ts`'s
 * `deriveVerifierHex`, which does no normalization either; ADR-012 does not require password
 * normalization. */
export async function deriveVerifierHex(password: string, saltHex: string): Promise<string> {
  const saltBytes = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    // `Uint8Array`'s DOM lib type is generic over `ArrayBufferLike` (which admits
    // `SharedArrayBuffer`), while `Pbkdf2Params.salt` requires a plain-`ArrayBuffer`-backed
    // `BufferSource` — `hexToBytes` always allocates a fresh plain `ArrayBuffer`, never a shared
    // one, so this cast is safe (matches `apps/web/src/app/shared/pipes/blob-url.pipe.ts`'s same
    // pattern for the same TS lib quirk).
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    VERIFIER_BYTE_LENGTH * 8,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** A fresh random 16-byte per-user salt, lowercase hex (32 chars) — used by the register flow
 * (ADR-012: "register generates a random 16-byte salt (hex)"). */
export function randomSaltHex(): string {
  const bytes = new Uint8Array(SALT_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
