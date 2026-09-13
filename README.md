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

`apps/web` is the Library and character builder — an installable, offline-first PWA (Angular 22, zoneless) that browses and searches the SRD 5.2.1 pack, renders entity detail as sanitized markdown, switches UI language (en/ru/uk) without a reload, imports the RU sample translation pack from Settings, and builds/plays 5E characters entirely on-device.

- `pnpm --filter web start` — dev server
- `pnpm --filter web build` — production build; `postbuild` measures the real gzipped initial bundle against a ≤600 KB budget
- `pnpm --filter web e2e` — builds production, then runs the Playwright suite (14 specs: offline, library/search/locale, character creation, level-up, axe) against it

PWA: `@angular/service-worker` precaches the app shell, fonts, icon sprite, i18n JSON and the core content pack, so the app keeps working in airplane mode after a first load; updates prompt rather than auto-reload. Installing uses the browser's native install affordance (a valid manifest + service worker) — this release has no in-app install button or iOS instructions sheet.

### Character builder & sheet

Fighter (Champion) and Wizard (Evoker), levels 1–5 (`docs/03-roadmap/phase-1-solo-builder.md`).

- `/characters` — character list. `/characters/new` — an engine-driven creation wizard: name + grammatical gender, species, background, ability scores by all four SRD methods (standard array, point buy, manual entry, 4d6-drop-lowest rolling with the rolls recorded in the timeline), class/skills/fighting style, spells, equipment added from the library; review → one transaction that also sets HP to max.
- `/c/:id` — the sheet: Play (read-only, provenance popovers on derived numbers), Build (re-enter the wizard for outstanding choices, rename, appearance), Timeline (localized sentences in en/ru/uk with ICU gender/plural, filters, revert with confirmation).
- `/c/:id/level-up` — XP entry and a level-up wizard (HP roll or average, subclass at 3, feat/ASI at 4, spells), undo as one transaction.
- Not yet shipped (next plan): play-mode inputs (damage/heal/rest buttons), portrait upload, export/import, install nag, Wake Lock. Two scope notes: equipment is added from the library rather than chosen from class starting-equipment packages (design ruling), and weapon mastery is entered freeform rather than through a constrained picker (current schema limitation).

## Plans

Implementation plans live in `docs/superpowers/plans/`; the current one is `2026-09-12-phase-1b-builder-and-sheet.md`.
