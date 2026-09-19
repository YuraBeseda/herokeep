# Herokeep — working notes for AI assistants

Read `docs/README.md` first; decisions live in `docs/01-decisions/` (ADRs are never edited, only superseded).

## Non-negotiable rules

1. Game rules are data (JSON packs, `docs/02-architecture/04-content-packs.md`). Never encode a 5e rule in TypeScript.
2. i18n is structural: no user-visible string literals; content text goes through the engine Localizer.
3. Events are immutable; reducers stay backward-compatible forever.
4. `packages/engine/src` is deterministic (no Date.now / Math.random / locale string ops) — lint enforces it.
5. TDD: failing test first. Every task ends with a commit. Conventional Commits with a scope: `feat(engine): …`.

## Layout

- `packages/protocol` — Zod schemas + types (the contract). `packages/engine` — pure functions. `packages/pack-tools` — CLI.
- `apps/web` — the Library + character builder PWA (Angular 22 zoneless); the character builder/sheet views live under `apps/web/src/app/views/characters`. `packages/ui-tokens` — design tokens (`tokens.css`/`tokens.scss`) built from one typed source, consumed by `apps/web`.
- `apps/api` — the sync backend (accounts, auth, per-character event streams) behind runtime ports (`apps/api/src/ports`), with two adapters: Cloudflare (`src/adapters/cloudflare`, Workers + Durable Objects + D1, primary) and Node (`src/adapters/node`, `@hono/node-server` + `ws` + `better-sqlite3`, for local dev and self-hosting — see `docs/self-hosting-windows.md`). Core logic lives under `src/core`, adapter-agnostic; `test/conformance/` runs the same scenarios against both adapters.
- Inside a package import with `.ts` extensions (`./x.ts`); across packages import `@hk/<name>`.
- Tests in `test/`, fixtures in `test/fixtures/`. Run one package: `pnpm vitest run --project protocol`.

## Commands

`pnpm install` · `pnpm check` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm --filter @hk/protocol build:schema` (after any schema change; CI fails on drift) · `node packages/pack-tools/dist/cli.js validate <pack> --packs <dir>` · `pnpm --filter @hk/content build:pack` (regenerate the SRD pack; never edit dist output by hand — fix transforms/overlays instead) · `pnpm --filter web test|build|e2e` (Angular unit tests — add `--watch=false` for a single non-interactive run; production build with the gzip bundle-budget gate; Playwright e2e against the built app) · `pnpm dev` (root: Node adapter + `ng serve` together) · `pnpm --filter api dev:node|dev:cf` (Node adapter alone, or `wrangler dev` for Cloudflare) · `pnpm --filter api test:cloudflare` (Cloudflare-adapter suite, separate from `apps/api`'s default `vitest run`) · `pnpm --filter api seed` (test user + sample character against the Node adapter) · `pnpm --filter api admin -- <command>` (`herokeep-admin` export/import/reset-recovery, `--help` for usage)
