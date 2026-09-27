# Herokeep

5E-compatible character builder and in-play companion. Local-first PWA; rules are data.

- Planning and architecture: [`docs/README.md`](docs/README.md)
- Requirements: Node 24, pnpm 11 (`corepack enable`)
- Commands: `pnpm install` · `pnpm check` (format + lint + typecheck + test) · `pnpm build`

Licenses: code MIT (`LICENSE`), project content packs CC-BY-4.0 (`LICENSE-CONTENT`).

## Pack tools

`pnpm build && node packages/pack-tools/dist/cli.js <command>` — `validate`, `build`, `diff`, `i18n extract` (see `docs/02-architecture/04-content-packs.md`).

Content: `pnpm --filter @hk/content build:pack` generates the SRD 5.2.1 core pack from the vendored open5e snapshot (see `packages/content/upstream/open5e-srd-2024/SOURCE.md`).

## Apps

`apps/web` is the Library and character builder — an installable, offline-first PWA (Angular 22, zoneless) that browses and searches the SRD 5.2.1 pack, renders entity detail as sanitized markdown, switches UI language (en/ru/uk) without a reload, imports the RU sample translation pack from Settings, and builds, plays, and exports/imports 5E characters — with portraits — entirely on-device.

- `pnpm --filter web start` — dev server
- `pnpm --filter web build` — production build; `postbuild` measures the real gzipped initial bundle against a ≤600 KB budget
- `pnpm --filter web e2e` — builds production, then runs the Playwright suite (8 specs, 20 tests: offline, library/search/locale, character creation, level-up, play actions, export/import, axe) against it

PWA: `@angular/service-worker` precaches the app shell, fonts, icon sprite, i18n JSON and the core content pack, so the app keeps working in airplane mode after a first load; updates prompt rather than auto-reload. An in-app dismissible banner on the characters list offers native install on Chromium (`beforeinstallprompt`), or an iOS "Add to Home Screen" instructions sheet (with the 7-day standalone-storage warning) on Safari, which never fires that event; the Play tab can hold a Screen Wake Lock during play (the toggle is hidden entirely where the API isn't supported). See `docs/manual-device-checklist.md` for the manual install/offline/export/perf passes this plan adds.

### Character builder & sheet

Fighter (Champion) and Wizard (Evoker), levels 1–5 (`docs/03-roadmap/phase-1-solo-builder.md`).

- `/characters` — character list, with Import (`.hero` bundles) and the install banner.
- `/characters/new` — an engine-driven creation wizard: name + grammatical gender, species, background, ability scores by all four SRD methods (standard array, point buy, manual entry, 4d6-drop-lowest rolling with the rolls recorded in the timeline), class/skills/fighting style, spells, equipment added from the library; review → one transaction that also sets HP to max.
- `/c/:id` — the sheet: **Play** (HP/temp HP/damage/heal, death saves, inspiration, hit dice, spell slots and other resources with prepare/cast and a concentration indicator, conditions and exhaustion chips, inventory with add-from-library/custom items/currency, short/long rest with a hit-dice picker, and a dice roller with a session roll log), **Build** (re-enter the wizard for outstanding choices, rename, appearance, portrait upload), **Timeline** (localized sentences in en/ru/uk with ICU gender/plural, filters, revert with confirmation), and an **Export** button (`.hero` bundle: full event log + portrait blobs, via save-picker → Share → download fallback).
- `/c/:id/level-up` — XP entry and a level-up wizard (HP roll or average, subclass at 3, feat/ASI at 4, spells), undo as one transaction.
- Scope notes: equipment is added from the library rather than chosen from class starting-equipment packages (design ruling); weapon mastery is entered freeform rather than through a constrained picker (current schema limitation, Phase 4); custom inventory items are name+qty+notes lines only, no custom weapon/armor mechanics (Phase 4); encumbrance isn't modeled (a campaign house-rule, Phase 3); token art is identical to the portrait thumbnail today (see `docs/manual-device-checklist.md`'s backlog notes).

### Accounts & cross-device sync (Phase 2 — complete)

Accounts and cross-device sync are shipped. The app is still fully usable logged-out and offline
(solo mode, unchanged); signing in is additive.

- `/register`, `/login`, `/recover` — username + password (PBKDF2-derived verifier, ADR-012; the
  raw password never leaves the browser), a device label, and a one-time recovery-codes screen
  (copy/download + a confirm gate) after registering. `/recover` resets a forgotten password with
  a username + recovery code + new password.
- Once signed in, every character stream syncs live over WebSocket against `apps/api`
  (`apps/web/src/app/shared/services/sync`): local edits queue as pending events, flush to the
  server, and come back committed with authoritative seqs; reconnect/backoff and a one-socket-
  per-device model follow `docs/02-architecture/03-sync-protocol.md`.
