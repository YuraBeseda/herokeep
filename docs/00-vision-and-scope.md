# Herokeep — Vision and Scope

*Working title. Status: approved planning baseline, 2026-08-30.*

## One paragraph

Herokeep is a 5E-compatible character builder, editor and in-play companion for a
tabletop group. A player builds a character at home or at the table, levels it up the way
a video game walks you through a level-up, and during a session tracks hit points, spell
slots, inventory and conditions on a phone while the DM sees the whole party on a laptop.
It is a local-first progressive web app: every device keeps a full copy of its data and
keeps working when the venue wifi drops; a very small cloud service keeps the canonical
event streams so that nobody's character ever "vanishes" and so a DM's dead laptop does
not end the session. Images never touch the server.

## Name

**Herokeep** — chosen by the owner on 2026-08-30 (working title *Hero Ledger* until then).
It is deliberately generic (no "D&D" — a Wizards of the Coast trademark), works in
English and transliterates fine, and says what the app does: it keeps your heroes.
Package scope `@hk/*`; Worker/service name `herokeep`. Alternatives that were on the
table: *Hero Ledger*, *Tabletop Hero*, *Quill & Dice*, *Heroscroll*.

## Who it is for

- **Players** (~50 people, friends and friends-of-friends): build one or more characters,
  play at the table on phone/tablet, level up between sessions, never lose a character.
- **DMs** (anyone can host): create a campaign, configure house rules and content packs,
  invite players by code/QR, watch the party, apply damage/conditions/XP/items, override a
  sheet when a mistake needs fixing, add homebrew content.
- **Content authors** (later): write JSON packs — new species, classes, spells, items — and
  translations, without touching application code.

## Fixed decisions (inputs to this plan, not re-opened)

- Rules: D&D 5e **2024** rules, **SRD 5.2.1** content only (CC-BY-4.0). The engine must be
  data-driven enough that SRD 5.1 (2014) can be added as a second selectable system later —
  that addition is the proof the plugin architecture works.
- Ships with SRD content; a host can extend a campaign with custom content packs.
- Character-focused. Dice only for checks, attacks and spells. No VTT, maps, or combat
  tracker in v1.
- Extensions start as declarative data (JSON). A later phase adds richer mechanical
  extensions; v1 must make that an extension, not a rewrite.
- Images may be uploaded by users but are **never persisted on project infrastructure**.
- Zero budget: free tiers only; nothing is bought. Solo developer, hobby, no deadline.
- Must also run self-hosted on a Windows PC with a static IP, and switching away from
  Cloudflare must be easy (added 2026-08-30; ADR-014).
- Scale: ~50 users, ~10 concurrent sessions.
- Desktop, tablet and phone all matter. Unreliable venue wifi is expected.
- Russian-first team, English default UI; Russian and Ukrainian switchable from day one;
  full i18n structure from the first commit; content translation optional with English
  fallback.
- All planning output is markdown inside the project folder.

## Decisions made in this planning session (see `01-decisions/`)

