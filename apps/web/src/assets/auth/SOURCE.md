# Top-10k common-password list — source

- **List:** `top-10k-passwords.txt` — used by `password-check.ts` (T3) to reject the most
  common passwords at registration/reset (ADR-012 §Passwords: "reject the top-10k common
  password list (bundled, checked client-side)").
- **Upstream file:** `Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt`
  in https://github.com/danielmiessler/SecLists (`master` branch at retrieval time).
  Retrieved via `https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt`.
- **Retrieved:** 2026-09-19.
- **License:** MIT License, copyright (c) 2018 Daniel Miessler — the SecLists repository's
  own `LICENSE` file (https://github.com/danielmiessler/SecLists/blob/master/LICENSE),
  which covers the repository's contents including this vendored list; the
  `Common-Credentials/README.md` in that repo notes no separate/stricter license for this
  particular file. Upstream data traces to Mark Burnett's publicly released "10 million
  passwords" research dataset (2015), which SecLists re-published under its own MIT terms.
  No attribution notice is required by MIT beyond retaining this notice (unlike the
  project's CC-BY-4.0 SRD content — see `docs/04-reference/legal-attribution.md` — this
  list is not shown to end users, only checked against silently, so no About-screen entry
  was added; this file is the license record, per that doc's per-asset convention).
- **Original file shape:** exactly 10,000 lines, newline-separated, already ordered most-
  to-least common, mixed case, no header/comments, no blank lines.

## Normalization applied (executor, 2026-09-19)

1. Trim each line; drop empty lines (none were present).
2. Lowercase every entry (`ToLowerInvariant`) to match `password-check.ts`'s case-folded
   membership check.
3. Deduplicate in original (most-common-first) order, keeping the first occurrence of each
   lowercased form (a PowerShell `HashSet<string>` in iteration order — equivalent to
   `Array.from(new Set(...))` semantics).
4. Keep at most the first 10,000 (source was already capped there, so no truncation was
   needed in practice).

Result: **9,916 unique lowercased passwords** (84 entries collapsed because the source had
both-case duplicates, e.g. `Password`/`password`). The count is intentionally not padded
back to 10,000 from a larger SecLists list — "top 10k" describes the source ranking window,
not a promised output line count, and the brief's own instruction ("keep first 10k") is
satisfied by never taking more than the top-10,000-ranked entries.
