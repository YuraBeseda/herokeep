# ADR-005 — Stack: TypeScript everywhere; Angular + Hono on Cloudflare Workers

**Status:** Approved 2026-08-30. Depends on ADR-001, ADR-006. Versions pinned in
`04-reference/pinned-versions.md` (checked 2026-08-29).

## Context

The owner's default is .NET backend, Angular frontend, GraphQL where it fits, .NET Aspire
for orchestration — the work stack (reference project: TAMS, surveyed in
`04-reference/tams-conventions.md`). The owner gave full decision authority on the stack
and asked for a plain statement if GraphQL is wrong for live session state.

With ADR-001 the "backend" is: authentication, a per-user metadata table, and Durable
Objects that store and fan out event streams. The rules engine runs in the browser.

## Options considered

### Backend

| Option | Assessment |
|--------|-----------|
| **.NET on a free host** | Every free host with long-lived WebSockets is either gone (Fly.io), sleeps after 15 min with ~1 min cold starts (Render), needs a credit card and reclaims idle VMs (Oracle), or is hard to fit in a monthly CPU grant (Cloud Run/Azure Container Apps). The .NET runtime's cold start on those is 5–10 s. Viable but with real operational drag for a hobby project. |
| **Node/Bun relay on a free host** | Same hosting problems. |
| **Cloudflare Workers + Durable Objects + D1 (chosen)** | Free plan covers all of it with no sleep, no cold start worth mentioning, global edge, WebSocket hibernation, SQLite per object, and a first-class local emulator (`wrangler dev`). The runtime is JavaScript/TypeScript only. |

### Frontend

| Option | Assessment |
|--------|-----------|
| **Angular 22 (chosen)** | The owner's daily tool; modern Angular is zoneless, signals-first, standalone by default, ships Vitest as the test runner, has a maintained service-worker/PWA package and the CDK (overlay, drag-drop, a11y, virtual scroll) which is exactly what a game-like UI needs without a visual component library. |
| React / Solid / Svelte | Smaller bundles, fine PWAs, but the productivity loss for the one developer outweighs it. No feature in this plan needs them. |

### API style

- **GraphQL**: wrong tool here, plainly. There is no server-side object graph to query; the
  data is an ordered stream of events per character/campaign, read as "everything after
  N" and written as "append these". Subscriptions over GraphQL would re-implement the
  WebSocket protocol with an extra layer. The only request/response endpoints (login,
  list my characters, create campaign, join by code) are a dozen trivial JSON routes.
- **REST + WebSocket (chosen)**: Hono routes for the dozen endpoints; one WebSocket per
  context for streams.

### Orchestration

- **.NET Aspire**: nothing to orchestrate. One `pnpm dev` runs `ng serve` and
  `wrangler dev` concurrently; `wrangler dev` emulates Workers, DOs and D1 locally.

### State management

- No NgRx. Signals-based stores per domain, as in TAMS. Event streams + a pure engine make
  a reducer library redundant: the event log *is* the store.

### Styling

- **SCSS** (owner preference) with **runtime CSS custom properties** for theming (TAMS
  pattern). No Tailwind (owner's choice; can be added at any time since it is additive).
- No Angular Material (looks like an admin panel) and no Kendo (commercial). Angular CDK
  for behavior; our own components for looks.

## Decision

TypeScript everywhere, one pnpm monorepo:

```
herokeep/
  apps/
    web/            Angular 22 PWA
    api/            Hono backend core + runtime adapters: Cloudflare (Workers/DO/D1) and Node (ws/SQLite) — ADR-014
  packages/
    engine/         pure TS: content index, formulas, effects, reducer, derive, i18n localizer
    protocol/       shared Zod schemas + TS types: events, messages, pack format, bundles
    content/        SRD 5.2.1 core pack + build script from open5e JSON; sample translations
    pack-tools/     CLI: validate/pack/unpack/diff packs; translation extraction
    ui-tokens/      design tokens (SCSS + JSON) shared by web and docs
  docs/             this documentation
```

Key libraries (exact versions in the reference doc): Angular 22.1 + CDK; Transloco 8 with
messageformat; Dexie 4; Zod 4 (+ `z.toJSONSchema()` for the published pack schema); fflate;
Hono 4; Vitest 4 (+ `@cloudflare/vitest-pool-workers` for DO/D1 tests); Playwright;
ESLint 10 flat config + angular-eslint + Prettier; TypeScript **6.0.x** (Angular 22.1 does
not accept TS 7 yet); Node 24 LTS; pnpm 11.

## Inherited from TAMS (see `04-reference/tams-conventions.md`)

Zoneless, signals, `inject()`, no constructor injection, native control flow; the
`views/` + `components/` ownership rule ("second consumer → `shared/`"); co-located
component files; one non-throwing `ApiResult<T>` API service; runtime CSS-variable
theming with a written CSS style guide; strict tsconfig; ESLint flat config with template
accessibility rules; Prettier 120/singleQuote; Conventional Commits with a scope; a
`SKILL.md` per shared component as its API reference.

Deliberately **not** inherited: Kendo; the "comment above every element" template rule;
the zero-automated-tests policy; deep relative imports (TS path aliases `@hk/*` instead);
CSS-only (we use SCSS).

## Consequences

- Nothing in this project is C#. The owner's .NET expertise is not used; the Angular
  expertise is used fully; the engine is framework-free TypeScript that also runs in
  Node for tooling and tests.
- The backend core is written against runtime ports; a Node + SQLite adapter for
  self-hosting on a Windows PC is built and conformance-tested alongside the Cloudflare
  adapter (ADR-014), so leaving Cloudflare is a hostname change plus a data export/import.
- Every developer machine needs only Node 24, pnpm 11, and a Cloudflare account for
  deploys; `wrangler dev` needs no account.

## Open points

- Angular's signal-based forms are marked stable in 22.0 but the guide still recommends
  reactive forms for "production stability guarantees". Decision: **reactive forms** for
  the creation wizard in Phase 1; revisit at Phase 4.
- TypeScript 7 (native port) will be adopted when Angular's compiler accepts it.
