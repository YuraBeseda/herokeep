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
- Inside a package import with `.ts` extensions (`./x.ts`); across packages import `@hk/<name>`.
- Tests in `test/`, fixtures in `test/fixtures/`. Run one package: `pnpm vitest run --project protocol`.

## Commands

`pnpm install` · `pnpm check` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm --filter @hk/protocol build:schema` (after any schema change; CI fails on drift) · `node packages/pack-tools/dist/cli.js validate <pack> --packs <dir>` · `pnpm --filter @hk/content build:pack — regenerate the SRD pack (never edit dist output by hand; fix transforms/overlays instead)`
