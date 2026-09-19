/**
 * Recovery-code generation, display grouping, and normalization (ADR-012: "six one-time
 * recovery codes, 10 chars, base32, grouped"). ADR-012 names the alphabet/length but not the
 * grouping — Task 4's decision: split into two groups of five, hyphen-joined (`XXXXX-XXXXX`),
 * the conventional license-key-style grouping, easiest to read aloud or transcribe in two
 * chunks. Documented here since it's the one place that decision is encoded.
 */

// RFC 4648 base32 alphabet, no padding. Kept as the standard alphabet (not Crockford's) since
// ADR-012 just says "base32" and this is the least surprising reading.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_LENGTH = 10;

/** One securely-random base32 character via rejection sampling: 224 (= 32 × 7) is the largest
 * multiple of 32 that fits a byte, so re-rolling any byte ≥ 224 keeps `byte % 32` exactly
 * uniform over the 32-symbol alphabet — a plain `byte % 32` without rejection would very
 * slightly bias the low symbols. */
function randomBase32Char(): string {
  const buf = new Uint8Array(1);
  let value: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= 224);
  return BASE32_ALPHABET[value % 32] ?? 'A';
}

/** A single ungrouped 10-character base32 recovery code — the form that gets hashed and matched
 * against on reset. Display grouping (`formatRecoveryCode`) is applied only for the one-time
 * response shown to the user. */
export function randomRecoveryCode(): string {
  return Array.from({ length: CODE_LENGTH }, randomBase32Char).join('');
}

/** `"ABCDE12345"` -> `"ABCDE-12345"` — the one-time display form. Purely cosmetic. */
export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5, 10)}`;
}

/** Reverses `formatRecoveryCode` and tolerates a pasted code's incidental whitespace/lowercase:
 * strips everything outside the base32 alphabet and uppercases. The hash used for lookup/burn is
 * always computed on this normalized form, never on the display (hyphenated) form. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, '');
}
