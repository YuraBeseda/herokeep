/**
 * Client-verifier shape checks and peppered hashing (ADR-012 §Passwords). The browser derives a
 * 32-byte PBKDF2 verifier (client plan's job, not this server's) and sends it hex-encoded; this
 * server never derives or stores a password, only a peppered hash of that verifier.
 */
import { sha256Hex } from '../crypto.ts';
import type { Config } from '../../ports/index.ts';

const VERIFIER_HEX_PATTERN = /^[0-9a-f]{64}$/i; // 32 bytes, hex-encoded
const SALT_HEX_PATTERN = /^[0-9a-f]{32}$/i; // 16 bytes, hex-encoded

/** `true` iff `verifier` is a 64-hex-char (32-byte) string — the wire shape ADR-012 specifies for
 * the client-derived PBKDF2 verifier. Does not (cannot) validate the underlying password. */
export function isValidVerifierShape(verifier: string): boolean {
  return VERIFIER_HEX_PATTERN.test(verifier);
}

/** `true` iff `salt` is a 32-hex-char (16-byte) string — the wire/storage shape for both a real
 * per-user salt and the unknown-user HMAC fake salt (`./salt.ts`), so the two are indistinguishable. */
export function isValidSalt(salt: string): boolean {
  return SALT_HEX_PATTERN.test(salt);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * `SHA-256(pepper ‖ verifier)` (ADR-012, verbatim): raw-byte concatenation of the UTF-8-encoded
 * pepper secret and the client's verifier (decoded from its hex wire encoding), hashed once. The
 * server does no expensive/iterated hashing here — the verifier already carries PBKDF2's cost
 * from the browser; this step only adds a server-side secret so a stolen DB alone (without the
 * pepper) can't be checked offline against guessed verifiers.
 *
 * `SESSION_PEPPER` is the Config port's (Task 2) name for this secret — the name is a Task-2
 * naming choice, not a hint that it peppers *session* tokens; session tokens are stored as plain
 * `sha256(token)` with no pepper (ADR-012 §Sessions). It's the only pepper-shaped secret ADR-012
 * defines, so this is the intended reading; documented here since Task 4 is the first consumer.
 */
export async function hashVerifier(config: Config, verifierHex: string): Promise<string> {
  const pepper = new TextEncoder().encode(config.get('SESSION_PEPPER'));
  const verifierBytes = hexToBytes(verifierHex);
  const combined = new Uint8Array(pepper.length + verifierBytes.length);
  combined.set(pepper, 0);
  combined.set(verifierBytes, pepper.length);
  return sha256Hex(combined);
}
