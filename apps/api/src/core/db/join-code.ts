/**
 * Campaign join-code generation (doc-02 §Identifiers: "Join code | 8 chars, Crockford base32, no
 * vowels (avoids words) | `7QX4-M2HN`"). The format IS specified there — task-3-brief.md's
 * "if unspecified, implement `generateJoinCode()`..." fallback does not apply; this follows the
 * doc-02 row exactly instead of inventing a shape. ADR-004 (join semantics) adds no further
 * format detail beyond "a join code, link and QR" — doc-02's Identifiers table is the sole source
 * for the shape, cited here as the decision record this task's brief asked for.
 *
 * Alphabet: Crockford's base32 alphabet (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`) already excludes I,
 * L, O, U (visually ambiguous with 1, 1, 0, V). doc-02's "no vowels" strips the two Crockford
 * still has — A and E — leaving 30 symbols: 10 digits + 20 letters (`BCDFGHJKMNPQRSTVWXYZ`).
 * That matches the doc's own example `7QX4-M2HN`: every character is a digit or one of those
 * consonant-ish letters, none of A/E/I/O/U.
 *
 * Length: 8 characters, stored RAW with no separator — `campaigns.join_code`'s uniqueness key.
 * The `XXXX-XXXX` grouped display in the doc-02 example is a client rendering concern (the same
 * kind of split `core/auth/recovery-codes.ts`'s `formatRecoveryCode` applies for recovery codes),
 * not this function's job or the stored value's shape.
 *
 * `crypto.getRandomValues` rejection sampling (same technique as
 * `core/auth/recovery-codes.ts`'s `randomBase32Char`): 240 (= 30 × 8) is the largest multiple of
 * 30 that fits a byte, so re-rolling any byte ≥ 240 keeps `byte % 30` exactly uniform over the
 * 30-symbol alphabet — a plain `byte % 30` without rejection would slightly bias the low symbols.
 *
 * Collision handling: this function alone does not guarantee global uniqueness — the
 * campaign-create route (Task 4) retries on a `join_code` UNIQUE constraint violation from
 * `createCampaign`. At 30^8 (~6.6 × 10^11) possible codes the birthday-bound collision odds are
 * negligible for the campaign counts this app will ever see; the DB constraint, not this
 * function, is the actual correctness guarantee (see `test/core/db.test.ts`'s join-code-alphabet
 * describe block for the uniqueness-enforcement test and the sanity check on those odds).
 */

const JOIN_CODE_ALPHABET = '0123456789BCDFGHJKMNPQRSTVWXYZ';
const JOIN_CODE_LENGTH = 8;

function randomJoinCodeChar(): string {
  const buf = new Uint8Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= 240);
  return JOIN_CODE_ALPHABET[value % JOIN_CODE_ALPHABET.length] ?? '0';
}

/** One cryptographically-random 8-character campaign join code (doc-02 §Identifiers). Raw,
 * ungrouped — see this file's header comment for the format decision and the collision-handling
 * contract (callers retry on a UNIQUE-constraint rejection from `createCampaign`/
 * `rotateJoinCode`). */
export function generateJoinCode(): string {
  return Array.from({ length: JOIN_CODE_LENGTH }, randomJoinCodeChar).join('');
}
