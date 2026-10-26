# Roadmap

Rule: every phase ships something a real person at a real table can use, and no phase
requires rewriting the previous one. Phases are ordered by dependency, not by calendar —
there is no deadline. Each phase ends with a tagged release and the manual device
checklist.

| Phase | Ships (usable outcome) | Depends on |
|-------|------------------------|------------|
| **1a — Library** | An installable, offline PWA that browses and searches the full SRD 5.2.1 (spells, species, backgrounds, feats, equipment, rules) in EN with RU/UK UI; attribution screen. Under the hood: monorepo, engine core (content index, formulas, effects registry, localizer, search), SRD import tool, pack schema + validator CLI, design tokens + first components, CI. | — |
| **1b — Solo builder & play** | Create a Fighter (Champion) or Wizard (Evoker) 1–5 with any species/background/equipment; full sheet in Play/Build/Timeline; level-up wizard (XP or manual); HP/temp/hit dice/death saves; slots, spellbook, preparation; conditions/exhaustion; inventory/equip/attune/currency; rests; concentration; inspiration; notes; dice for checks/attacks/spells with a local log; undo; portrait upload (local); export/import `.hero`; PWA install nag; storage persistence. | 1a |
| **2 — Accounts & sync** | Register/login/recovery codes; characters sync across a user's devices; server copy of every character; "restore on new device"; quotas; devices list; local-only characters upload on first login. Backend core on runtime ports with **both adapters** (Cloudflare and self-hosted Node), the conformance suite, the `herokeep-admin` export/import CLI, and the Windows self-host recipe (ADR-014). | 1b |
| **3 — Campaigns** | Host a campaign (settings, packs, join code/QR); players join with existing or new characters; pregens and claiming; party overview; DM effects (damage/heal/conditions/XP/items/level grant); Override mode with audit; roll log with visibility rules; presence; image relay + caching + placeholders; DM super-peer; session start/end grouping; edit-outside-session rule; campaign export. | 2 |
| **4 — Full SRD mechanics** — **complete 2026-10-25** (plans 11–16) | Remaining 10 classes and their SRD subclasses to level 20; multiclassing; all feats; magic items with attunement/charges; weapon mastery for all weapons; encumbrance option; custom pack import (`.hkpack`); quick homebrew forms (item, spell, feature, species); pack update/rebase flow; Web Worker derive if needed. Pack enabling in campaigns shipped in plan 16: the server stores each enabled pack's JSON and members install it automatically; pack assets ride the blob relay. A Web Worker derive was not built: every measured derive median in the plan-16 rows is under 0.5 ms, against the 15 ms mid-phone budget (`packages/engine/test/golden/PERF.md`). **Owner-flags at close:** (1) the synthetic `@1/skills` choices (plan 17 candidate); (2) homebrew does not merge across devices; (3) old core versions are not retained on a device; (4) no `.hkpack` export from a device; (5) the DM cannot push pack UPDATES to members' characters — members update through their own Build tab; (6) server-side pack asset storage stays "relay only"; (7) the documented rule "a pack may not override `system` except via `kind: core`" is not enforced (a protocol/engine change for a later plan); (8) tooling: the web bundle-budget gate under-counts the initial bundle beyond 10 modulepreload links (it reports 316.1 kB; the real initial closure measured 348.4 kB in plan 16 task 3; budget 600); (9) a member cannot opt out of a campaign's enabled packs without leaving the campaign (auto-install by design); (10) the Build tab's turn-on pins without `planRebase` (latent: re-enabling a pack whose newer version deprecates a held item will not migrate it); (11) the party-sheets default disagrees: the server defaults to `full` (`apps/api/src/core/streams/campaign-actor.ts:143`), while the web treats never-saved settings as "Overview only" (`apps/web/src/app/views/campaigns/party/party-tab.component.ts:95`, `settings/campaign-settings.component.ts:44`), so the DM's View sheet stays hidden until the DM saves Full sheets; (12) fixed in plan 16: the DM's party View sheet dialog never opened in a production build since plan 10 (`TypeError: Illegal invocation` from detached browser timers in `ForeignCharacterSession`, fixed in 7916354); (13) release note: members on a pre-slice-6 build must reload once after the DM enables a pack — the old client's strict `welcome` schema refuses the new `packs[].sha256` and it reconnects until it updates (`docs/02-architecture/03-sync-protocol.md` §Campaign packs, "Compatibility"); (14) backlog from the plan-16 final review: the rebase report does not show inventory item migrations (the player learns of them from the timeline); the initial class's mastery offer never shrinks when a later class raises the cap, so both re-offers are outstanding at once and the second answer is silently over-cap; "Installing…" is shown for an enabled pack while the campaign is offline or on a non-leader tab; the DM super-peer idle tick does one Dexie `get` per enabled-pack asset with no minimum interval; three `canonicalJson` copies (pack-tools, web, api) carry the bytes-equality contract — move one into `@hk/protocol` on the next protocol touch. | 1b (3 for pack enabling in campaigns) |
| **5 — Polish & fantasy skin** | Full frontend redesign FIRST (information architecture, navigation and stable action bars, compact game-like theme with textures, icon-first controls with hover hints for en/ru/uk, mobile layouts, per-locale text fit, the catalogued UX defects fixed) — designed in Claude Design and moved to code only after owner approval (plan `2026-10-18-phase-5-slice-1-frontend-redesign.md`); then theme packs (parchment/arcane), accent/density/font-size prefs, dice animations, damage/level-up motion, PDF character sheet export, Wake Lock, WASM WebP encoder for Safari, RU/UK content translation pipeline + first translated packs, in-app "suggest a translation fix" export, accessibility audit. | 3, 4 |
| **6 — Second ruleset (the plugin proof)** | SRD 5.1 (2014) core pack: races/subraces, 2014 backgrounds/feats/classes; campaign creation offers 5e-2014; vocabulary gaps fixed as versioned format additions; conversion notes. | 4 |
| **7 — Rich extensions & community** | GUI pack editor with live sheet preview; effect authoring UI; community pack sharing (registry of pack JSON, still no images server-side); optional passkeys; optional E2E encryption with explicit "reset = data loss" consent; WebRTC LAN fast-path experiment. | 5, 6 |

## What is explicitly deferred and why

- **Accounts before campaigns**: campaigns need identity; solo is useful without it, so
  solo ships first and accounts are a small step in between.
- **Ten classes after campaigns**: two classes exercise every engine subsystem; the rest
  is data work that benefits from a stable vocabulary and can proceed in parallel with
  Phase 3 if desired.
- **Fantasy skin last among v1 items**: layouts must exist before decoration; the token
  system makes the skin additive.
- **2014 ruleset after full 2024 mechanics**: the proof is only meaningful once the
  vocabulary has carried all of 2024.

## Milestone definitions

- **"Usable at my table"** = end of Phase 1b (each player on their own phone).
- **"Usable for my group"** = end of Phase 3.
- **"v1 complete"** = end of Phase 5.
- **"Architecture proven"** = end of Phase 6.

## Risks to watch (with the phase that retires each)

| Risk | Retired in |
|------|-----------|
| Vocabulary cannot express an SRD mechanic | 1b (Fighter/Wizard), 4 (all) |
| iOS storage eviction / reconnect behaviour | 1b (install nag, persist), 3 (reconnect on real iPhone) |
| Free-plan limits | 3 (usage cron + alert) |
| Replay/derive performance on phones | 1b (measured), 4 (worker if needed) |
| Untranslated content feels broken | 1a (fallback rendering), 5 (translations) |
| Pack update breaks characters | 4 (rebase flow with report) |
