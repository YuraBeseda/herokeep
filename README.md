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
- Scope notes: equipment is added from the library rather than chosen from class starting-equipment packages (design ruling); weapon mastery is entered freeform rather than through a constrained picker (current schema limitation, Phase 4); custom inventory items are name+qty+notes lines only, no custom weapon/armor mechanics (Phase 4); encumbrance isn't modeled (a campaign house-rule, Phase 3); token art is identical to the portrait thumbnail today (see `docs/manual-device-checklist.md`'s backlog notes). Not yet shipped: accounts and cross-device sync (Phase 2) — characters live only in this device's own storage until then.

## Plans

Implementation plans live in `docs/superpowers/plans/`; the current one is `2026-09-13-phase-1b-play-and-polish.md`.
