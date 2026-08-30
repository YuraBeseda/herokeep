# Security, permissions and quotas

Decision record: ADR-012. This document is the how, plus the free-plan budget.

## Authentication flows

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Worker (Hono)
  participant D as D1
  Note over B,W: Register
  B->>W: POST /api/auth/register {username}
  W->>D: insert user (salt = random 16B)
  W-->>B: {salt}
  B->>B: verifier = PBKDF2-SHA256(password, salt, 600000)
  B->>W: POST /api/auth/register/complete {username, verifier}
  W->>D: store SHA-256(pepper ‖ verifier); generate 6 recovery codes; store hashes
  W-->>B: Set-Cookie session; {recoveryCodes}  (shown once)
  Note over B,W: Login
  B->>W: GET /api/auth/salt?username=…
  W-->>B: {salt}  (real or HMAC(SALT_HMAC_KEY, username) if unknown)
  B->>B: verifier = PBKDF2(…)
  B->>W: POST /api/auth/login {username, verifier}
  W->>D: constant-time compare; rate-limit check
  W-->>B: Set-Cookie session
```

Recovery: `POST /api/auth/recover {username, code}` → if a code hash matches and is
unused → returns a one-time `resetToken` (10 min) → `POST /api/auth/reset {resetToken,
verifier, newSalt}` → all sessions revoked, code burned.

Cookie: `hk_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=15552000`.
State-changing requests require header `X-Requested-With: herokeep`; WebSocket
upgrades require `Origin` to equal the app origin.

## Rate limits (`RateLimiterDO`, keyed by scope)

| Scope | Limit |
|-------|-------|
| `ip:<ip>:auth` | 30 requests / minute |
| `user:<name>:login-fail` | 5 failures → lockout 1 min, doubling to 1 h; reset on success |
| `ip:<ip>:register` | 5 / hour |
| `user:<id>:ws-connect` | 60 / minute |
| `user:<id>:append` | 600 events / minute (burst 100) |
| `code:<joinCode>:attempt` | 20 / hour (join-code guessing) |

Implemented as a sliding window in the DO's memory with periodic persistence; free-plan
requests to the DO are counted, so the Worker checks a local in-memory cache first for
hot paths.

## Authorization matrix (enforced in DOs; the Worker only routes)

| Action | Owner | DM (of the character's campaign) | Member | Other |
|--------|-------|----------------------------------|--------|-------|
| Read character stream | ✔ | ✔ | per `visibility.partySheets` (`full` only) | ✖ |
| Append owner events (`decision.*`, in-play, `note.*`, `portrait.*`, `pack.pinned`) | ✔ | only if `houseRules.allowOverrides` (as `override.applied`) | ✖ | ✖ |
| Append DM events (`dm.*`: `hp.changed`, `condition.*`, `xp.awarded`, `item.added/removed`, `level.granted`, `currency.changed`, `inspiration.changed`) | ✔ (solo/self) | ✔ | ✖ | ✖ |
| `override.applied` | ✔ (solo) | ✔ | ✖ | ✖ |
| `event.reverted` | own events | any | ✖ | ✖ |
| `character.owner_transferred` | ✔ | ✔ (pregens) | ✖ | ✖ |
| Read campaign stream | — | ✔ | ✔ (DM notes filtered out) | ✖ |
| Append campaign settings/packs/session/member removal | — | ✔ | ✖ | ✖ |
| `roll.logged`, `chat.message`, `member.renamed`, own `campaign.character_joined/left` | — | ✔ | ✔ | ✖ |
| Join by code | — | — | — | creates membership if `join.open` |

`dm.*` is a permission class, not a type prefix: the protocol schema marks each event
type with `actors: ['owner' | 'dm' | 'member']`, and the DO consults that table.

Filtering on read: the CampaignStream never sends `dm.note_*` events to non-DM sockets;
`roll.logged` with `visibility: dm` goes to the DM and the roller only; `private` to the
roller only (still stored — the DM can audit if the campaign setting says so).

## Quotas

| Scope | Limit | Enforced by |
|-------|-------|-------------|
| Event payload | 16 KB | DO (reject `invalid`) |
| WS message | 128 KB (text), 64 KB + header (binary) | DO |
| Character stream | 2 MB events, 20,000 events | CharacterStream `meta.bytes_used` |
| User total | 10 MB across characters; 50 characters | D1 `users.quota_bytes_used`, checked on create and reported at 80 % |
| Campaign stream | 20 MB events; 12 members; 6 non-core packs × 5 MB | CampaignStream |
| Pack JSON | 5 MB; 5,000 entities | import + DO |
| Images | never server-side; device caps per ADR-010 | client |

Freeing space: archive → hard delete (`DELETE /api/characters/:id` with the name typed)
deletes the DO's storage and D1 row; export is offered first.

## Free-plan budget (Cloudflare, verified limits 2026-08-29)

| Resource | Free limit | Expected daily use (10 sessions/day peak) |
|----------|-----------|--------------------------------------------|
| Worker requests | 100,000/day | ~5,000 HTTP + ~1,500 (WS messages at 20:1) |
| DO requests | 100,000/day | ~3,000 (RPC + WS) |
| DO duration | 13,000 GB-s/day | < 1,000 GB-s (hibernation) |
| DO storage | 5 GB | < 1 GB after a year |
| D1 reads/writes | 5M / 100k per day | < 20k / < 2k |
| Static asset requests | unlimited | — |

Alerts: a daily Cron Trigger (`0 3 * * *`) writes usage counters to D1 and posts a
`notice` to the owner's account at 60 % of any limit.

## Content and transport hardening

- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' (Angular
  component styles); img-src 'self' blob: data:; connect-src 'self' wss:; font-src
  'self'; frame-ancestors 'none'; base-uri 'none'`.
- Headers: HSTS (preload after the domain exists), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera/mic/geolocation.
- All JSON validated by shared Zod schemas; all markdown sanitized; no SVG uploads.
- Dependencies: `pnpm audit` in CI; lockfile committed; Renovate/Dependabot weekly.
- Secrets: only in Cloudflare secrets and GitHub Actions secrets; none in the repo.

## Privacy statement (for the About screen)

Stored server-side: username, password verifier hash, recovery-code hashes, session
records, your characters' and campaigns' event streams (game data and notes you typed).
Not stored: email, name, images, IP addresses beyond short-lived rate-limit counters, any
analytics. Data can be exported and deleted by you at any time.
