# Herokeep

5E-compatible character builder and in-play companion. Local-first PWA; rules are data.

- Planning and architecture: [`docs/README.md`](docs/README.md)
- Requirements: Node 24, pnpm 11 (`corepack enable`)
- Commands: `pnpm install` · `pnpm check` (format + lint + typecheck + test) · `pnpm build`

Licenses: code MIT (`LICENSE`), project content packs CC-BY-4.0 (`LICENSE-CONTENT`).

## Pack tools

`pnpm build && node packages/pack-tools/dist/cli.js <command>` — `validate`, `build`, `diff`, `i18n extract` (see `docs/02-architecture/04-content-packs.md`).

Content: `pnpm --filter @hk/content build:pack` generates the SRD 5.2.1 core pack from the vendored open5e snapshot (see `packages/content/upstream/open5e-srd-2024/SOURCE.md`).

## Plans

Implementation plans live in `docs/superpowers/plans/`; the current one is `2026-08-30-phase-1a-srd-content-import.md`.
