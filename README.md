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
- `pnpm --filter web e2e` — builds production, then runs the Playwright suite (13 specs, 31 tests as of plan 15: offline, library/search/locale, character creation (Fighter + Monk + Rogue with Expertise + Soldier options), level-up, multiclassing, play actions, export/import, custom content packs, axe) against it

PWA: `@angular/service-worker` precaches the app shell, fonts, icon sprite, i18n JSON and the core content pack, so the app keeps working in airplane mode after a first load; updates prompt rather than auto-reload. An in-app dismissible banner on the characters list offers native install on Chromium (`beforeinstallprompt`), or an iOS "Add to Home Screen" instructions sheet (with the 7-day standalone-storage warning) on Safari, which never fires that event; the Play tab can hold a Screen Wake Lock during play (the toggle is hidden entirely where the API isn't supported). See `docs/manual-device-checklist.md` for the manual install/offline/export/perf passes this plan adds.

### Character builder & sheet

Fighter (Champion) and Wizard (Evoker) launched at levels 1–5 (`docs/03-roadmap/phase-1-solo-builder.md`); Phase 4 slice 1 (below) extends both to level 20 and adds Barbarian (Berserker), Cleric (Life), and Warlock (Fiend), also to 20.

- `/characters` — character list, with Import (`.hero` bundles) and the install banner.
- `/characters/new` — an engine-driven creation wizard: name + grammatical gender, species, background, ability scores by all four SRD methods (standard array, point buy, manual entry, 4d6-drop-lowest rolling with the rolls recorded in the timeline), class/skills/fighting style, spells, equipment added from the library; review → one transaction that also sets HP to max.
- `/c/:id` — the sheet: **Play** (HP/temp HP/damage/heal, death saves, inspiration, hit dice, spell slots and other resources with prepare/cast and a concentration indicator, conditions and exhaustion chips, inventory with add-from-library/custom items/currency, short/long rest with a hit-dice picker, and a dice roller with a session roll log), **Build** (re-enter the wizard for outstanding choices, rename, appearance, portrait upload), **Timeline** (localized sentences in en/ru/uk with ICU gender/plural, filters, revert with confirmation), and an **Export** button (`.hero` bundle: full event log + portrait blobs, via save-picker → Share → download fallback).
- `/c/:id/level-up` — XP entry and a level-up wizard (HP roll or average, subclass at 3, feat/ASI at 4, spells), undo as one transaction.
- Scope notes: equipment is added from the library rather than chosen from class starting-equipment packages (design ruling); custom inventory items are name+qty+notes lines only, no custom weapon/armor mechanics; token art is identical to the portrait thumbnail today (see `docs/manual-device-checklist.md`'s backlog notes). Weapon mastery (a real constrained picker) and encumbrance (opt-in via campaign house rules, off by default) both shipped in Phase 4 slice 1 — see below.

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

### Phase 4 slice 1 — engine vocabulary, multiclassing & five classes to 20 (complete)

Five classes now play to level 20 with full SRD 5.2.1 mechanics: Fighter (Champion), Wizard
(Evoker), Barbarian (Berserker), Cleric (Life), and Warlock (Fiend) — each with its one SRD
subclass. Getting there required widening the engine's own vocabulary (game rules stay DATA, per
`CLAUDE.md`'s non-negotiable rule) rather than hand-coding any of it:

- **New pack vocabulary** (`docs/02-architecture/04-content-packs.md`, additive-only — existing
  packs/characters keep parsing byte-identically): `FlatDiceSchema`/`DiceOrFlatSchema` for
  no-die flat damage (the Blowgun's "1" damage, previously a broken `0d4+1` hack); class-row
  `extra` columns now accept dice/plain-text values alongside numbers and formulas, for stepped
  per-level tables (Rage damage, weapon-mastery count, stepped cantrips-known); `EntityQuerySchema`
  gained a `hasField` filter, so Weapon Mastery is now a real constrained picker
  (`{query: {type: 'item', hasField: ['weapon.mastery']}}`) instead of freeform text; item
  `charges` (per-instance resources, keyed `item:<uuid>`, reusing the existing resource
  spend/restore events) and `attunement.by` (a predicate, enforced at last) both went from
  schema-only to actually wired; encumbrance (`standard`/`variant` carry-capacity modes) is a new,
  opt-in `derive()` override — off by default for solo play, toggled per campaign from DM-only
  house rules (`/g/:id/settings`) alongside the existing session-lock rule.
- **Multiclassing** (ADR-007): leveling up offers a "which class?" picker whenever more than one
  advancement is available — the character's own next level, plus any new class whose 13+
  ability-score prerequisite is met (checked against EVERY class already taken, not just the new
  one). The multiclass spell-slot table combines each class's own caster level (full casters count
  every level; half-casters — Paladin, Ranger — round UP per the 2024 SRD's own text, a deliberate
  change from 2014's round-down) and looks up the combined total on the same 20-row table a
  single-class full caster already uses. Pact Magic (Warlock) slots stay a separate pool, castable
  interchangeably with regular slots, and recover on a short OR long rest.
- **Performance**: `derive()` on the heaviest scenario this slice ships (a level-20, two-class
  character with 30 events) measures a **0.549 ms median** (25 samples) against doc-05's budget of
  <5 ms desktop / <15 ms mid-phone — roughly 9x and 27x headroom respectively, on ordinary
  dev/CI hardware. No Web Worker needed for this slice.
- **e2e**: the default (offline) Playwright project gained a multiclass scenario (level up a
  fighter, pick "Multiclass into Barbarian" from the which-class picker, complete Barbarian's own
  level-1 choices, confirm the sheet shows both classes); the real-API `e2e:sync` suite's own
  character-creation helper was repaired for the new constrained weapon-mastery picker.
- Slice 2 (below) completed the remaining 7 classes, feats and magic-item data; slice 3
  (`.hkpack` import, homebrew, pack rebase) is next.

### Phase 4 slice 2 — remaining seven classes, feats & magic items (complete)

Bard, Druid, Monk, Paladin, Ranger, Rogue, and Sorcerer now play to level 20, each with its one
SRD subclass — **all 12 SRD classes** are mechanized (plan 12 task reports; the ledger's
"last of 12 classes" is Druid, task 13). As in slice 1, rules stay DATA in the packs.

- **Vocabulary closed in this slice** (`docs/02-architecture/04-content-packs.md`): repeatable
  feats stack their direct effects per occurrence; `choice.count` may be a formula (Fighter's
  weapon-mastery count 3 → 6 now re-offers the choice as it grows); `spell.grant` with
  `alwaysPrepared` is honored (granted spells do not count against the prepared cap and cannot be
  unprepared); multiclass pooled spell slots render once on the sheet.
- **Feats**: 17 SRD feats accounted for — 4 fighting styles (slice 1), 9 with real mechanics (Alert,
  Ability Score Improvement, the seven Epic Boons), and 4 carried as whole text (Magic Initiate,
  Savage Attacker, Skilled, Grappler) — source: plan-12 ledger, task 5.
- **Magic items**: 43 items have parsed charges (39 reset at dawn, 4 never) and 18 carry an
  attunement requirement predicate (12 class + 6 "Spellcaster") — source: ledger, task 6
  and its review. Two approximations are owner-flagged: dawn charges restore on a long rest, and
  rolled regain amounts (e.g. "1d6 + 4") restore fully (slice-3 carry: dice-in-rest).
- **Goldens**: 24 new engine goldens (34 → 58) across the seven classes at levels 5/11/20 plus
  three multiclass cases (Paladin 5/Cleric 3 pins the half-caster round-up combined caster level
  of 6, slots [4,3,3]) — source: task 15 report.
- **Performance**: the heaviest new `derive()` scenario (a level-20 Paladin) measures a
  **0.635 ms median** (25 samples), against doc-05's <5 ms desktop / <15 ms mid-phone budget —
  source: `packages/engine/test/golden/PERF.md` and the task 15 report. No Web Worker needed.
- **e2e**: the offline project gained a Monk-through-the-wizard scenario (new class card, six-skill
  pool, no mastery/fighting-style step, Unarmored Defense AC); the full offline run is 25/25 and
  `e2e:sync` is 8/8 (run in two chunks), with no helper repairs needed. (The fighter → Paladin flow was not
  used: Paladin's multiclass gate needs CHA 13 and the shared Fighter fixture has CHA 8.)
- Gates at close: pack 1866 entities / 0 diagnostics, root 109 files / 1684 tests, web 134 / 1475
  (ledger, task 15 and task 14), gzip bundle 337.3 / 600 KB (this task's build).

### Phase 4 slice 3 — vocabulary completions & polish (complete)

Plan 13 closed the slice-2 carries that needed new engine vocabulary, plus a round of builder
polish. Rules stay DATA: each mechanism is generic engine code, and the SRD numbers live in the
overlays. `.hkpack` import, homebrew and pack rebase are still ahead. Sources are the plan-13 task
reports (`task-N` below).

- **Expertise** (task 1): a skill query pick can grant `expertise` and offer only skills the
  character is already proficient in (`requireProficient`). Rogue gets 2 at level 1 and 2 at 6, Bard
  2 at 2 and 2 at 9, Ranger 1 at 2 (Deft Explorer) and 2 at 9. The total doubles the proficiency
  bonus, and an expertise pick never creates proficiency.
- **Tool proficiencies** (task 2): tools land in `sheet.proficiencies` as `kind: 'tool'` rows
  (Rogue's Thieves' Tools, background tools, the Monk's one-tool and the Bard's three-instrument
  picks). The play tab lists them under Tools.
- **Resource reset override and restricted ability picks** (task 3): a re-declared resource takes
  its `reset` from the last define in composition sort order (lexical by source, then feature — not
  by level), so Font of Inspiration makes Bardic Inspiration a Short Rest pool from bard level 5. An
  `abilities` pick can list its allowed abilities (`from`), so Grappler's +1 offers only STR or DEX.
- **Free casts** (task 4): `spell.grant.uses` can point at an existing resource. Favored Enemy's
  Hunter's Mark casts spend `favored-enemy`, and Wild Companion's Find Familiar spends a Wild Shape
  use. The cast dialog offers a free option next to the slot options.
- **Scaling speed and immunities** (task 5): `speed.bonus` takes a formula (Monk Unarmored Movement
  is one row). A non-walk bonus can read `speed(walk)`, so Ranger Roving gives climb and swim speeds
  equal to the walk speed. `condition.immunity` now feeds `sheet.immunities`, shown as badges for
  Paladin Aura of Courage and Aura of Devotion. Mindless Rage stays text, because there is no
  raging state to gate it on.
- **Rolled charge regain** (task 6): this retires slice 2's "rolled regain restores fully"
  approximation. 38 of the 43 charged items now carry `charges.regain` dice (14 of them roll 1d3).
  The long rest rolls them and records each total as `resource.restored.count`, and replay never
  re-rolls.
- **Multiclass attack fix** (task 7): attack proficiency now uses the same per-class lists as
  `sheet.proficiencies`. A Wizard → Rogue's rapier no longer adds proficiency.
- **Builder polish** (tasks 8–9): picker options that fail a prerequisite, or repeat an earlier pick,
  stay listed but are disabled with a visible reason. Always-prepared spells show a disabled
  Unprepare button. A grown choice (e.g. Fighter weapon masteries 3 → 4) re-opens with the recorded
  picks pre-selected, and the event it records is unchanged.
- **Goldens & perf** (task 10): 5 new goldens bring the golden suite from 58 to 63 tests
  (62 fixtures plus one spec-level pin): Paladin 5/Ranger 3 (combined caster level 5, slots
  4/3/2), Ranger 5/Warlock 3, Rogue 11 with Expertise, and two play cycles (Bard 6, Ranger 5).
  The heaviest new scenario derives in a **0.326 ms median**, against the 15 ms mid-phone budget
  (`packages/engine/test/golden/PERF.md`).
- **e2e** (task 11): the offline project gained a Rogue-through-the-wizard scenario. It checks that
  Expertise offers only proficient skills, that the sheet shows the doubled bonus, and that Thieves'
  Tools is listed. The full offline run is 26/26, and `e2e:sync` passed 8/8 in one unchunked pass.
- **Gates at close**: pack 1866 entities / 2,225,797 bytes / 0 diagnostics; root 123 files / 1837
  tests; web 136 files / 1497 tests (task 10); gzip bundle 339.3 / 600 KB (task 11 build).

### Phase 4 slice 4 — carry retirement II & per-character rule options (complete)

Plan 14 retired the plan-13 carry list and gave solo characters their own rule options. Rules stay
DATA: each change is generic engine code plus overlay data. Sources are the plan-14 task reports
(`task-N` below); the full reference is in `docs/02-architecture/04-content-packs.md`, doc 02 and
doc 05.

- **Initial vs later class choices** (task 1): a class-row choice can be scoped `initial` or `later`.
  A Bard taken as a later class is offered ONE Musical Instrument (`bard@1/multiclass-tools`)
  instead of three, a later Monk no tool, and a later Rogue gains Thieves' Tools through the new
  `multiclass.gains.toolProficiencies`. Old logs keep every recorded pick.
- **Mixed-type picks** (task 2): one pick can union several queries (`queries`), and an item query
  can filter by `category`. Skilled now takes any mix of three skills or tools, and the Soldier's
  generic "gaming set" became a real pick of one of the four Gaming Sets.
- **Item effects & attunement** (task 3): a new items overlay gives the first magic items real
  effects — Gloves of Swimming and Climbing, Slippers of Spider Climbing and Cloak of Arachnida (climb
  or swim equal to your Speed, Poison resistance, a once-per-dawn Web). Items that require
  attunement now work only while attuned (charges are not gated). The sheet gained
  `resistances`, and Thief Second-Story Work grants its climb speed.
- **Expertise & mastery across classes** (task 4): an expertise pick no longer offers a skill another
  class already made expert. A multiclass character's weapon-mastery count is the highest of its
  classes' counts, not the sum, shared across all its mastery picks (owner-flag: SRD-silent).
- **Per-character encumbrance** (task 5): the new `character.options.set@1` event and the Build
  tab's Rule options let a solo character choose Off / Standard / Variant encumbrance. A campaign
  house rule always wins (the select is then disabled with a reason), and provenance says
  `house rule` or `character option`.
- **Display polish** (task 6): breakdown popovers show the resolved number of formula contributions,
  timeline restores read "Restored 2 charges of <item>" or "1 use of <feature>", a pre-seeded choice
  step shows its count message straight away, and resistances appear as badges. Mastery names stay
  raw slugs: the pack has no mastery entities yet (owner-flag).
- **Goldens & perf** (task 7): 9 new goldens bring the golden suite from 63 to 72 tests (71 fixtures
  plus one spec-level pin). The heaviest scenario derives in a **0.471 ms median** against the 15 ms
  mid-phone budget (`packages/engine/test/golden/PERF.md`).
- **e2e** (task 8): the offline project gained a Soldier-through-the-wizard scenario: it picks
  Playing Cards, checks the Tools list, then switches encumbrance to Variant and checks the carry line
  (129 / 255 lb, Encumbered, Speed −10 ft.). The full offline run is 27/27, and `e2e:sync` passed 8/8
  in one pass.
- **Gates at close** (task 8): pack 1866 entities / 2,230,308 bytes / 0 diagnostics; root 136 files /
  1960 tests; web 136 files / 1518 tests; goldens 72/72; gzip bundle 340.3 / 600 KB.

### Phase 4 slice 5 — custom pack platform (complete)

Plan 15 adds third-party and homebrew content packs, end to end. All of it is generic mechanism,
with no new core content. Sources are the plan-15 task reports (`task-N` below). The full
reference is "Custom pack platform (plan 15)" in `docs/02-architecture/04-content-packs.md`, plus
docs 02, 07 and 09.

- **Import with a trust screen** (tasks 2–3). `/packs` imports a `.hkpack` (zip) or a bare
  `pack.json`.
  - Everything is checked before anything is stored: container caps from the zip's central
    directory (2001 entries, 64 MiB of assets, a 72 MiB zip), the strict schema, `validatePack`,
    and each asset's size, magic-byte mime and sha256.
  - The trust screen then lists authors, license, dependencies, attribution, entity counts,
    overrides and warnings before Install.
  - Pack assets are stored as `origin: 'pack'` blobs, which the cache sweeps never evict.
  - Refusals map to 11 `packs.import-failed-*` codes.
- **Packs are pinned per character** (tasks 1 and 4). Each character derives against its own pins
  (`EngineFacade.indexFor`, engine `pinnedRoots`), so an installed pack only changes the characters
  that pin it.
  - The creation wizard lists installed packs to pin.
  - The Build tab can pin and unpin them.
  - A pin with no installed pack shows a missing-pack banner.
  - The new `pack.unpinned@1` event is owner-only, and its reducer never refuses.
- **Updates with a rebase report** (tasks 1 and 5). The engine's pure `planRebase` lists:
  - the sheet changes, compared against the sheet AFTER the update;
  - the decisions the update invalidates (decisions that were already invalid are not listed);
  - the `deprecated.replacedBy` migrations.

  Confirm writes one transaction: `pack.pinned` → `pack.unpinned` → `decision.made` →
  `decision.cleared`. The Build tab and `/packs` show "Update available". A core update is
  validation-only, and is offered only when the shipped core is newer.

- **Homebrew** (task 7). `/packs/homebrew` has item, spell, feat and species forms. They author a
  device-unique `homebrew-<8 hex>` content pack, starting at 0.1.0 with a PATCH bump per save.
  - Characters that pin it fast-forward silently, unless the update would invalidate or unresolve
    something; those stay pending.
  - Measured: 363–431 ms for 20 level-20 characters.
- **`.hero` carries packs** (task 6). An export bundles every installed, non-core pinned pack as
  `packs/<id>@<version>.json` plus its assets. Import validates them all first, then installs any
  that are missing.
- **pack-tools** (task 8). `build --zip` writes a deterministic `.hkpack`, and `validate` accepts
  `.hkpack`. Two checked-in fixtures (`apps/web/e2e/fixtures/packs/`) are guarded by a rebuild
  test.
- **Goldens & perf** (task 8). The golden harness loads fixture content packs (`fixture:` entries).
  Three new goldens (homebrew-pinned, pack-unpinned-unresolved, pack-updated-v2) bring the suite to
  **77/77**. The new scenario derives in a **0.168 ms median**, and the heaviest (paladin-20) in
  0.473 ms, against the 15 ms mid-phone budget (`packages/engine/test/golden/PERF.md`).
- **e2e** (task 9). The offline project gained `custom-packs.spec.ts`, which covers:
  - import → trust → Install → a Moonkin fighter pinned in the wizard;
  - the pack weapon's attack row;
  - the v2 update through the report (the masteries decision migrates);
  - a pinned homebrew item in the add-item picker;
  - a `.hero` round trip that reinstalls the removed pack.

  The full offline run is **31/31**. The `e2e:sync` restore scenario now also checks that a pin
  syncs without its pack, showing the banner on the new device, and it passed **8/8** in one pass.

- **Gates at close** (task 9):
  - pack: 1866 entities / 2,230,308 bytes / 0 diagnostics;
  - root: 145 files / 2102 tests;
  - api Cloudflare: 8 files / 40 tests + 1 skipped;
  - web: 147 files / 1729 tests;
  - goldens: 77/77;
  - gzip bundle: 343.6 / 600 KB.
- **Owner-flags:**
  - the container caps are this plan's choice;
  - old core versions are not retained;
  - the campaign pack relay is not built (`pack.enabled@1` carries `{packId, version, sha256}`
    only);
  - homebrew does not merge across devices;
  - the transliteration table is a convenience;
  - a rebase migrates decisions, not inventory item ids.

## Plans

Implementation plans live in `docs/superpowers/plans/`; the current ones are
`2026-09-13-phase-1b-play-and-polish.md` (client), `2026-09-13-phase-2-accounts-sync-backend.md`
(backend), `2026-09-19-phase-2-client-sync.md` (client auth + sync UI, completing Phase 2),
`2026-09-20-phase-3-campaign-server.md` (campaign backend, Phase 3 first slice),
`2026-09-20-phase-3-campaign-client.md` (campaign client, completing Phase 3), and
`2026-09-27-phase-4-engine-vocabulary-and-classes.md` (engine vocabulary, multiclassing, and five
classes to 20 — Phase 4 slice 1, above), and
`2026-09-27-phase-4-slice-2-remaining-classes-feats-items.md` (the remaining seven classes,
feats, and magic items — Phase 4 slice 2, above), and
`2026-10-03-phase-4-slice-3-vocabulary-completions-and-polish.md` (vocabulary completions and
builder polish — Phase 4 slice 3, above), and
`2026-10-17-phase-4-slice-4-carry-retirement-and-rule-options.md` (carry retirement and
per-character rule options — Phase 4 slice 4, above), and
`2026-10-18-phase-4-slice-5-custom-pack-platform.md` (custom pack platform — Phase 4 slice 5,
above).
