# Herokeep — planning documentation

_Working title. Planning baseline approved 2026-08-30. No application code exists yet;
the next session writes the Phase 1a implementation plan._

## Reading order

1. [00-vision-and-scope.md](00-vision-and-scope.md) — what, for whom, fixed decisions,
   decision summary table, non-negotiable rules.
2. [01-decisions/](01-decisions/README.md) — the thirteen ADRs (options, trade-offs,
   decision, consequences). Start with ADR-001; everything depends on it.
3. [02-architecture/](02-architecture/) — how it is built:
   - [01-system-overview](02-architecture/01-system-overview.md) — containers, contexts, data flows
   - [02-domain-model-and-events](02-architecture/02-domain-model-and-events.md) — ids, tables, Facts, full event catalog, campaign settings
   - [03-sync-protocol](02-architecture/03-sync-protocol.md) — WebSocket messages, ordering, commit rules
   - [04-content-packs](02-architecture/04-content-packs.md) — pack format, effect vocabulary, predicates, formulas, choices, translation packs, rebase
   - [05-rules-engine](02-architecture/05-rules-engine.md) — engine API, pipeline, stacking policies, determinism contract
   - [06-i18n](02-architecture/06-i18n.md) — Transloco/ICU setup, content localization, gender, search
   - [07-images-and-blobs](02-architecture/07-images-and-blobs.md) — upload pipeline, relay protocol, caching, placeholders
   - [08-security-permissions-quotas](02-architecture/08-security-permissions-quotas.md) — auth flows, authorization matrix, quotas, free-plan budget, CSP
   - [09-frontend-architecture](02-architecture/09-frontend-architecture.md) — Angular layout, stores, routing, PWA, theming
   - [10-backend-architecture](02-architecture/10-backend-architecture.md) — Worker, Durable Objects, D1, dev/deploy
   - [11-testing-strategy](02-architecture/11-testing-strategy.md) — test pyramid, golden fixtures, gates
4. [03-roadmap/](03-roadmap/) — [phases](03-roadmap/phases.md) (what each phase ships)
   and [phase-1-solo-builder](03-roadmap/phase-1-solo-builder.md) (detailed scope and
   acceptance criteria for the first product).
5. [04-reference/](04-reference/) — verified facts with dates:
   [pinned-versions](04-reference/pinned-versions.md),
   [platform-research](04-reference/platform-research.md),
   [hosting-research](04-reference/hosting-research.md),
   [srd-content-and-licensing](04-reference/srd-content-and-licensing.md),
   [tams-conventions](04-reference/tams-conventions.md),
   [legal-attribution](04-reference/legal-attribution.md),
   [glossary](04-reference/glossary.md),
   [open-questions](04-reference/open-questions.md).

## The design in five sentences

Every device keeps a full local copy of the character and campaign **event streams** and
works offline; the canonical streams live in Cloudflare **Durable Objects** (or, with the
same code behind runtime ports, in a self-hosted Node process on a Windows PC), which
assign sequence numbers and fan events out — the DM is a role, not a server. A character is an
**append-only log of decisions** replayed through a data-driven **rules engine** whose
only knowledge of 5e comes from **JSON content packs** written in a declarative effect
vocabulary — the SRD itself is such a pack, which is why a 2014 pack can be added later.
Images are **never stored server-side**; they move device-to-device through the DO in
memory and are cached locally. Identity is **username + password + recovery codes** with
browser-side key derivation and no personal data. The UI is an Angular 22 PWA with
runtime i18n (EN/RU/UK), a token-based SCSS design system, and a fantasy skin planned as
a theme rather than a rewrite.

## Phase 5 slice 1: frontend redesign (plan 17, executed 2026-11-15)

The Library and builder PWA was redesigned design-first: Stage A (concept "Tavern Table", 119
boards, a design system) was approved on 2026-11-03, then Stage B rebuilt the presentation in 16
tasks with no change to events, reducers, schemas or the API. What it shipped is described in
[09-frontend-architecture](02-architecture/09-frontend-architecture.md) (the `ui/` library, shell,
action strap, tab bar, navigation history, themes and textures, deviations) and
[06-i18n](02-architecture/06-i18n.md) (hints, key check, text fit). The owner-flags are the "Phase 5
follow-ups" list in [03-roadmap/phases](03-roadmap/phases.md). The real-device pass is
[manual-device-checklist](manual-device-checklist.md).

Gate numbers from the final B16b run (branch `worktree-phase-5-plan17-redesign`):

| Gate                                                | Result                                                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter web lint` (incl. the i18n key check) | pass                                                                                                                                                 |
| `pnpm --filter web test --watch=false`              | 241 files / 3422 tests                                                                                                                               |
| `pnpm --filter web build`                           | initial bundle 371.2 kB gzip of 600 (the corrected gate, which follows static imports; B15b measured 371.3, the earlier 368.4 was not like-for-like) |
| root `pnpm typecheck`                               | pass                                                                                                                                                 |
| root `pnpm vitest run`                              | 147 files / 2250 tests                                                                                                                               |
| `pnpm --filter web e2e`                             | 66 / 66 (includes 51 per-theme axe scans: 17 x tavern, scroll, plain)                                                                                |
| `pnpm --filter web e2e:sync`                        | 10 / 10                                                                                                                                              |
| `pnpm --filter web e2e:textfit`                     | 9 passed, 1 skipped (`strap.spec` on the `desktop-1280` project)                                                                                     |
| `pnpm --filter web e2e:mobile`                      | 12 / 12                                                                                                                                              |

Baselines at plan start were root 145 / 2102, web 147 / 1749, offline e2e 31 / 31, sync 8 / 8 and
344.8 kB gzip under the old gate. The whole `pnpm check` hangs in the Windows worktree, so the
pieces above ran one by one. No flaky spec fired in this run.

## Conventions for these docs

- Dates are absolute (`2026-08-29`), never "today".
- Any version or platform limit carries the date it was checked and its source.
- ADRs are superseded, not edited. Architecture docs are living and updated with code.
- "Unverified" means exactly that; see `04-reference/open-questions.md`.

## What happens next

1. Owner decisions 1–9 in `04-reference/open-questions.md` are resolved (2026-08-30);
   the "facts to verify" list is checked at the phase that needs each item.
2. A planning session produces the Phase 1a task-level implementation plan.
3. The first implementation session scaffolds the monorepo and creates `CLAUDE.md`
   (deliberately not created during planning).