- First login **uploads** every local character to the server (local-only characters become the
  server's copy of record); logging in on a **new** device **restores** every character the
  account has from the server.
- Settings (`/settings`, once signed in) adds a **Devices** card — every session's device label,
  last-seen time, and a **Revoke** button for sessions other than the current one — and a
  **Quota** card showing usage against the account's limits.
- Signing out (or "log out everywhere") returns the device to solo mode; nothing already stored
  locally is deleted.

### Backend (accounts + cross-device sync)

`apps/api` is the sync backend (docs/02-architecture/10-backend-architecture.md; ADR-014): accounts, login/recovery, quotas, and a per-character append-only event stream over HTTP + WebSocket, built against runtime ports with **two interchangeable adapters** — Cloudflare (Workers, Durable Objects, D1; the primary, always-on target) and a Node adapter (`@hono/node-server`, `ws`, SQLite via `better-sqlite3`; for local dev and for self-hosting on your own PC). A conformance suite (`apps/api/test/conformance/`) runs identical scenarios against both in CI, so a change that breaks one blocks the merge.

- `pnpm dev` (repo root) — the Node adapter + `ng serve`, proxied together, for fast local dev with no `wrangler` needed. Open the printed `ng serve` URL and use **Register** from Settings (or the app's own account prompt) to create a local test account. `pnpm --filter api dev:node` / `pnpm --filter api dev:cf` run just the Node or Cloudflare adapter (via `wrangler dev`) on their own.
- `pnpm --filter api seed` — creates a test user + a sample character against the Node adapter's on-disk storage (prints the dev/test credentials on every run).
- `pnpm --filter api admin -- <command>` (`herokeep-admin`) — export/import accounts + streams as NDJSON between targets, and burn+reissue a user's recovery codes; never invokes `wrangler` itself.
- `pnpm --filter api test:cloudflare` — the Cloudflare-adapter test suite (Workers runtime via `@cloudflare/vitest-pool-workers`), separate from `apps/api`'s default `vitest run` (Node adapter + core).
- `pnpm --filter web e2e:sync` — a second Playwright project against a real Node API adapter (register/login/recover, cross-device restore, live two-context sync, device revocation), separate from the default offline-only e2e suite.
- Self-hosting the Node adapter on your own Windows PC (NSSM service, Caddy TLS, dynamic DNS, backups) — the route to reach it from another device over your own LAN/WAN: [`docs/self-hosting-windows.md`](docs/self-hosting-windows.md).

### Campaigns (Phase 3 — complete)

The campaign backend (`apps/api`) and client (`apps/web`) are both shipped: campaigns with an
8-char join code (Crockford base32, no vowels, rotate-able), DM/member roles, a per-campaign event
stream on both server adapters, and a full `apps/web` UI + blob-relay client on top of it.

**Server** (`apps/api`), gated by the same conformance suite as the character streams:

- Routes: `POST /api/campaigns` (create, DM = creator), `GET /api/campaigns` (mine: DM-of +
  member-of), `POST /api/campaigns/join` (by join code, only when the campaign has joining open),
  `POST /api/campaigns/:id/rotate-code` (DM), `DELETE /api/campaigns/:id/members/:userId` (DM
  removes a member — closes that member's campaign sockets with a `bye` frame), and
  `GET /api/campaigns/:id/ws` (membership-verified socket, role stamped `dm`/`member`).
- Read visibility is filtered per connection, on both live delivery and reconnect catch-up: DM
  notes never reach non-DM members; roll log and chat entries route by their own visibility field
  (everyone/DM-only/roller-only); everything is still stored regardless of who can currently read
  it, so a filtered-out event is a real, permanent per-viewer gap in that viewer's own seq
  numbering — not a transport loss (`apps/web`'s own sync stores tolerate the resulting forward
  seq jumps on campaign streams specifically; see the "campaign client" bullets below).
- A campaign socket's `append` can target a member's own character stream — the campaign actor
  forwards it through a gateway with a stamped actor (dm, or owner when a member acts on their own
  character), and the character stream re-checks permissions independently. Character-side commits
  mirror back to the campaign stream (e.g. `campaign.character_joined`) once the corresponding
  character-stream event is confirmed, so joins can't half-complete.
  `POST /api/characters/:id/transfer` moves a character's real D1 ownership between accounts
  (session-authed, current-owner gated) — what makes claiming a DM-handed-over pregen a genuine
  ownership change, not just a roster relabel.
- Presence (`members` snapshots, throttled) and a server-side image/blob relay (holder priority,
  16-byte chunk header, ≤64 KB chunks, 1 in-flight per requester, 2 concurrent serves per holder)
  round out the socket surface.
- Quotas: 20 MB events / 12 members / 6 non-core packs per campaign, enforced at both the route
  and the actor's append path. Nightly maintenance syncs each campaign stream's `bytes_used` into
  D1 alongside the existing per-user totals (which campaign usage does not count against).
- `apps/api/test/conformance/` runs campaign lifecycle, visibility-filtering, gateway/mirror, and
  quota scenarios against BOTH adapters, same as the character-stream scenarios.

**Client** (`apps/web`), reusing the plan-8 sync machinery (`StreamSyncSession`/Web Locks/
BroadcastChannel) widened to a `camp:` stream kind alongside `char:`:

- `/campaigns` — every campaign this device has created, joined, or was seeded from the account on
  login, with per-row role and sync-state badges. `/join`, `/join/:code` (deep-link pre-filled) —
  the join screen; `/g/:id/lobby` — the DM's own join code (grouped `XXXX-XXXX`), a QR code
  (`qrcode-generator`, lazy-loaded, encoding `<origin>/join/<code>`), copy-link/rotate, and the
  member list (online presence, DM remove).
- `/g/:id/party` — the party overview grid (HP/AC/passive perception/classes/conditions/
  concentration, a portrait thumb once the blob relay has pulled it), a DM effects panel per card
  (damage/heal/temp HP, conditions, inspiration, XP or milestone levels, item grants, a manual
  sheet-path override) routed through the campaign gateway onto the target character's own stream,
  a DM-only read-only member-sheet drill-in (gated by the campaign's `partySheets: 'full'`
  setting), pregen creation (`Add pregen`) and DM-driven hand-over to a member (the real 5-step
  sequence ending in the ownership-transfer route above), and DM unlink for a removed member's
  now-ownerless character.
- `/g/:id/log` — the roll log (reusing the sheet's own dice-result rendering) and chat, both with
  a per-message visibility picker (everyone/DM-only/private, gated by the campaign's own
  settings), and the DM's session start/end controls. `/g/:id/settings` — DM-editable house rules
  and visibility settings (read-only for everyone else) plus a DM-only campaign export (a
  `.herokeep-campaign` backup of the campaign's own settings/roster/sessions/log — no member
  character data, no import yet). `/g/:id/link-character` — pick an existing synced character (or
  create one, returning here), resume an interrupted join/leave, or claim a pregen the DM just
  handed over (pulls it onto the device via the same restore routine a new device uses, then
  finishes linking it).
- A play-tab roll publishes to the campaign stream (visibility from the campaign's own settings)
  whenever that character is campaign-linked and its campaign socket isn't offline — independent
  of whether a DM session is currently active. `houseRules.editOutsideSession` (`locked`/
  `dmApproval`) disables a linked, non-DM character's mutating choice steps outside an active
  session, with a banner explaining why; a background poll (≤15 s) picks up a session starting/
  ending or a house-rule change on another device without a reload.
- `BlobTransferService` speaks doc-07's relay protocol over the campaign socket: `blob.have`
  announced on connect (own portrait thumbs once this device's own roster link has actually
  landed — re-announced on every subsequent local character/campaign commit, not just the first
  connect) and after every completed download, prefetch tiers P1 (own thumb) → P2 (party thumbs)
  → P3 (own full portrait, idle) → P4 (DM only: every announced hash, continuous), and a
  one-blob-in-flight requester / serve-one-at-a-time holder state machine with SHA-256-verified
  assembly. `CacheManagerService` adds pinning (own + current campaigns), an LRU cap with a
  Settings slider, and a weekly orphan sweep.
- `pnpm --filter web e2e:sync` (below) now also covers the campaign client end-to-end: create/
  join/party overview, visibility-routed rolls and chat, a DM effect landing live on the owning
  member's own open sheet, a lobby removal closing the removed member's campaign UI, DM unlink,
  the full pregen-handover-and-claim path through the real transfer route, a member's portrait
  relaying to the DM's party card via the blob transfer client, and the session/edit-lock round
  trip.

## Plans

Implementation plans live in `docs/superpowers/plans/`; the current ones are
`2026-09-13-phase-1b-play-and-polish.md` (client), `2026-09-13-phase-2-accounts-sync-backend.md`
(backend), `2026-09-19-phase-2-client-sync.md` (client auth + sync UI, completing Phase 2),
`2026-09-20-phase-3-campaign-server.md` (campaign backend, Phase 3 first slice), and
`2026-09-20-phase-3-campaign-client.md` (campaign client, completing Phase 3 — above).