| # | Topic | Decision |
|---|-------|----------|
| ADR-001 | Topology | Local-first replicas on every device + thin authoritative sync core on Cloudflare Durable Objects. The DM is a role, not a network topology. |
| ADR-002 | Transport | WebSocket to the Durable Object; no WebRTC/TURN in v1; protocol designed transport-agnostic. |
| ADR-003 | Durability | Three copies of every character (device, DM device, server); IndexedDB with persistence request; export/import bundles; recovery flows for every "my character vanished" cause. |
| ADR-004 | Entry modes | Three first-class entry points: Solo, Host, Join. Solo characters live on the device (+ account backup once logged in). |
| ADR-005 | Stack | TypeScript everywhere. Angular 22 frontend, Hono on Cloudflare Workers + Durable Objects + D1 backend, pure-TS rules engine package. No .NET, no Aspire, no GraphQL. |
| ADR-006 | Hosting | Cloudflare primary (Workers static assets, Workers, DO, D1). GitHub Actions deploys. Amended by ADR-014. |
| ADR-007 | Character state | Append-only event log of decisions, deterministic replay, cached snapshots, revert events for undo, level-up wizard driven by progression data. |
| ADR-008 | Extensions | JSON packs with a declarative effect vocabulary and a safe formula grammar; SRD content written in the same vocabulary; semver + per-character pinning + rebase on update; strict validation and sandboxing for untrusted packs. |
| ADR-009 | i18n | Transloco + ICU for UI; translation packs for content; grammatical gender on the character; per-locale search with English fallback. English is the source of truth. |
| ADR-010 | Images | Client-side resize/encode, hard caps per kind, content-addressed, relayed peer-to-peer through the DO in memory only, cached per device, placeholders when offline. |
| ADR-011 | UI | Dark-first, readable, "game-adjacent" phase 1 on a token-based design system in SCSS; fantasy skin later as a theme. Cyrillic-capable fonts only. |
| ADR-012 | Identity & security | Username + password (no email collected), browser-side key derivation, cookie sessions, recovery codes, quotas, rate limits. |
| ADR-013 | Rules engine | Facts → Sheet pipeline; effects, predicates, formulas, choices; provenance on every derived number; strict validation with house-rule overrides. |
| ADR-014 | Backend portability | Backend core written against runtime ports with two adapters: Cloudflare (primary) and a single Node process for self-hosting on a Windows PC with a static IP (free TLS via dynamic-DNS hostname + Caddy). Conformance-tested; export/import CLI makes switching a hostname change. |

## Scope of v1 (the first *complete* product; delivered across phases 1–3)

**In:** character creation wizard; sheet in build/play/timeline modes; level-up wizard
(XP and milestone); HP, temp HP, hit dice, death saves; spell slots, preparation, spellbook;
conditions and exhaustion; inventory with equip/attune, currency, weight; short/long rests;
concentration; heroic inspiration; notes; dice rolls for checks/attacks/spells with a
shared log; solo mode; accounts with cross-device sync; campaigns with join codes/QR;
party overview for the DM; DM effects (damage, heal, conditions, XP, items) and audited
overrides; content packs (SRD + imported JSON + quick homebrew); export/import; EN UI with
RU/UK switch; PWA install with offline operation.

**Out of v1 (later phases):** the remaining ten classes' mechanics (their *data* ships
from day one), multiclassing, GUI pack editor, fantasy theme skin, PDF export,
RU/UK content translation at scale, 2014 ruleset, community pack registry, passkeys,
end-to-end encryption.

**Never (by decision):** VTT, battle maps, combat tracker, monster management, server-side
image storage, analytics/trackers, paid tiers.

## Non-negotiable design rules (restated so every later session sees them)

1. **Game rules are data.** No class progression, species trait, or spell effect is
   expressed in TypeScript. If it is not expressible in the pack format, the pack format
   grows — the engine does not get a special case.
2. **i18n is structural from commit one.** No user-visible string literal in a template;
   every content field is localizable; every list is collated with `Intl.Collator`.
3. **Every phase ships something usable and never requires rewriting the previous phase.**
   The roadmap (`03-roadmap/phases.md`) states what each phase ships and its acceptance
   criteria.
4. **Events are immutable.** Nothing in a stream is ever edited or deleted; corrections are
   new events. Reducers must read every past event version forever.
5. **The server never runs the rules engine.** It validates envelopes, permissions and
   sizes, assigns sequence numbers, stores, and fans out. Clients compute; determinism
   guarantees convergence.

## How to read this documentation

Start with `01-decisions/` (why), then `02-architecture/01-system-overview.md` (what),
then `03-roadmap/phases.md` (when). `04-reference/` holds verified facts with dates and
sources, the legal attribution text, and open questions. `README.md` is the index.
