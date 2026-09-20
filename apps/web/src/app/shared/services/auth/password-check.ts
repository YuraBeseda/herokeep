/** Client-side password rules (ADR-012 §Passwords, `docs/01-decisions/`): "Minimum 10
 * characters, maximum 128, no composition rules; reject the top-10k common password list
 * (bundled, checked client-side) and the username inside the password."
 *
 * Used by the register (T5) and recover (T5) screens before ever deriving a verifier
 * (`auth-crypto.ts`'s `deriveVerifierHex`) — the raw password is checked here and then
 * discarded, never sent anywhere for this check.
 *
 * Check order (first failing reason wins — callers show ONE message, not a list):
 *   1. length (too-short / too-long)
 *   2. username-containment
 *   3. common-password-list membership
 * Length is checked first because it's free and instant; username-containment next because
 * it needs no network; the common-list check is last because it's the one that can be
 * network-degraded (see below) and is the most expensive (a Set lookup after a lazy fetch).
 */

export type PasswordVerdict =
  { ok: true } | { ok: false; reason: 'too-short' | 'too-long' | 'common' | 'contains-username' };

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

/** ADR-012 says "the username inside the password" without a minimum length. A 1-2 char
 * username would false-positive on huge numbers of unrelated passwords (e.g. username "a"
 * matches almost anything), so this check only runs when the case-folded username is at
 * least 3 characters — short usernames skip the containment check entirely. */
const MIN_USERNAME_CHECK_LENGTH = 3;

const COMMON_LIST_URL = '/assets/auth/top-10k-passwords.txt';

/** Memoized fetch-and-parse of the bundled top-10k list (`src/assets/auth/`,
 * see `SOURCE.md` there for provenance/license). Lazy: nothing imports the list statically
 * and nothing fetches it until the first `checkPassword` call, so it never enters the
 * initial bundle (`ngsw-config.json`'s `assets-lazy` group already lazy-caches `/assets/**`
 * for the same reason).
 *
 * Memoized ONCE per module instance regardless of outcome — a rejected fetch or a non-2xx
 * response resolves this promise to an EMPTY set (degrade-open, see `checkCommonList`
 * below) rather than being retried on the next call; that matches "fetched once" and keeps
 * a flaky/offline network from hammering the endpoint on every keystroke. */
let commonListPromise: Promise<ReadonlySet<string>> | null = null;

function loadCommonList(): Promise<ReadonlySet<string>> {
  commonListPromise ??= fetch(COMMON_LIST_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`);
      }
      return response.text();
    })
    .then(
      (text) =>
        new Set(
          text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        ),
    )
    .catch(() => new Set<string>());
  return commonListPromise;
}

/** Checks `password` against ADR-012's rules. DEGRADES OPEN on the common-list check: if the
 * asset fetch fails (offline, 404, parse error) the common-list check is silently skipped —
 * no `console.*` noise, no thrown error — so a network hiccup never blocks the length/
 * username-containment checks or bricks the register/recover form. Registering still needs
 * the network for the actual `POST`, so this degrade only matters for the in-form live
 * feedback, not for a security guarantee (the server does not re-check this list). */
export async function checkPassword(password: string, username: string): Promise<PasswordVerdict> {
  if (password.length < MIN_LENGTH) {
    return { ok: false, reason: 'too-short' };
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }

  // Case-fold BOTH sides before comparing (the "both directions" in this file's spec
  // comments/brief: not a reverse containment check, just folding password and username
  // independently so e.g. username "Alex" still matches password "MyAlexPass1").
  const foldedUsername = username.toLowerCase();
  if (foldedUsername.length >= MIN_USERNAME_CHECK_LENGTH) {
    const foldedPassword = password.toLowerCase();
    if (foldedPassword.includes(foldedUsername)) {
      return { ok: false, reason: 'contains-username' };
    }
  }

  const commonList = await loadCommonList();
  if (commonList.has(password.toLowerCase())) {
    return { ok: false, reason: 'common' };
  }

  return { ok: true };
}
