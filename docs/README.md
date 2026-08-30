# Herokeep — planning documentation

*Working title. Planning baseline approved 2026-08-30. No application code exists yet;
the next session writes the Phase 1a implementation plan.*

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
