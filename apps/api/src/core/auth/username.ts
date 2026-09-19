/**
 * Username format validation (ADR-012 / Global Constraints: "3–32 chars, Unicode
 * letters/digits/`_`/`-`"). Folding for uniqueness is a separate, already-shared concern
 * (`../db/fold.ts`'s `foldUsername`, consumed by both Task 3's DB layer and Task 4's register/
 * login/reset flows below) — this file only re-exports it alongside the sibling format check so
 * callers have one import for "is this string usable as a username at all".
 */
export { foldUsername } from '../db/fold.ts';

// `u` flag: `{3,32}` counts Unicode code points, not UTF-16 code units, so astral characters
// (rare in usernames, but possible) count as one "character" each, matching user expectation.
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{3,32}$/u;

/** `true` iff `username` is 3–32 Unicode letters/digits/`_`/`-` — format only; uniqueness is
 * enforced separately on `foldUsername(username)` (the DB's unique index, re-checked at
 * register time). */
export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}
