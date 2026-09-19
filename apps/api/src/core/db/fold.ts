/**
 * NFKC case-folding for username uniqueness (ADR-012, Global Constraints: "uniqueness on
 * NFKC-case-folded form"). Shared by Task 3's DB-level uniqueness tests and Task 4's register/
 * login flow so both sides fold exactly one way — `username_folded` in `schema.ts` is always
 * `foldUsername(username)`, never recomputed differently at a call site.
 *
 * NFKC normalizes compatibility variants (full-width `ＡＬＩＣＥ` -> `ALICE`) before
 * lower-casing, so visually-confusable spellings collide the way ADR-012 intends. `toLowerCase`
 * (not `toLocaleLowerCase`) is used deliberately: it's locale-independent, so the fold is
 * identical on every deployment regardless of server locale — the same reasoning that keeps
 * locale-dependent string ops out of the engine (CLAUDE.md rule 4), applied here for the same
 * cross-environment-determinism reason even though this file sits outside packages/engine.
 */
export function foldUsername(username: string): string {
  return username.normalize('NFKC').toLowerCase();
}
