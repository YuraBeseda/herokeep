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
| **4 — Full SRD mechanics** | Remaining 10 classes and their SRD subclasses to level 20; multiclassing; all feats; magic items with attunement/charges; weapon mastery for all weapons; encumbrance option; custom pack import (`.hkpack`); quick homebrew forms (item, spell, feature, species); pack update/rebase flow; Web Worker derive if needed. | 1b (3 for pack enabling in campaigns) |
| **5 — Polish & fantasy skin** | Theme packs (parchment/arcane), accent/density/font-size prefs, dice animations, damage/level-up motion, PDF character sheet export, Wake Lock, WASM WebP encoder for Safari, RU/UK content translation pipeline + first translated packs, in-app "suggest a translation fix" export, accessibility audit. | 3, 4 |
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
