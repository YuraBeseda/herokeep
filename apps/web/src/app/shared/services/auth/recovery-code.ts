/** Mirrors `apps/api/src/core/auth/recovery-codes.ts`'s `normalizeRecoveryCode` EXACTLY (that
 * file's own doc comment: "the hash used for lookup/burn is always computed on this normalized
 * form, never on the display (hyphenated) form"). Duplicated rather than imported — `apps/web`
 * has no build-time dependency on `apps/api`'s source — the same cross-package convention
 * `auth.service.ts`'s `USERNAME_PATTERN` comment already documents for the username pattern.
 *
 * Used by the recover screen (task-5-brief.md) so the exact string POSTed as `recoveryCode` is
 * already in the shape the server hashes (`sha256Hex(normalizeRecoveryCode(recoveryCode))` in
 * `apps/api/src/core/auth/recovery.ts`) — tolerating the displayed `XXXXX-XXXXX` grouping, stray
 * whitespace, and lowercase input. The server re-normalizes on its side too (defence in depth,
 * not a correctness requirement either way), so this is a UX nicety more than a hard dependency.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, '');
}
