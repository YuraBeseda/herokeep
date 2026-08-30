# ADR-012 — Identity and security baseline

**Status:** Approved 2026-08-30. Depends on ADR-001, ADR-006. Details in
`02-architecture/08-security-permissions-quotas.md`.

## Context

Streams have owners and campaigns have members, so accounts are needed (owner: "minimal
registration, login and reset tokens"). There is no budget for an email service and no
sending domain, so nothing can be emailed. The owner asked for "minimal security, not to
leak passwords or personal data" and asked to be told what is needed. Cloudflare Workers
on the free plan allow ~10 ms of CPU per invocation, which rules out server-side bcrypt/
Argon2.

## Options considered

| Option | Assessment |
|--------|-----------|
| No accounts (device keys + codes) | Cannot express ownership/membership across devices; recovery needs the DM. Rejected once server storage was allowed. |
| Email + password + emailed reset | Needs a mailer and a domain (the only paid item anywhere). Rejected for v1 by owner. |
| Magic links only | Same mailer dependency. Rejected. |
| Passkeys (WebAuthn) | Excellent UX and security, but "lost all devices" still needs a recovery path, and library support on Workers must be validated. Deferred to Phase 7 as an *addition*. |
| **Username + password + recovery codes (chosen)** | Fully free, no personal data collected, recovery works offline from email. |

## Decision

### Data minimization

- Accounts have a **username** (3–32 chars, Unicode letters/digits/`_`/`-`, case-folded
  for uniqueness with NFKC), a password verifier, recovery-code hashes, and timestamps.
  **No email, no name, no phone.** Display name per campaign is free text chosen by the
  user. This is the simplest way to "not leak personal data": there is none.
- Characters and campaigns are game data. Notes may contain anything a user types; they
  are private to the character owner and DM by permission (below).

### Passwords

- Minimum 10 characters, maximum 128, no composition rules; reject the top-10k common
  password list (bundled, checked client-side) and the username inside the password.
- **Key derivation in the browser:** PBKDF2-HMAC-SHA-256 via WebCrypto, 600,000
  iterations (OWASP 2023 guidance), 16-byte per-user salt. The browser sends the 32-byte
  derived *verifier*; the server stores `SHA-256(pepper ‖ verifier)` and compares in
  constant time. The server does no expensive hashing (fits the CPU budget); a database
  leak exposes only peppered hashes of high-entropy verifiers.
- Salt retrieval before login returns `HMAC(SALT_HMAC_KEY, username)` for unknown users so
  account existence is not revealed; real salts are random and stored.
- Rate limits: per username — 5 failures then exponential lockout (1 min → 1 h); per IP —
  30 auth requests/min; both via `RateLimiterDO`.

### Sessions

- Random 256-bit token; server stores `SHA-256(token)` with `userId`, `deviceLabel`,
  `createdAt`, `lastSeenAt`, `expiresAt` (180 days sliding). Sent as an `HttpOnly; Secure;
  SameSite=Lax; Path=/` cookie — possible because app and API share one origin (ADR-006).
  WebSocket upgrades carry the cookie automatically; the Worker also checks the `Origin`
  header on upgrade and the API rejects state-changing requests without a custom
  `X-Requested-With` header (CSRF defense in depth).
- "Sign out everywhere" deletes all sessions; devices are listed in Settings.

### Recovery (the "reset tokens")

- At registration the user receives **six one-time recovery codes** (10 chars, base32,
  grouped) and must confirm having saved them (download/share/copy). Stored as SHA-256
  hashes. Reset = username + one code → set a new password (new salt, new verifier), which
  also invalidates all sessions and burns the code.
- Codes can be regenerated from Settings while logged in.
- Later additions that do not change this design: emailed reset (if a domain is bought),
  passkeys, "DM vouch" (a campaign DM confirms identity to unlock a reset).

### Authorization model

Enforced in the Durable Objects on every append (the server never trusts the client's
`actor` field; it stamps it from the session):

| Actor | Character stream | Campaign stream |
|-------|------------------|-----------------|
| Owner | all `char.*`, `decision.*`, in-play events, `portrait.*`, `note.*`, `pack.pinned`, `event.reverted` (only events the owner authored) | `campaign.character_joined/left` for own characters; `roll.logged`; `chat.message` |
| DM of the character's campaign | `dm.*` (damage, heal, condition, xp, item grant/remove, level.granted), `override.applied`, `event.reverted` (any), `character.owner_transferred` (claim flows) | everything |
| Member (not owner) | read only if campaign visibility allows; never append | `roll.logged`, `chat.message` |
| Anyone else | nothing | nothing (join by code creates membership first) |

Reads: a character stream is readable by its owner and by the DM and members of its
current campaign according to `visibility.partySheets` (`none | overview | full`); the
*overview* projection (HP, AC, conditions, level, portrait hash) is computed client-side
by the DM's device and posted as `party.overview_updated` on the campaign stream so other
members never need read access to the raw stream.

### Transport and content security

- HTTPS only (Cloudflare); HSTS; `Content-Security-Policy` with no inline scripts, no
  third-party origins (fonts self-hosted), `img-src 'self' blob: data:`; `frame-ancestors
  'none'`.
- All inputs validated with the shared Zod schemas (events, messages, packs, bundles);
  size limits on every message and field; markdown sanitized (ADR-008).
- Quotas (ADR-006 budget): per user 50 characters, 10 MB of events; per campaign 12
  members, 20 MB of events, 6 non-core packs; per event 16 KB; per message 128 KB.
- Logging: no request bodies, no usernames in logs; only counters and error classes.

### Threats explicitly accepted

- A malicious *owner* can corrupt their own character (they could anyway).
- A malicious *DM* can do anything inside their campaign (they are the trust root there).
- Cloudflare can read game data at rest (no E2E encryption by owner decision; revisit
  with passkeys/PRF-derived keys if ever wanted).

## Consequences

- Registration is one screen; login is one screen; recovery is one screen. No email
  flows exist anywhere in the codebase.
- Phase 1 has no accounts at all (solo, device-local); Phase 2 adds this ADR; local data
  is uploaded to the new account on first login.

## Open points

- Cloudflare's documented PBKDF2 iteration cap on the free plan does not matter here
  because derivation happens in the browser, but if a server-side fallback is ever
  needed it must be verified.
