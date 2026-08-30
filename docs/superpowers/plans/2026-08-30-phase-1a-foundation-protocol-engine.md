# Phase 1a (plan 1 of 3) — Foundation, `@hk/protocol`, `@hk/engine` core, `@hk/pack-tools` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Herokeep monorepo and deliver the runtime-agnostic core that every later phase builds on: the pack format as executable Zod schemas with a published JSON Schema, the engine's content index / formula / predicate / effects-registry / localizer / search modules, a reducer skeleton with a golden-test harness, and a `pack-tools` CLI that validates, builds, diffs and extracts translations from packs.

**Architecture:** Three pure-TypeScript workspace packages with no framework code: `@hk/protocol` (schemas + types, the contract), `@hk/engine` (deterministic pure functions over protocol types), `@hk/pack-tools` (Node CLI over both). Everything is data-driven — no rule of 5e is written in TypeScript; this plan builds the machinery, plan 2 feeds it the SRD, plan 3 puts a UI on it.

**Tech Stack:** Node 24 LTS, pnpm 11 workspaces + catalog, TypeScript 6.0.x (NodeNext, `.ts` import extensions with `rewriteRelativeImportExtensions`), Zod 4, Vitest 4 (projects), ESLint 10 flat config + typescript-eslint 8 (typed linting via `projectService`), Prettier 3, `semver`, `yaml`. No other runtime dependencies.

**Spec:** `docs/03-roadmap/phase-1-solo-builder.md` (section "1a — Library", deliverables 1–3 and 5), implementing `docs/02-architecture/04-content-packs.md`, `docs/02-architecture/05-rules-engine.md` (content/formula/predicate/effects/i18n modules), `docs/02-architecture/02-domain-model-and-events.md` (envelope + first three character events), `docs/01-decisions/ADR-005-stack.md`, `ADR-008`, `ADR-013`. Plans 2 (SRD import) and 3 (Angular Library PWA) follow.

## Global Constraints

- Node `>=24.15.0 <25`; pnpm `11.x` (pin via `"packageManager": "pnpm@11.24.0"`); TypeScript `~6.0.3` (**not** 7.x — Angular 22.1 requires 6.0.x); Vitest `^4.1.11` (**not** 5 RC); Zod `^4.5.4`; ESLint `^10`; typescript-eslint `^8.62.1`; Prettier `^3.9.6`. Versions were checked 2026-08-29 (`docs/04-reference/pinned-versions.md`).
- Package scope `@hk/*`; repository name `herokeep`; all packages `"type": "module"`.
- Relative imports inside packages use explicit `.ts` extensions (`import { x } from './x.ts'`); cross-package imports use the package name (`@hk/protocol`).
- Entity id format: `<packId>:<type>/<slug>` — `packId` matches `^[a-z0-9][a-z0-9-]{2,63}$`, `slug` matches `^[a-z0-9][a-z0-9-]*$`.
- Pack limits (`docs/02-architecture/04-content-packs.md`): `format: 1`; pack JSON ≤ 5 MB; ≤ 5,000 entities; description ≤ 20 KB; dependency depth ≤ 4; cycles rejected; a pack defines entities only in its own namespace; overrides only via `overrides[]`.
- Formula grammar: length ≤ 256, nesting depth ≤ 16, identifiers restricted to `level prof classLevel mod score hitDie resource max min floor ceil abs`; integer division rounds down; comparisons only in predicate formulas. Never `eval`.
- Engine determinism: no `Date.now()`, `Math.random()`, locale-dependent string ops, or object-key-order dependence in `packages/engine/src` (enforced by ESLint `no-restricted-properties`).
- English is the source language; the engine's localizer falls back per field to English.
- Prettier: `printWidth 120`, `singleQuote`, `trailingComma: all`. ESLint flat config with typed linting. Conventional Commits with a scope (`feat(protocol): …`).
- Licenses: `LICENSE` = MIT (code), `LICENSE-CONTENT` = CC-BY-4.0 (project content packs).
- TDD: every task writes the failing test first; every task ends with a commit.

## File structure (what this plan creates)

```
herokeep/
  package.json                      workspace root: scripts, devDependencies via catalog
  pnpm-workspace.yaml               packages globs + catalog (single source of versions)
  .npmrc                            strict settings
  tsconfig.base.json                shared compilerOptions (NodeNext, strict, .ts imports)
  tsconfig.json                     root: references to every package's tsconfig.build.json
  vitest.config.ts                  test.projects = packages/*
  eslint.config.js                  flat config, typed linting, engine determinism rule
  .prettierrc.json  .editorconfig  .gitignore  .gitattributes
  LICENSE  LICENSE-CONTENT  README.md  CLAUDE.md
  .github/workflows/ci.yml
  packages/
    protocol/
      package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
      src/index.ts                  barrel
      src/ids.ts                    entity id regex, parseEntityId, EntityIdSchema
      src/pack/enums.ts             EntityTypeSchema, AbilitySchema, EffectTypes list…
      src/pack/formula.ts           FormulaSchema (length/charset only; syntax is engine's job)
      src/pack/predicate.ts         recursive PredicateSchema
      src/pack/effects.ts           EffectSchema discriminated union (39 v1 types)
      src/pack/choice.ts            ChoiceSchema + pick forms
      src/pack/entity.ts            EntityBase + per-type schemas + EntitySchema union
      src/pack/pack.ts              PackSchema, DependencySchema, OverrideSchema, AssetSchema, PACK_LIMITS
      src/pack/json-schema.ts       toPackJsonSchema()
      src/events/envelope.ts        EventEnvelopeSchema, EVENT_ACTORS
      src/events/character.ts       payload schemas: character.created, pack.pinned, decision.made
      scripts/build-schema.ts       writes schema/pack-v1.json
      schema/pack-v1.json           generated, committed
      test/**/*.test.ts, test/fixtures/*.json
    engine/
      package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
      src/index.ts
      src/diagnostics.ts            Diagnostic type + helpers
      src/formula/lexer.ts  parser.ts  evaluate.ts  validate.ts
      src/predicate/evaluate.ts
      src/effects/registry.ts
      src/content/deps.ts           dependency closure (semver), cycles, depth
      src/content/patch.ts          minimal JSON Patch (add/replace/remove) + JSON Pointer
      src/content/index.ts          createContentIndex
      src/content/validate.ts       validatePack (semantic)
      src/i18n/normalize.ts  localizer.ts  search.ts
      src/reduce/facts.ts  reducer.ts
      test/**/*.test.ts, test/golden/*.json, test/golden.test.ts, test/fixtures/packs/*
    pack-tools/
      package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
      src/cli.ts                    argv → command, exit codes
      src/commands/validate.ts  build.ts  diff.ts  i18n-extract.ts
      src/io.ts                     read/write JSON & YAML, walk dirs
      test/**/*.test.ts, test/fixtures/**
```

---

### Task 1: Monorepo toolchain (workspace, TS, Vitest, ESLint, Prettier, CI, licenses)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.editorconfig`, `.gitignore`, `.gitattributes`, `LICENSE`, `LICENSE-CONTENT`, `README.md`, `CLAUDE.md`, `.github/workflows/ci.yml`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/tsconfig.build.json`, `packages/protocol/vitest.config.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/smoke.test.ts`

**Interfaces:**
- Produces: the workspace conventions every later task assumes — `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; package layout `src/` + `test/`; `.ts` import extensions.

- [ ] **Step 1: Initialise git and the workspace files**

Run in `D:\Projects\Programming\Personal\DndHeroCreator` (the repo root is the existing project folder; `docs/` already exists):

```bash
git init -b main
node --version   # must print v24.x
corepack enable  # provides pnpm at the version pinned in package.json
```

Create `package.json`:

```json
{
  "name": "herokeep",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.24.0",
  "engines": { "node": ">=24.15.0 <25" },
  "scripts": {
    "build": "tsc -b tsconfig.json",
    "typecheck": "pnpm -r --parallel run typecheck",
    "lint": "eslint .",
    "format": "prettier --check .",
    "format:fix": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "pnpm format && pnpm lint && pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@eslint/js": "catalog:",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "prettier": "catalog:",
    "typescript": "catalog:",
    "typescript-eslint": "catalog:",
    "vitest": "catalog:"
  }
}
```

Create `pnpm-workspace.yaml` (the single place versions live; `docs/04-reference/pinned-versions.md` is the source):

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

catalog:
  '@eslint/js': ^10.0.0
  '@types/node': ^24.0.0
  '@types/semver': ^7.7.0
  eslint: ^10.0.0
  prettier: ^3.9.6
  semver: ^7.7.0
  typescript: ~6.0.3
  typescript-eslint: ^8.62.1
  vitest: ^4.1.11
  yaml: ^2.8.0
  zod: ^4.5.4
```

`semver`, `yaml`, `@types/semver`, `@types/node` and `@eslint/js` were **not** version-checked during planning. Before the first install run `pnpm view semver version`, `pnpm view yaml version`, `pnpm view @types/node version`, `pnpm view @eslint/js version` and correct the catalog ranges to the current majors if they differ; commit the lockfile with whatever resolves.

Create `.npmrc`:

```
strict-peer-dependencies=false
auto-install-peers=true
save-exact=false
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  }
}
```

Create root `tsconfig.json` (build orchestration only):

```json
{
  "files": [],
  "references": [{ "path": "packages/protocol/tsconfig.build.json" }]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
```

Create `eslint.config.js`:

```js
// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/schema/*.json']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Engine determinism contract (docs/02-architecture/05-rules-engine.md)
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/dice/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Engine code must be deterministic.' },
        { object: 'Math', property: 'random', message: 'Engine code must be deterministic; use dice/ with injectable RNG.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Engine code must be deterministic.' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
  },
]);
```

Create `.prettierrc.json`:

```json
{ "printWidth": 120, "singleQuote": true, "trailingComma": "all", "endOfLine": "lf" }
```

Create `.editorconfig`:

```
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```

Create `.gitignore`:

```
node_modules/
dist/
coverage/
*.tsbuildinfo
.DS_Store
Thumbs.db
.env
.env.*
!.env.example
```

Create `.gitattributes`:

```
* text=auto eol=lf
*.png binary
*.jpg binary
*.webp binary
```

Create `LICENSE` with the MIT text (copyright line: `Copyright (c) 2026 Herokeep contributors`) and `LICENSE-CONTENT` containing:

```
The content packs authored by this project (packages/content/src/packs/** and any file
declaring "license": "CC-BY-4.0") are licensed under the Creative Commons Attribution 4.0
International License: https://creativecommons.org/licenses/by/4.0/legalcode

They include material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of
the Coast LLC, available at https://www.dndbeyond.com/srd, licensed under the same license.
Source code is licensed separately under the MIT License (see LICENSE).
```

Create `README.md`:

```markdown
# Herokeep

5E-compatible character builder and in-play companion. Local-first PWA; rules are data.

- Planning and architecture: [`docs/README.md`](docs/README.md)
- Requirements: Node 24, pnpm 11 (`corepack enable`)
- Commands: `pnpm install` · `pnpm check` (format + lint + typecheck + test) · `pnpm build`

Licenses: code MIT (`LICENSE`), project content packs CC-BY-4.0 (`LICENSE-CONTENT`).
```

Create `CLAUDE.md`:

```markdown
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
`pnpm install` · `pnpm check` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build`
```

- [ ] **Step 2: Create the first package skeleton (`@hk/protocol`) with a smoke test**

`packages/protocol/package.json`:

```json
{
  "name": "@hk/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist", "schema"],
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "tsc -b tsconfig.build.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "catalog:" }
}
```

`packages/protocol/tsconfig.json` (type-check src + tests; no emit):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "rootDir": "." },
  "include": ["src", "test", "scripts", "vitest.config.ts"]
}
```

`packages/protocol/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "rootDir": "src", "outDir": "dist", "tsBuildInfoFile": "dist/.tsbuildinfo" },
  "include": ["src"]
}
```

`packages/protocol/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'protocol', include: ['test/**/*.test.ts'], environment: 'node' },
});
```

`packages/protocol/src/index.ts`:

```ts
export const PROTOCOL_VERSION = 1 as const;
```

- [ ] **Step 3: Write the failing smoke test**

`packages/protocol/test/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index.ts';

describe('workspace smoke', () => {
  it('imports the package source with a .ts extension', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
```

- [ ] **Step 4: Install and run every root script**

```bash
pnpm install
pnpm test          # expected: 1 passed (project "protocol")
pnpm typecheck     # expected: no errors
pnpm lint          # expected: no errors
pnpm format:fix && pnpm format
pnpm build         # expected: packages/protocol/dist/index.js and index.d.ts exist
```

If `pnpm lint` fails with "parserOptions.projectService ... file not included", the offending file is outside `packages/protocol/tsconfig.json`'s `include` — add the path there, never `allowDefaultProject`.

- [ ] **Step 5: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm test
```

`pnpm/action-setup@v4` reads the version from `packageManager`. If the action's current major differs at execution time, use the current one (check https://github.com/pnpm/action-setup).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(repo): bootstrap pnpm workspace, TypeScript 6, Vitest 4, ESLint 10, CI"
```

### Task 2: Entity identifiers (`@hk/protocol`)

**Files:**
- Create: `packages/protocol/src/ids.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/ids.test.ts`

**Interfaces:**
- Produces: `ENTITY_TYPES` (readonly tuple), `EntityType`, `PACK_ID_RE`, `SLUG_RE`, `ENTITY_ID_RE`, `parseEntityId(id: string): ParsedEntityId | null`, `isEntityId(id: string): boolean`, `makeEntityId(packId: string, type: EntityType, slug: string): string`, Zod schemas `PackIdSchema`, `SlugSchema`, `EntityTypeSchema`, `EntityIdSchema`, and `ParsedEntityId = { packId: string; type: EntityType; slug: string }`.

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EntityIdSchema, isEntityId, makeEntityId, parseEntityId } from '../src/ids.ts';

describe('entity ids', () => {
  it('parses a well-formed id', () => {
    expect(parseEntityId('srd-5e-2024:spell/fireball')).toEqual({
      packId: 'srd-5e-2024',
      type: 'spell',
      slug: 'fireball',
    });
  });

  it.each([
    ['Srd:spell/fireball', 'uppercase pack id'],
    ['ab:spell/fireball', 'pack id shorter than 3'],
    ['srd-5e-2024:spell', 'missing slug'],
    ['srd-5e-2024:dragon/fireball', 'unknown type'],
    ['srd-5e-2024:spell/-fireball', 'slug starting with dash'],
    ['srd-5e-2024:spell/Fire Ball', 'spaces'],
    ['', 'empty'],
  ])('rejects %s (%s)', (id) => {
    expect(parseEntityId(id)).toBeNull();
    expect(isEntityId(id)).toBe(false);
    expect(EntityIdSchema.safeParse(id).success).toBe(false);
  });

  it('round-trips through makeEntityId', () => {
    const id = makeEntityId('ivan-homebrew', 'species', 'catfolk');
    expect(id).toBe('ivan-homebrew:species/catfolk');
    expect(EntityIdSchema.parse(id)).toBe(id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project protocol`
Expected: FAIL — `Cannot find module '../src/ids.ts'`.

- [ ] **Step 3: Implement**

`packages/protocol/src/ids.ts`:

```ts
import { z } from 'zod';

export const ENTITY_TYPES = [
  'system',
  'species',
  'background',
  'class',
  'subclass',
  'feature',
  'feat',
  'spell',
  'item',
  'condition',
  'skill',
  'ability',
  'language',
  'tool',
  'rule',
  'table',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const ENTITY_ID_RE = /^([a-z0-9][a-z0-9-]{2,63}):([a-z]+)\/([a-z0-9][a-z0-9-]*)$/;

export interface ParsedEntityId {
  packId: string;
  type: EntityType;
  slug: string;
}

const ENTITY_TYPE_SET: ReadonlySet<string> = new Set(ENTITY_TYPES);

export function parseEntityId(id: string): ParsedEntityId | null {
  const m = ENTITY_ID_RE.exec(id);
  if (!m) return null;
  const [, packId, type, slug] = m;
  if (packId === undefined || type === undefined || slug === undefined) return null;
  if (!ENTITY_TYPE_SET.has(type)) return null;
  return { packId, type: type as EntityType, slug };
}

export function isEntityId(id: string): boolean {
  return parseEntityId(id) !== null;
}

export function makeEntityId(packId: string, type: EntityType, slug: string): string {
  return `${packId}:${type}/${slug}`;
}

export const PackIdSchema = z.string().regex(PACK_ID_RE, 'Pack id must match ^[a-z0-9][a-z0-9-]{2,63}$');
export const SlugSchema = z.string().regex(SLUG_RE, 'Slug must match ^[a-z0-9][a-z0-9-]*$');
export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export const EntityIdSchema = z
  .string()
  .refine((s) => parseEntityId(s) !== null, { message: 'Expected an entity id of the form <packId>:<type>/<slug>' });
```

Replace `packages/protocol/src/index.ts` with:

```ts
export const PROTOCOL_VERSION = 1 as const;
export * from './ids.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project protocol` → all pass. Run `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): entity id grammar, parser and schemas"
```

---

### Task 3: Formula-string schema and recursive predicate schema (`@hk/protocol`)

**Files:**
- Create: `packages/protocol/src/pack/formula.ts`, `packages/protocol/src/pack/predicate.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/predicate.test.ts`

**Interfaces:**
- Produces: `FORMULA_MAX_LENGTH = 256`, `FormulaSchema` (string; charset + length only — syntax is validated by the engine in Task 13), `Formula`; `ComparisonSchema` (`{gte?, lte?, gt?, lt?, eq?}` integers, at least one), `Comparison`; `ClassRefSchema` (a class slug or a full entity id); `PredicateSchema`, `Predicate` with the forms listed in `docs/02-architecture/04-content-packs.md` § Predicates.

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/predicate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FormulaSchema } from '../src/pack/formula.ts';
import { PredicateSchema } from '../src/pack/predicate.ts';

describe('FormulaSchema', () => {
  it('accepts grammar characters and rejects others', () => {
    expect(FormulaSchema.safeParse('10 + mod(dex) + mod(con)').success).toBe(true);
    expect(FormulaSchema.safeParse('floor(level / 2) >= 3').success).toBe(true);
    expect(FormulaSchema.safeParse('mod(dex); drop').success).toBe(false);
    expect(FormulaSchema.safeParse('x'.repeat(257)).success).toBe(false);
    expect(FormulaSchema.safeParse('').success).toBe(false);
  });
});

describe('PredicateSchema', () => {
  it('accepts every documented form', () => {
    const forms = [
      { ability: { str: { gte: 13 } } },
      { level: { gte: 4 } },
      { classLevel: { wizard: { gte: 3 } } },
      { classLevel: { 'ivan-homebrew:class/warden': { gte: 1 } } },
      { hasFeature: 'srd-5e-2024:feature/second-wind' },
      { hasFeat: 'srd-5e-2024:feat/alert' },
      { hasSpell: 'srd-5e-2024:spell/fireball' },
      { tag: 'unarmored' },
      { proficient: { kind: 'armor', target: 'heavy' } },
      { armor: { category: ['none', 'light'] } },
      { shield: false },
      { species: 'srd-5e-2024:species/elf' },
      { class: 'srd-5e-2024:class/fighter' },
      { subclass: 'srd-5e-2024:subclass/champion' },
      { condition: 'srd-5e-2024:condition/prone' },
      { spellcaster: true },
      { formula: 'mod(dex) >= 2' },
      { all: [{ level: { gte: 4 } }, { not: { shield: true } }] },
      { any: [{ class: 'srd-5e-2024:class/fighter' }, { tag: 'martial' }] },
    ];
    for (const form of forms) {
      const r = PredicateSchema.safeParse(form);
      expect(r.success, JSON.stringify(form)).toBe(true);
    }
  });

  it('rejects unknown keys, empty groups and extra keys', () => {
    expect(PredicateSchema.safeParse({ levell: { gte: 1 } }).success).toBe(false);
    expect(PredicateSchema.safeParse({ all: [] }).success).toBe(false);
    expect(PredicateSchema.safeParse({ level: {} }).success).toBe(false);
    expect(PredicateSchema.safeParse({ level: { gte: 1 }, tag: 'x' }).success).toBe(false);
    expect(PredicateSchema.safeParse({ ability: { strength: { gte: 13 } } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project protocol` → FAIL (modules not found).

- [ ] **Step 3: Implement**

`packages/protocol/src/pack/formula.ts`:

```ts
import { z } from 'zod';

export const FORMULA_MAX_LENGTH = 256;

/** Charset + length only. Syntax and identifier whitelist are checked by @hk/engine validateFormula(). */
export const FormulaSchema = z
  .string()
  .min(1)
  .max(FORMULA_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_+\-*/().,<>=!\s]+$/, 'Formula contains characters outside the grammar');
export type Formula = z.infer<typeof FormulaSchema>;
```

`packages/protocol/src/pack/predicate.ts`:

```ts
import { z } from 'zod';
import { EntityIdSchema, SLUG_RE, isEntityId } from '../ids.ts';
import { FormulaSchema } from './formula.ts';

export const ComparisonSchema = z
  .strictObject({
    gte: z.int().optional(),
    lte: z.int().optional(),
    gt: z.int().optional(),
    lt: z.int().optional(),
    eq: z.int().optional(),
  })
  .refine((c) => Object.keys(c).length > 0, { message: 'Comparison needs at least one of gte/lte/gt/lt/eq' });
export type Comparison = z.infer<typeof ComparisonSchema>;

/** Ability keys are lowercase 3-letter ids (str, dex, con, int, wis, cha) declared by the system entity. */
export const AbilityKeySchema = z.string().regex(/^[a-z]{3}$/);

/** A class slug (resolved against the core pack) or a full entity id. */
export const ClassRefSchema = z
  .string()
  .refine((s) => SLUG_RE.test(s) || isEntityId(s), { message: 'Expected a class slug or entity id' });

export const ProficiencyKindSchema = z.enum(['skill', 'save', 'armor', 'weapon', 'tool', 'language']);
export const ArmorCategorySchema = z.enum(['none', 'light', 'medium', 'heavy']);

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { ability: Record<string, Comparison> }
  | { level: Comparison }
  | { classLevel: Record<string, Comparison> }
  | { hasFeature: string }
  | { hasFeat: string }
  | { hasSpell: string }
  | { tag: string }
  | { proficient: { kind: z.infer<typeof ProficiencyKindSchema>; target: string } }
  | { armor: { category: z.infer<typeof ArmorCategorySchema>[] } }
  | { shield: boolean }
  | { species: string }
  | { class: string }
  | { subclass: string }
  | { condition: string }
  | { spellcaster: boolean }
  | { formula: string };

export const PredicateSchema: z.ZodType<Predicate> = z.union([
  z.strictObject({
    get all() {
      return z.array(PredicateSchema).min(1);
    },
  }),
  z.strictObject({
    get any() {
      return z.array(PredicateSchema).min(1);
    },
  }),
  z.strictObject({
    get not() {
      return PredicateSchema;
    },
  }),
  z.strictObject({ ability: z.record(AbilityKeySchema, ComparisonSchema) }),
  z.strictObject({ level: ComparisonSchema }),
  z.strictObject({ classLevel: z.record(ClassRefSchema, ComparisonSchema) }),
  z.strictObject({ hasFeature: EntityIdSchema }),
  z.strictObject({ hasFeat: EntityIdSchema }),
  z.strictObject({ hasSpell: EntityIdSchema }),
  z.strictObject({ tag: z.string().min(1).max(64) }),
  z.strictObject({ proficient: z.strictObject({ kind: ProficiencyKindSchema, target: z.string().min(1).max(64) }) }),
  z.strictObject({ armor: z.strictObject({ category: z.array(ArmorCategorySchema).min(1) }) }),
  z.strictObject({ shield: z.boolean() }),
  z.strictObject({ species: EntityIdSchema }),
  z.strictObject({ class: EntityIdSchema }),
  z.strictObject({ subclass: EntityIdSchema }),
  z.strictObject({ condition: EntityIdSchema }),
  z.strictObject({ spellcaster: z.boolean() }),
  z.strictObject({ formula: FormulaSchema }),
]);
```

If TypeScript reports a circular-reference error on `PredicateSchema`, keep the explicit `z.ZodType<Predicate>` annotation (it is what breaks the cycle) and, if needed, wrap the three recursive members with `z.lazy(() => …)` instead of getters.

Add to `packages/protocol/src/index.ts`:

```ts
export * from './pack/formula.ts';
export * from './pack/predicate.ts';
```

- [ ] **Step 4: Run tests, typecheck, lint** → all green.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): formula string schema and recursive predicate schema"
```

### Task 4: Effect vocabulary schema (`@hk/protocol`)

**Files:**
- Create: `packages/protocol/src/pack/enums.ts`, `packages/protocol/src/pack/effects.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/effects.test.ts`, `packages/protocol/test/fixtures/effects-one-of-each.json`

**Interfaces:**
- Produces: `EFFECT_TYPES` (readonly tuple of the 39 v1 type strings), `EffectType`, `EffectSchema` (discriminated union on `type`), `Effect`, plus shared enums `SpeedModeSchema`, `SenseSchema`, `ResetSchema`, `ProficiencyLevelSchema`, `RollTargetSchema`, `AttackFilterSchema`, `UsesSchema`, `ValueSchema` (integer or formula).
- Consumes: `PredicateSchema`, `FormulaSchema`, `EntityIdSchema`, `SlugSchema`, `AbilityKeySchema`, `ClassRefSchema`, `ProficiencyKindSchema` (Tasks 2–3).

- [ ] **Step 1: Write the fixture and the failing tests**

`packages/protocol/test/fixtures/effects-one-of-each.json` — exactly one valid example per type (the test asserts the fixture covers `EFFECT_TYPES` completely):

```json
[
  { "type": "ability.bonus", "ability": "str", "value": 2 },
  { "type": "ability.set", "ability": "str", "value": 19 },
  { "type": "ability.max", "ability": "con", "value": 22 },
  { "type": "proficiency.grant", "kind": "skill", "target": "stealth", "level": "expertise" },
  { "type": "ac.formula", "formula": "10 + mod(dex) + mod(con)", "key": "unarmored-defense" },
  { "type": "ac.bonus", "value": 1, "key": "defense" },
  { "type": "hp.perLevel", "value": 1 },
  { "type": "hp.bonus", "value": "level" },
  { "type": "speed.set", "mode": "fly", "value": 30 },
  { "type": "speed.bonus", "mode": "walk", "value": 10 },
  { "type": "sense.grant", "sense": "darkvision", "range": 60 },
  { "type": "resource.define", "id": "second-wind", "name": "Second Wind", "max": "2", "reset": "shortRest", "display": "pips" },
  { "type": "spellcasting.define", "class": "wizard", "ability": "int", "list": "wizard", "preparation": "spellbook", "slots": "full", "ritual": true, "focus": true, "cantripsKnown": "3", "preparedCount": "max(1, level + mod(int))" },
  { "type": "spell.grant", "spell": "srd-5e-2024:spell/misty-step", "castingAbility": "cha", "uses": { "count": "1", "per": "longRest" }, "alwaysPrepared": true },
  { "type": "spell.listAdd", "class": "srd-5e-2024:class/cleric", "spells": ["srd-5e-2024:spell/bless"] },
  { "type": "damage.resistance", "types": ["fire"] },
  { "type": "damage.immunity", "types": ["poison"] },
  { "type": "damage.vulnerability", "types": ["cold"] },
  { "type": "condition.immunity", "conditions": ["srd-5e-2024:condition/poisoned"] },
  { "type": "attack.bonus", "value": 2, "filter": { "weapon": "ranged" } },
  { "type": "damage.bonus", "value": "mod(str)", "filter": { "weapon": "melee" } },
  { "type": "damage.rerollBelow", "value": 2, "filter": { "property": "two-handed" } },
  { "type": "initiative.bonus", "value": "prof" },
  { "type": "save.bonus", "value": 1, "target": "wis" },
  { "type": "skill.bonus", "value": 5, "target": "perception" },
  { "type": "check.bonus", "value": 1, "target": "int" },
  { "type": "advantage.grant", "on": "save.wis", "when": { "tag": "charmed-resistance" } },
  { "type": "disadvantage.impose", "on": "skill.stealth" },
  { "type": "action.define", "id": "action-surge", "name": "Action Surge", "kind": "free", "description": "Take one additional action.", "uses": { "count": "1", "per": "shortRest" } },
  { "type": "feature.text", "name": "Brave", "description": "You have advantage on saving throws you make to avoid or end the Frightened condition." },
  { "type": "mastery.grant", "count": "3" },
  { "type": "extraAttack.set", "count": 2 },
  { "type": "item.grant", "item": "srd-5e-2024:item/longsword", "qty": 1 },
  { "type": "currency.grant", "gp": 15 },
  { "type": "size.set", "size": "small" },
  { "type": "type.set", "creatureType": "humanoid" },
  { "type": "language.grant", "language": "srd-5e-2024:language/common" },
  { "type": "tag.grant", "tag": "unarmored" },
  { "type": "slot.bonus", "level": 1, "count": 1 }
]
```

`packages/protocol/test/effects.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EFFECT_TYPES, EffectSchema } from '../src/pack/effects.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/effects-one-of-each.json', import.meta.url), 'utf8')) as unknown[];

describe('EffectSchema', () => {
  it('accepts one example of every effect type', () => {
    for (const example of fixture) {
      const r = EffectSchema.safeParse(example);
      expect(r.success, JSON.stringify(example) + '\n' + JSON.stringify(r.error?.issues)).toBe(true);
    }
  });

  it('covers every EFFECT_TYPES entry exactly once', () => {
    const types = fixture.map((e) => (e as { type: string }).type).sort();
    expect(types).toEqual([...EFFECT_TYPES].sort());
    expect(new Set(types).size).toBe(EFFECT_TYPES.length);
  });

  it('rejects unknown types, extra keys and bad values', () => {
    expect(EffectSchema.safeParse({ type: 'ability.boost', ability: 'str', value: 2 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'ability.bonus', ability: 'str', value: 2, extra: 1 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'ability.bonus', ability: 'strength', value: 2 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'speed.set', mode: 'teleport', value: 30 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'slot.bonus', level: 10, count: 1 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'advantage.grant', on: 'everything' }).success).toBe(false);
  });

  it('applies defaults', () => {
    const r = EffectSchema.parse({ type: 'proficiency.grant', kind: 'weapon', target: 'martial' });
    expect(r).toMatchObject({ level: 'proficient' });
    const s = EffectSchema.parse({ type: 'ability.set', ability: 'str', value: 19 });
    expect(s).toMatchObject({ ifHigher: true });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run --project protocol` → FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/protocol/src/pack/enums.ts`:

```ts
import { z } from 'zod';
import { SLUG_RE } from '../ids.ts';
import { FormulaSchema } from './formula.ts';

export const SpeedModeSchema = z.enum(['walk', 'fly', 'swim', 'climb', 'burrow']);
export const SenseSchema = z.enum(['darkvision', 'blindsight', 'tremorsense', 'truesight']);
export const ResetSchema = z.enum(['shortRest', 'longRest', 'dawn', 'never']);
export const ProficiencyLevelSchema = z.enum(['proficient', 'expertise', 'half']);
export const ActionKindSchema = z.enum(['action', 'bonus', 'reaction', 'free']);
export const PreparationSchema = z.enum(['prepared', 'known', 'spellbook', 'innate']);
export const SlotProgressionSchema = z.enum(['full', 'half', 'third', 'pact', 'none']);
export const DisplaySchema = z.enum(['pips', 'number']);
/** save.<ability> | skill.<slug> | check.<ability> | attack | initiative */
export const RollTargetSchema = z
  .string()
  .regex(/^(save\.[a-z]{3}|skill\.[a-z0-9][a-z0-9-]*|check\.[a-z]{3}|attack|initiative)$/);
export const DamageTypeSchema = z.string().regex(SLUG_RE);
export const AttackFilterSchema = z.strictObject({
  weapon: z.enum(['melee', 'ranged', 'any']).optional(),
  category: z.enum(['simple', 'martial']).optional(),
  property: z.string().regex(SLUG_RE).optional(),
  spell: z.boolean().optional(),
});
export const UsesSchema = z.strictObject({ count: FormulaSchema, per: ResetSchema });
/** An integer literal or a formula string. */
export const ValueSchema = z.union([z.int(), FormulaSchema]);
export const ShortTextSchema = z.string().min(1).max(200);
export const LongTextSchema = z.string().min(1).max(20 * 1024);
```

`packages/protocol/src/pack/effects.ts`:

```ts
import { z } from 'zod';
import { EntityIdSchema, SlugSchema } from '../ids.ts';
import {
  ActionKindSchema,
  AttackFilterSchema,
  DamageTypeSchema,
  DisplaySchema,
  LongTextSchema,
  PreparationSchema,
  ProficiencyLevelSchema,
  ResetSchema,
  RollTargetSchema,
  SenseSchema,
  ShortTextSchema,
  SlotProgressionSchema,
  SpeedModeSchema,
  UsesSchema,
  ValueSchema,
} from './enums.ts';
import { FormulaSchema } from './formula.ts';
import { AbilityKeySchema, ClassRefSchema, PredicateSchema, ProficiencyKindSchema } from './predicate.ts';

export const EFFECT_TYPES = [
  'ability.bonus', 'ability.set', 'ability.max',
  'proficiency.grant',
  'ac.formula', 'ac.bonus',
  'hp.perLevel', 'hp.bonus',
  'speed.set', 'speed.bonus', 'sense.grant',
  'resource.define',
  'spellcasting.define', 'spell.grant', 'spell.listAdd',
  'damage.resistance', 'damage.immunity', 'damage.vulnerability', 'condition.immunity',
  'attack.bonus', 'damage.bonus', 'damage.rerollBelow',
  'initiative.bonus', 'save.bonus', 'skill.bonus', 'check.bonus',
  'advantage.grant', 'disadvantage.impose',
  'action.define', 'feature.text',
  'mastery.grant', 'extraAttack.set',
  'item.grant', 'currency.grant',
  'size.set', 'type.set', 'language.grant', 'tag.grant',
  'slot.bonus',
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

/** Fields every effect may carry. `key` is the stacking key (defaults to the source feature at derive time). */
const common = {
  when: PredicateSchema.optional(),
  key: z.string().min(1).max(64).optional(),
};

const eff = <T extends EffectType, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), ...common, ...shape });

export const EffectSchema = z.discriminatedUnion('type', [
  eff('ability.bonus', { ability: AbilityKeySchema, value: z.int() }),
  eff('ability.set', { ability: AbilityKeySchema, value: z.int().min(1).max(30), ifHigher: z.boolean().default(true) }),
  eff('ability.max', { ability: AbilityKeySchema, value: z.int().min(20).max(30) }),
  eff('proficiency.grant', {
    kind: ProficiencyKindSchema,
    target: z.string().min(1).max(64),
    level: ProficiencyLevelSchema.default('proficient'),
  }),
  eff('ac.formula', { formula: FormulaSchema }),
  eff('ac.bonus', { value: ValueSchema }),
  eff('hp.perLevel', { value: z.int() }),
  eff('hp.bonus', { value: ValueSchema }),
  eff('speed.set', { mode: SpeedModeSchema, value: z.int().min(0) }),
  eff('speed.bonus', { mode: SpeedModeSchema, value: z.int() }),
  eff('sense.grant', { sense: SenseSchema, range: z.int().min(0) }),
  eff('resource.define', {
    id: SlugSchema,
    name: ShortTextSchema,
    max: FormulaSchema,
    reset: ResetSchema,
    display: DisplaySchema.default('pips'),
  }),
  eff('spellcasting.define', {
    class: ClassRefSchema,
    ability: AbilityKeySchema,
    list: z.union([ClassRefSchema, z.array(EntityIdSchema).min(1)]),
    preparation: PreparationSchema,
    slots: SlotProgressionSchema,
    ritual: z.boolean().default(false),
    focus: z.boolean().default(false),
    cantripsKnown: FormulaSchema.optional(),
    preparedCount: FormulaSchema.optional(),
    spellsKnown: FormulaSchema.optional(),
  }),
  eff('spell.grant', {
    spell: EntityIdSchema,
    castingAbility: AbilityKeySchema.optional(),
    uses: UsesSchema.optional(),
    alwaysPrepared: z.boolean().default(false),
    level: z.int().min(0).max(9).optional(),
  }),
  eff('spell.listAdd', { class: ClassRefSchema, spells: z.array(EntityIdSchema).min(1) }),
  eff('damage.resistance', { types: z.array(DamageTypeSchema).min(1) }),
  eff('damage.immunity', { types: z.array(DamageTypeSchema).min(1) }),
  eff('damage.vulnerability', { types: z.array(DamageTypeSchema).min(1) }),
  eff('condition.immunity', { conditions: z.array(EntityIdSchema).min(1) }),
  eff('attack.bonus', { value: ValueSchema, filter: AttackFilterSchema.optional() }),
  eff('damage.bonus', { value: ValueSchema, filter: AttackFilterSchema.optional() }),
  eff('damage.rerollBelow', { value: z.int().min(1), filter: AttackFilterSchema.optional() }),
  eff('initiative.bonus', { value: ValueSchema }),
  eff('save.bonus', { value: ValueSchema, target: AbilityKeySchema.optional() }),
  eff('skill.bonus', { value: ValueSchema, target: SlugSchema.optional() }),
  eff('check.bonus', { value: ValueSchema, target: AbilityKeySchema.optional() }),
  eff('advantage.grant', { on: RollTargetSchema }),
  eff('disadvantage.impose', { on: RollTargetSchema }),
  eff('action.define', {
    id: SlugSchema,
    name: ShortTextSchema,
    kind: ActionKindSchema,
    description: LongTextSchema,
    uses: UsesSchema.optional(),
    resource: SlugSchema.optional(),
  }),
  eff('feature.text', { name: ShortTextSchema, description: LongTextSchema }),
  eff('mastery.grant', { count: FormulaSchema }),
  eff('extraAttack.set', { count: z.int().min(1).max(4) }),
  eff('item.grant', { item: EntityIdSchema, qty: z.int().min(1).default(1) }),
  eff('currency.grant', {
    cp: z.int().optional(),
    sp: z.int().optional(),
    ep: z.int().optional(),
    gp: z.int().optional(),
    pp: z.int().optional(),
  }),
  eff('size.set', { size: SlugSchema }),
  eff('type.set', { creatureType: SlugSchema }),
  eff('language.grant', { language: EntityIdSchema }),
  eff('tag.grant', { tag: z.string().min(1).max(64) }),
  eff('slot.bonus', { level: z.int().min(1).max(9), count: z.int().min(1) }),
]);
export type Effect = z.infer<typeof EffectSchema>;
```

Add to `index.ts`: `export * from './pack/enums.ts'; export * from './pack/effects.ts';`

- [ ] **Step 4: Run tests, typecheck, lint** → green. If `z.int()` is not exported by the installed Zod, use `z.number().int()` everywhere in this file and Task 3.

- [ ] **Step 5: Commit** — `git commit -am "feat(protocol): v1 effect vocabulary schema (39 types)"` (after `git add packages/protocol`).

---

### Task 5: Choice schema (`@hk/protocol`)

**Files:**
- Create: `packages/protocol/src/pack/choice.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/choice.test.ts`

**Interfaces:**
- Produces: `CHOICE_ID_RE`, `parseChoiceId(id): { entityId: string; level: number; slug: string } | null` (level `0` = creation time), `ChoiceIdSchema`, `ChoiceAtSchema`, `PickSchema`, `ChoiceSchema`, `Choice`.

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/choice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ChoiceSchema, parseChoiceId } from '../src/pack/choice.ts';

describe('choice ids', () => {
  it('parses <entityId>@<level>/<slug>', () => {
    expect(parseChoiceId('srd-5e-2024:class/fighter@1/fighting-style')).toEqual({
      entityId: 'srd-5e-2024:class/fighter',
      level: 1,
      slug: 'fighting-style',
    });
    expect(parseChoiceId('srd-5e-2024:system/5e-2024@0/ability-scores')?.level).toBe(0);
    expect(parseChoiceId('srd-5e-2024:class/fighter/fighting-style')).toBeNull();
  });
});

describe('ChoiceSchema', () => {
  it('accepts every pick form', () => {
    const base = { prompt: 'Choose', at: { kind: 'classLevel', class: 'fighter', level: 1 } };
    const picks = [
      { static: ['srd-5e-2024:feat/defense', 'srd-5e-2024:feat/archery'] },
      { query: { type: 'feat', tags: ['fighting-style'] } },
      { query: { type: 'spell', level: 1, classes: ['wizard'] } },
      { abilities: { count: 1, improve: '+2/+1' } },
      { abilityGeneration: true },
      { literal: 'text' },
      { equipmentOption: [[{ item: 'srd-5e-2024:item/chain-mail' }], [{ item: 'srd-5e-2024:item/leather-armor', qty: 1 }]] },
    ];
    picks.forEach((pick, i) => {
      const r = ChoiceSchema.safeParse({ id: `srd-5e-2024:class/fighter@1/c${i}`, ...base, pick });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });
  });

  it('applies defaults and rejects bad shapes', () => {
    const c = ChoiceSchema.parse({
      id: 'srd-5e-2024:class/fighter@4/asi',
      prompt: 'Ability Score Improvement or feat',
      at: { kind: 'classLevel', class: 'fighter', level: 4 },
      pick: { query: { type: 'feat', tags: ['general'] } },
      repeatableAt: [6, 8, 12, 14, 16, 19],
    });
    expect(c.count).toBe(1);
    expect(c.unique).toBe(true);
    expect(c.prerequisites).toEqual([]);
    expect(ChoiceSchema.safeParse({ ...c, at: { kind: 'classLevel', class: 'fighter' } }).success).toBe(false);
    expect(ChoiceSchema.safeParse({ ...c, pick: { static: [] } }).success).toBe(false);
    expect(ChoiceSchema.safeParse({ ...c, id: 'not-a-choice-id' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/protocol/src/pack/choice.ts`:

```ts
import { z } from 'zod';
import { ENTITY_ID_RE, EntityIdSchema, EntityTypeSchema, SLUG_RE, SlugSchema, parseEntityId } from '../ids.ts';
import { ShortTextSchema } from './enums.ts';
import { ClassRefSchema, PredicateSchema } from './predicate.ts';

export const CHOICE_ID_RE = new RegExp(`^(${ENTITY_ID_RE.source.slice(1, -1)})@(\\d{1,2})/([a-z0-9][a-z0-9-]*)$`);

export interface ParsedChoiceId {
  entityId: string;
  level: number;
  slug: string;
}

export function parseChoiceId(id: string): ParsedChoiceId | null {
  const m = CHOICE_ID_RE.exec(id);
  if (!m) return null;
  const entityId = m[1];
  const level = m[m.length - 2];
  const slug = m[m.length - 1];
  if (entityId === undefined || level === undefined || slug === undefined) return null;
  if (parseEntityId(entityId) === null) return null;
  return { entityId, level: Number(level), slug };
}

export const ChoiceIdSchema = z
  .string()
  .refine((s) => parseChoiceId(s) !== null, { message: 'Expected <entityId>@<level>/<slug>' });

export const ChoiceAtSchema = z.union([
  z.strictObject({ kind: z.literal('creation') }),
  z.strictObject({ kind: z.literal('classLevel'), class: ClassRefSchema, level: z.int().min(1).max(20) }),
  z.strictObject({ kind: z.literal('level'), level: z.int().min(1).max(20) }),
]);

export const EntityQuerySchema = z.strictObject({
  type: EntityTypeSchema,
  tags: z.array(z.string().min(1).max(64)).optional(),
  level: z.int().min(0).max(9).optional(),
  classes: z.array(ClassRefSchema).optional(),
  school: z.string().regex(SLUG_RE).optional(),
});

export const PickSchema = z.union([
  z.strictObject({ static: z.array(EntityIdSchema).min(1) }),
  z.strictObject({ query: EntityQuerySchema }),
  z.strictObject({
    abilities: z.strictObject({
      count: z.int().min(1).max(6),
      max: z.int().min(1).max(30).default(20),
      improve: z.enum(['+1', '+2', '+2/+1', '+1/+1/+1']),
    }),
  }),
  z.strictObject({ abilityGeneration: z.literal(true) }),
  z.strictObject({ literal: z.enum(['text']) }),
  z.strictObject({
    equipmentOption: z
      .array(z.array(z.strictObject({ item: EntityIdSchema, qty: z.int().min(1).default(1) })).min(1))
      .min(1),
  }),
]);

export const ChoiceSchema = z.strictObject({
  id: ChoiceIdSchema,
  prompt: ShortTextSchema,
  at: ChoiceAtSchema,
  pick: PickSchema,
  count: z.int().min(1).default(1),
  unique: z.boolean().default(true),
  repeatableAt: z.array(z.int().min(1).max(20)).default([]),
  prerequisites: z.array(PredicateSchema).default([]),
});
export type Choice = z.infer<typeof ChoiceSchema>;
export type ChoiceAt = z.infer<typeof ChoiceAtSchema>;
export type Pick = z.infer<typeof PickSchema>;
```

Note the regex construction: `ENTITY_ID_RE.source.slice(1, -1)` strips the `^`/`$` anchors; the entity id's own groups come first, so the level and slug are the last two capture groups. Add `export * from './pack/choice.ts';` to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/protocol && git commit -m "feat(protocol): choice schema and choice id grammar"`.

### Task 6: Entity base and the "simple" entity types (`@hk/protocol`)

**Files:**
- Create: `packages/protocol/src/pack/common.ts`, `packages/protocol/src/pack/entity-base.ts`, `packages/protocol/src/pack/entities-simple.ts`
- Test: `packages/protocol/test/entities-simple.test.ts`

**Interfaces:**
- Produces: `SemverSchema`, `BlobHashSchema`, `IconRefSchema`, `DiceSchema`, `FeatureGrantSchema`, `EntityBaseShape` (a Zod raw shape spread into every entity), and entity schemas `SystemEntitySchema`, `SpeciesEntitySchema`, `BackgroundEntitySchema`, `FeatEntitySchema`, `FeatureEntitySchema`, `ConditionEntitySchema`, `SkillEntitySchema`, `AbilityEntitySchema`, `LanguageEntitySchema`, `ToolEntitySchema`, `RuleEntitySchema`, `TableEntitySchema`; helper `entity(type, shape)`.

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/entities-simple.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AbilityEntitySchema,
  BackgroundEntitySchema,
  ConditionEntitySchema,
  FeatEntitySchema,
  FeatureEntitySchema,
  LanguageEntitySchema,
  RuleEntitySchema,
  SkillEntitySchema,
  SpeciesEntitySchema,
  SystemEntitySchema,
  TableEntitySchema,
  ToolEntitySchema,
} from '../src/pack/entities-simple.ts';

const P = 'srd-5e-2024';

describe('simple entity schemas', () => {
  it('system entity: composition slots, tables, ability generation', () => {
    const r = SystemEntitySchema.safeParse({
      id: `${P}:system/5e-2024`,
      type: 'system',
      name: 'D&D 5e (2024 rules)',
      abilities: [
        { id: 'str', name: 'Strength' }, { id: 'dex', name: 'Dexterity' }, { id: 'con', name: 'Constitution' },
        { id: 'int', name: 'Intelligence' }, { id: 'wis', name: 'Wisdom' }, { id: 'cha', name: 'Charisma' },
      ],
      skills: [{ id: 'stealth', name: 'Stealth', ability: 'dex' }],
      saves: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
      compositionSlots: [
        { id: 'species', entityType: 'species', count: 1, at: 'creation' },
        { id: 'background', entityType: 'background', count: 1, at: 'creation' },
        { id: 'class', entityType: 'class', count: 'many', at: 'levelUp' },
      ],
      restTypes: ['shortRest', 'longRest'],
      tables: {
        xp: [0, 300, 900, 2700, 6500],
        proficiency: [2, 2, 2, 2, 3],
        spellSlots: { full: [[2], [3], [4, 2], [4, 3], [4, 3, 2]] },
      },
      currencies: [{ id: 'gp', name: 'Gold', inCopper: 100 }],
      damageTypes: ['fire', 'cold'],
      sizes: ['small', 'medium'],
      conditions: [`${P}:condition/prone`],
      restRules: {
        shortRest: { allowHitDice: true },
        longRest: { hpToMax: true, restoreAllSlots: true, hitDiceRegainDivisor: 2, hitDiceRegainMin: 1, exhaustionReduce: 1 },
      },
      hpRules: { firstLevelMaxHitDie: true, averageRounding: 'up' },
      attunementMax: 3,
      abilityGeneration: {
        standardArray: [15, 14, 13, 12, 10, 8],
        pointBuy: { budget: 27, min: 8, max: 15, costs: { '8': 0, '9': 1, '10': 2, '11': 3, '12': 4, '13': 5, '14': 7, '15': 9 } },
        roll: '4d6kh3',
        manual: { min: 3, max: 18 },
      },
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts minimal valid instances of each simple type', () => {
    const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown } } }, v: unknown) => {
      const r = schema.safeParse(v);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    };
    ok(SpeciesEntitySchema, { id: `${P}:species/elf`, type: 'species', name: 'Elf', size: 'medium', speed: 30, creatureType: 'humanoid',
      grants: [{ feature: `${P}:feature/darkvision` }] });
    ok(BackgroundEntitySchema, { id: `${P}:background/acolyte`, type: 'background', name: 'Acolyte',
      abilityScores: ['int', 'wis', 'cha'], originFeat: `${P}:feat/magic-initiate-cleric`, skillProficiencies: ['insight', 'religion'],
      toolProficiency: 'calligraphers-supplies' });
    ok(FeatEntitySchema, { id: `${P}:feat/alert`, type: 'feat', name: 'Alert', category: 'origin',
      effects: [{ type: 'initiative.bonus', value: 'prof' }] });
    ok(FeatureEntitySchema, { id: `${P}:feature/second-wind`, type: 'feature', name: 'Second Wind', description: 'Regain HP.',
      uses: { count: '2', per: 'shortRest' } });
    ok(ConditionEntitySchema, { id: `${P}:condition/exhaustion`, type: 'condition', name: 'Exhaustion', levels: 6 });
    ok(SkillEntitySchema, { id: `${P}:skill/stealth`, type: 'skill', name: 'Stealth', ability: 'dex' });
    ok(AbilityEntitySchema, { id: `${P}:ability/strength`, type: 'ability', name: 'Strength', abbreviation: 'str' });
    ok(LanguageEntitySchema, { id: `${P}:language/common`, type: 'language', name: 'Common' });
    ok(ToolEntitySchema, { id: `${P}:tool/thieves-tools`, type: 'tool', name: "Thieves' Tools", category: 'artisan' });
    ok(RuleEntitySchema, { id: `${P}:rule/concentration`, type: 'rule', name: 'Concentration', description: '…' });
    ok(TableEntitySchema, { id: `${P}:table/travel-pace`, type: 'table', name: 'Travel Pace',
      columns: ['Pace', 'Per hour'], rows: [['Fast', '4 miles'], ['Normal', '3 miles']] });
  });

  it('rejects an id whose type does not match the entity type', () => {
    expect(SkillEntitySchema.safeParse({ id: `${P}:feat/stealth`, type: 'skill', name: 'Stealth', ability: 'dex' }).success).toBe(false);
  });

  it('applies base defaults', () => {
    const e = LanguageEntitySchema.parse({ id: `${P}:language/elvish`, type: 'language', name: 'Elvish' });
    expect(e.tags).toEqual([]);
    expect(e.effects).toEqual([]);
    expect(e.grants).toEqual([]);
    expect(e.choices).toEqual([]);
    expect(e.prerequisites).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/protocol/src/pack/common.ts`:

```ts
import { z } from 'zod';

export const SemverSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/, 'Expected semver x.y.z');
export const BlobHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** A pack asset hash or a bundled game-icons id (gi:<slug>). */
export const IconRefSchema = z.union([BlobHashSchema, z.string().regex(/^gi:[a-z0-9][a-z0-9-]*$/)]);
/** NdS(+/-M), e.g. 1d8, 2d6+3, 8d6 */
export const DiceSchema = z.string().regex(/^\d{1,2}d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/);
export const TagSchema = z.string().min(1).max(64);
```

`packages/protocol/src/pack/entity-base.ts`:

```ts
import { z } from 'zod';
import { type EntityType, EntityIdSchema, parseEntityId } from '../ids.ts';
import { ChoiceSchema } from './choice.ts';
import { IconRefSchema, SemverSchema, TagSchema } from './common.ts';
import { EffectSchema } from './effects.ts';
import { LongTextSchema, ShortTextSchema } from './enums.ts';
import { PredicateSchema } from './predicate.ts';

export const FeatureGrantSchema = z.strictObject({
  feature: EntityIdSchema,
  when: PredicateSchema.optional(),
});
export type FeatureGrant = z.infer<typeof FeatureGrantSchema>;

export const EntityBaseShape = {
  id: EntityIdSchema,
  name: ShortTextSchema,
  description: LongTextSchema.optional(),
  tags: z.array(TagSchema).default([]),
  source: z.strictObject({ book: z.string().min(1).max(100), page: z.int().min(1).optional() }).optional(),
  prerequisites: z.array(PredicateSchema).default([]),
  effects: z.array(EffectSchema).default([]),
  grants: z.array(FeatureGrantSchema).default([]),
  choices: z.array(ChoiceSchema).default([]),
  deprecated: z.strictObject({ replacedBy: EntityIdSchema.optional(), since: SemverSchema }).optional(),
  icon: IconRefSchema.optional(),
};

/** Builds a strict entity schema for `type` and enforces that the id's type segment matches. */
export function entity<T extends EntityType, S extends z.ZodRawShape>(type: T, shape: S) {
  return z
    .strictObject({ type: z.literal(type), ...EntityBaseShape, ...shape })
    .refine((e) => parseEntityId(e.id)?.type === type, { message: `Entity id type must be "${type}"`, path: ['id'] });
}
```

`packages/protocol/src/pack/entities-simple.ts`:

```ts
import { z } from 'zod';
import { EntityIdSchema, EntityTypeSchema, SlugSchema } from '../ids.ts';
import { DiceSchema } from './common.ts';
import { entity } from './entity-base.ts';
import { LongTextSchema, ResetSchema, ShortTextSchema, SlotProgressionSchema, UsesSchema } from './enums.ts';
import { AbilityKeySchema, ClassRefSchema, PredicateSchema } from './predicate.ts';

const NonNegInt = z.int().min(0);

export const SystemEntitySchema = entity('system', {
  abilities: z.array(z.strictObject({ id: AbilityKeySchema, name: ShortTextSchema })).min(1),
  skills: z.array(z.strictObject({ id: SlugSchema, name: ShortTextSchema, ability: AbilityKeySchema })).min(1),
  saves: z.array(AbilityKeySchema).min(1),
  compositionSlots: z
    .array(
      z.strictObject({
        id: SlugSchema,
        entityType: EntityTypeSchema,
        count: z.union([z.int().min(1), z.literal('many')]),
        at: z.enum(['creation', 'levelUp']),
      }),
    )
    .min(1),
  restTypes: z.array(ResetSchema).min(1),
  tables: z.strictObject({
    /** xp[i] = XP needed to *be* level i+1 (xp[0] = 0). */
    xp: z.array(NonNegInt).min(1).max(20),
    /** proficiency[i] = bonus at level i+1. */
    proficiency: z.array(z.int().min(1)).min(1).max(20),
    /** spellSlots[progression][levelIndex] = slots per spell level (index 0 = 1st-level slots). */
    spellSlots: z.record(SlotProgressionSchema, z.array(z.array(NonNegInt).max(9)).max(20)),
  }),
  currencies: z.array(z.strictObject({ id: SlugSchema, name: ShortTextSchema, inCopper: z.int().min(1) })).min(1),
  damageTypes: z.array(SlugSchema).min(1),
  sizes: z.array(SlugSchema).min(1),
  conditions: z.array(EntityIdSchema).default([]),
  restRules: z.strictObject({
    shortRest: z.strictObject({ allowHitDice: z.boolean() }),
    longRest: z.strictObject({
      hpToMax: z.boolean(),
      restoreAllSlots: z.boolean(),
      hitDiceRegainDivisor: z.int().min(1),
      hitDiceRegainMin: NonNegInt,
      exhaustionReduce: NonNegInt,
    }),
  }),
  hpRules: z.strictObject({ firstLevelMaxHitDie: z.boolean(), averageRounding: z.enum(['up', 'down']) }),
  attunementMax: NonNegInt,
  multiclass: z.strictObject({ prerequisites: z.record(ClassRefSchema, PredicateSchema) }).optional(),
  abilityGeneration: z.strictObject({
    standardArray: z.array(z.int().min(1).max(30)).min(1),
    pointBuy: z.strictObject({
      budget: NonNegInt,
      min: z.int().min(1),
      max: z.int().min(1),
      costs: z.record(z.string().regex(/^\d{1,2}$/), NonNegInt),
    }),
    /** Dice-spec for rolled scores, e.g. 4d6kh3 (keep highest 3). */
    roll: z.string().regex(/^\d{1,2}d\d{1,3}(kh\d|kl\d)?$/),
    manual: z.strictObject({ min: z.int().min(1), max: z.int().min(1) }),
  }),
});

export const SpeciesEntitySchema = entity('species', {
  size: SlugSchema,
  speed: NonNegInt,
  creatureType: SlugSchema,
});

export const BackgroundEntitySchema = entity('background', {
  abilityScores: z.array(AbilityKeySchema).min(1).max(6),
  originFeat: EntityIdSchema,
  skillProficiencies: z.array(SlugSchema).default([]),
  toolProficiency: SlugSchema.optional(),
});

export const FeatEntitySchema = entity('feat', {
  category: z.enum(['origin', 'general', 'fightingStyle', 'epicBoon']),
  repeatable: z.boolean().default(false),
});

export const FeatureEntitySchema = entity('feature', {
  uses: UsesSchema.optional(),
});

export const ConditionEntitySchema = entity('condition', {
  levels: z.int().min(1).max(10).optional(),
});

export const SkillEntitySchema = entity('skill', { ability: AbilityKeySchema });
export const AbilityEntitySchema = entity('ability', { abbreviation: AbilityKeySchema });
export const LanguageEntitySchema = entity('language', { script: ShortTextSchema.optional() });
export const ToolEntitySchema = entity('tool', { category: SlugSchema.optional() });
export const RuleEntitySchema = entity('rule', {});
export const TableEntitySchema = entity('table', {
  columns: z.array(ShortTextSchema).min(1),
  rows: z.array(z.array(z.union([z.string().max(200), z.number()])).min(1)).min(1),
});

// re-exported for entity files that need them
export { DiceSchema, LongTextSchema };
```

- [ ] **Step 4: Run tests, typecheck, lint** → green (the `index.ts` barrel is updated in Task 7 together with the union).

- [ ] **Step 5: Commit** — `git add packages/protocol && git commit -m "feat(protocol): entity base and simple entity schemas incl. system entity"`.

---

### Task 7: Class, subclass, spell, item schemas and the `EntitySchema` union (`@hk/protocol`)

**Files:**
- Create: `packages/protocol/src/pack/entities-progression.ts`, `packages/protocol/src/pack/entities-content.ts`, `packages/protocol/src/pack/entity.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/entities-content.test.ts`

**Interfaces:**
- Produces: `ClassLevelRowSchema`, `ClassEntitySchema`, `SubclassEntitySchema`, `SpellEntitySchema`, `ItemEntitySchema`, and `EntitySchema` (discriminated union over all 16 types), `Entity`, plus per-type `Entity*` inferred types. `EntitySchema` is what packs, the content index and pack-tools use.

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/entities-content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EntitySchema } from '../src/pack/entity.ts';

const P = 'srd-5e-2024';

describe('class / subclass / spell / item', () => {
  it('accepts a Fighter with progression rows and a level-1 equipment choice', () => {
    const r = EntitySchema.safeParse({
      id: `${P}:class/fighter`, type: 'class', name: 'Fighter',
      hitDie: 10, primaryAbility: ['str', 'dex'], saves: ['str', 'con'],
      armorTraining: ['light', 'medium', 'heavy', 'shields'],
      weaponProficiencies: ['simple', 'martial'], toolProficiencies: [],
      skillChoice: { from: ['acrobatics', 'athletics', 'perception'], count: 2 },
      subclassLevel: 3,
      levels: [
        { level: 1, grants: [{ feature: `${P}:feature/second-wind` }],
          choices: [{ id: `${P}:class/fighter@1/fighting-style`, prompt: 'Fighting Style',
            at: { kind: 'classLevel', class: 'fighter', level: 1 }, pick: { query: { type: 'feat', tags: ['fighting-style'] } } },
            { id: `${P}:class/fighter@1/equipment`, prompt: 'Starting equipment',
              at: { kind: 'classLevel', class: 'fighter', level: 1 },
              pick: { equipmentOption: [[{ item: `${P}:item/chain-mail` }, { item: `${P}:item/longsword` }]] } }] },
        { level: 2, grants: [{ feature: `${P}:feature/action-surge` }] },
        { level: 5, grants: [{ feature: `${P}:feature/extra-attack` }], extra: { attacks: 2 } },
      ],
      multiclass: { prerequisites: { any: [{ ability: { str: { gte: 13 } } }, { ability: { dex: { gte: 13 } } }] },
        gains: { armorTraining: ['light', 'medium', 'shields'], weaponProficiencies: ['simple', 'martial'], skillChoiceCount: 0 } },
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts a subclass, a spell and three item kinds', () => {
    const ok = (v: unknown) => {
      const r = EntitySchema.safeParse(v);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    };
    ok({ id: `${P}:subclass/champion`, type: 'subclass', name: 'Champion', class: `${P}:class/fighter`,
      levels: [{ level: 3, grants: [{ feature: `${P}:feature/improved-critical` }] }] });
    ok({ id: `${P}:spell/fireball`, type: 'spell', name: 'Fireball', level: 3, school: 'evocation',
      castingTime: { value: 1, unit: 'action' }, range: { kind: 'feet', distance: 150 },
      components: { v: true, s: true, m: true, materialText: 'a ball of bat guano and sulfur' },
      duration: { kind: 'instantaneous' }, concentration: false, ritual: false, classes: ['sorcerer', 'wizard'],
      damage: { dice: '8d6', type: 'fire' }, save: 'dex', higherLevels: 'The damage increases by 1d6 for each spell slot level above 3.' });
    ok({ id: `${P}:item/longsword`, type: 'item', name: 'Longsword', category: 'weapon', cost: { amount: 15, currency: 'gp' }, weight: 3,
      weapon: { kind: 'melee', category: 'martial', damage: '1d8', damageType: 'slashing', versatile: '1d10', properties: ['versatile'], mastery: 'sap' } });
    ok({ id: `${P}:item/chain-mail`, type: 'item', name: 'Chain Mail', category: 'armor', cost: { amount: 75, currency: 'gp' }, weight: 55,
      armor: { category: 'heavy', ac: 16, strength: 13, stealthDisadvantage: true } });
    ok({ id: `${P}:item/ring-of-protection`, type: 'item', name: 'Ring of Protection', category: 'magic', rarity: 'rare',
      attunement: { required: true }, effects: [{ type: 'ac.bonus', value: 1, key: 'ring-of-protection' }, { type: 'save.bonus', value: 1 }] });
  });

  it('rejects mismatched ids, unknown types, and out-of-range spell levels', () => {
    expect(EntitySchema.safeParse({ id: `${P}:spell/x`, type: 'item', name: 'X', category: 'gear' }).success).toBe(false);
    expect(EntitySchema.safeParse({ id: `${P}:spell/x`, type: 'cantrip', name: 'X' }).success).toBe(false);
    expect(EntitySchema.safeParse({ id: `${P}:spell/x`, type: 'spell', name: 'X', level: 10, school: 'evocation',
      castingTime: { value: 1, unit: 'action' }, range: { kind: 'self' }, components: { v: true, s: false, m: false },
      duration: { kind: 'instantaneous' }, concentration: false, ritual: false, classes: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/protocol/src/pack/entities-progression.ts`:

```ts
import { z } from 'zod';
import { EntityIdSchema, SlugSchema } from '../ids.ts';
import { ChoiceSchema } from './choice.ts';
import { FeatureGrantSchema, entity } from './entity-base.ts';
import { ValueSchema } from './enums.ts';
import { AbilityKeySchema, PredicateSchema } from './predicate.ts';

export const ClassLevelRowSchema = z.strictObject({
  level: z.int().min(1).max(20),
  grants: z.array(FeatureGrantSchema).default([]),
  choices: z.array(ChoiceSchema).default([]),
  /** Free-form numeric facts for this row (e.g. { attacks: 2, sneakAttackDice: 3 }); read by effects via formulas later. */
  extra: z.record(SlugSchema, ValueSchema).optional(),
});
export type ClassLevelRow = z.infer<typeof ClassLevelRowSchema>;

const rowsAscending = (rows: { level: number }[]) => rows.every((r, i) => i === 0 || r.level > (rows[i - 1]?.level ?? 0));

export const ClassEntitySchema = entity('class', {
  hitDie: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  primaryAbility: z.array(AbilityKeySchema).min(1),
  saves: z.array(AbilityKeySchema).min(1).max(2),
  armorTraining: z.array(SlugSchema).default([]),
  weaponProficiencies: z.array(SlugSchema).default([]),
  toolProficiencies: z.array(SlugSchema).default([]),
  skillChoice: z.strictObject({ from: z.array(SlugSchema).min(1), count: z.int().min(0) }),
  subclassLevel: z.int().min(1).max(20),
  levels: z.array(ClassLevelRowSchema).min(1).refine(rowsAscending, { message: 'levels must be ascending and unique' }),
  multiclass: z
    .strictObject({
      prerequisites: PredicateSchema,
      gains: z.strictObject({
        armorTraining: z.array(SlugSchema).default([]),
        weaponProficiencies: z.array(SlugSchema).default([]),
        skillChoiceCount: z.int().min(0).default(0),
      }),
    })
    .optional(),
});

export const SubclassEntitySchema = entity('subclass', {
  class: EntityIdSchema,
  levels: z.array(ClassLevelRowSchema).min(1).refine(rowsAscending, { message: 'levels must be ascending and unique' }),
});
```

`packages/protocol/src/pack/entities-content.ts`:

```ts
import { z } from 'zod';
import { SlugSchema } from '../ids.ts';
import { DiceSchema } from './common.ts';
import { entity } from './entity-base.ts';
import { DamageTypeSchema, LongTextSchema, ResetSchema } from './enums.ts';
import { FormulaSchema } from './formula.ts';
import { AbilityKeySchema, ClassRefSchema, PredicateSchema } from './predicate.ts';

export const SpellEntitySchema = entity('spell', {
  level: z.int().min(0).max(9),
  school: SlugSchema,
  castingTime: z.strictObject({
    value: z.int().min(1),
    unit: z.enum(['action', 'bonus', 'reaction', 'minute', 'hour']),
    condition: z.string().max(200).optional(),
  }),
  range: z.strictObject({
    kind: z.enum(['self', 'touch', 'feet', 'miles', 'sight', 'unlimited', 'special']),
    distance: z.int().min(1).optional(),
  }),
  components: z.strictObject({
    v: z.boolean(),
    s: z.boolean(),
    m: z.boolean(),
    materialText: z.string().max(500).optional(),
  }),
  duration: z.strictObject({
    kind: z.enum(['instantaneous', 'time', 'untilDispelled', 'special']),
    value: z.int().min(1).optional(),
    unit: z.enum(['round', 'minute', 'hour', 'day']).optional(),
  }),
  concentration: z.boolean(),
  ritual: z.boolean(),
  classes: z.array(ClassRefSchema),
  damage: z.strictObject({ dice: DiceSchema, type: DamageTypeSchema }).optional(),
  save: AbilityKeySchema.optional(),
  attack: z.enum(['melee', 'ranged']).optional(),
  higherLevels: LongTextSchema.optional(),
});

export const ItemEntitySchema = entity('item', {
  category: z.enum(['weapon', 'armor', 'shield', 'gear', 'tool', 'consumable', 'magic']),
  cost: z.strictObject({ amount: z.int().min(0), currency: SlugSchema }).optional(),
  weight: z.number().min(0).optional(),
  rarity: z.enum(['common', 'uncommon', 'rare', 'veryRare', 'legendary', 'artifact']).optional(),
  attunement: z.strictObject({ required: z.boolean(), by: PredicateSchema.optional() }).optional(),
  weapon: z
    .strictObject({
      kind: z.enum(['melee', 'ranged']),
      category: z.enum(['simple', 'martial']),
      damage: DiceSchema,
      damageType: DamageTypeSchema,
      versatile: DiceSchema.optional(),
      properties: z.array(SlugSchema).default([]),
      mastery: SlugSchema.optional(),
      range: z.strictObject({ normal: z.int().min(1), long: z.int().min(1) }).optional(),
    })
    .optional(),
  armor: z
    .strictObject({
      category: z.enum(['light', 'medium', 'heavy']),
      ac: z.int().min(10).max(20),
      dexCap: z.int().min(0).optional(),
      strength: z.int().min(1).optional(),
      stealthDisadvantage: z.boolean().default(false),
    })
    .optional(),
  shield: z.strictObject({ ac: z.int().min(1) }).optional(),
  charges: z.strictObject({ max: FormulaSchema, reset: ResetSchema }).optional(),
  container: z.strictObject({ capacityLb: z.number().min(0).optional() }).optional(),
});
```

`packages/protocol/src/pack/entity.ts`:

```ts
import { z } from 'zod';
import { ItemEntitySchema, SpellEntitySchema } from './entities-content.ts';
import { ClassEntitySchema, SubclassEntitySchema } from './entities-progression.ts';
import {
  AbilityEntitySchema,
  BackgroundEntitySchema,
  ConditionEntitySchema,
  FeatEntitySchema,
  FeatureEntitySchema,
  LanguageEntitySchema,
  RuleEntitySchema,
  SkillEntitySchema,
  SpeciesEntitySchema,
  SystemEntitySchema,
  TableEntitySchema,
  ToolEntitySchema,
} from './entities-simple.ts';

/**
 * `entity()` returns a refined schema, which cannot be a discriminatedUnion member;
 * a plain union is used instead. Zod tries members in order, so keep the common types first.
 */
export const EntitySchema = z.union([
  SpellEntitySchema,
  ItemEntitySchema,
  FeatureEntitySchema,
  FeatEntitySchema,
  SpeciesEntitySchema,
  BackgroundEntitySchema,
  ClassEntitySchema,
  SubclassEntitySchema,
  ConditionEntitySchema,
  SkillEntitySchema,
  AbilityEntitySchema,
  LanguageEntitySchema,
  ToolEntitySchema,
  RuleEntitySchema,
  TableEntitySchema,
  SystemEntitySchema,
]);
export type Entity = z.infer<typeof EntitySchema>;
export type SystemEntity = z.infer<typeof SystemEntitySchema>;
export type ClassEntity = z.infer<typeof ClassEntitySchema>;
export type SubclassEntity = z.infer<typeof SubclassEntitySchema>;
export type SpellEntity = z.infer<typeof SpellEntitySchema>;
export type ItemEntity = z.infer<typeof ItemEntitySchema>;
export type FeatureEntity = z.infer<typeof FeatureEntitySchema>;
export type FeatEntity = z.infer<typeof FeatEntitySchema>;
export type SpeciesEntity = z.infer<typeof SpeciesEntitySchema>;
export type BackgroundEntity = z.infer<typeof BackgroundEntitySchema>;
```

If `z.union` error messages for a wrong `type` are unhelpful ("invalid union"), that is acceptable for now; Task 17's semantic validator reports `entity.type` mismatches with a clear message before schema parsing runs on each entity.

Add to `index.ts`:

```ts
export * from './pack/common.ts';
export * from './pack/entity-base.ts';
export * from './pack/entities-simple.ts';
export * from './pack/entities-progression.ts';
export * from './pack/entities-content.ts';
export * from './pack/entity.ts';
```

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/protocol && git commit -m "feat(protocol): class, subclass, spell, item schemas and Entity union"`.

### Task 8: Pack document schema, cross-field rules and shared fixtures (`@hk/protocol`)

**Files:**
- Create: `packages/protocol/src/pack/pack.ts`, `packages/protocol/test/fixtures/packs/core-mini.json`, `packages/protocol/test/fixtures/packs/content-mini.json`, `packages/protocol/test/fixtures/packs/translation-mini.json`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/pack.test.ts`

**Interfaces:**
- Produces: `PACK_LIMITS`, `PackKindSchema`, `DependencySchema`, `OverrideOpSchema`, `OverrideSchema`, `AssetSchema`, `LocaleSchema`, `TranslationStringsSchema`, `PackSchema`, `Pack`, `Override`, `Dependency`, `parsePack(input: unknown): ParsePackResult` where `ParsePackResult = { ok: true; pack: Pack } | { ok: false; issues: PackIssue[] }` and `PackIssue = { path: string; message: string }`, plus `formatIssues(issues: PackIssue[]): string[]`.
- The three fixture packs are reused by `@hk/engine` and `@hk/pack-tools` tests (relative path `../../protocol/test/fixtures/packs/`).

- [ ] **Step 1: Write the fixtures**

`packages/protocol/test/fixtures/packs/core-mini.json` — a tiny but reference-complete core pack (system `mini`). Every id referenced inside exists inside:

```json
{
  "format": 1, "id": "core-mini", "version": "1.0.0", "kind": "core", "system": "mini",
  "name": "Mini core (test)", "license": "CC-BY-4.0", "locale": "en",
  "entities": [
    { "id": "core-mini:system/mini", "type": "system", "name": "Mini system",
      "abilities": [{ "id": "str", "name": "Strength" }, { "id": "dex", "name": "Dexterity" }, { "id": "con", "name": "Constitution" },
        { "id": "int", "name": "Intelligence" }, { "id": "wis", "name": "Wisdom" }, { "id": "cha", "name": "Charisma" }],
      "skills": [{ "id": "athletics", "name": "Athletics", "ability": "str" }, { "id": "stealth", "name": "Stealth", "ability": "dex" },
        { "id": "perception", "name": "Perception", "ability": "wis" }],
      "saves": ["str", "dex", "con", "int", "wis", "cha"],
      "compositionSlots": [{ "id": "species", "entityType": "species", "count": 1, "at": "creation" },
        { "id": "background", "entityType": "background", "count": 1, "at": "creation" },
        { "id": "class", "entityType": "class", "count": "many", "at": "levelUp" }],
      "restTypes": ["shortRest", "longRest"],
      "tables": { "xp": [0, 300, 900, 2700, 6500], "proficiency": [2, 2, 2, 2, 3],
        "spellSlots": { "full": [[2], [3], [4, 2], [4, 3], [4, 3, 2]], "none": [[], [], [], [], []] } },
      "currencies": [{ "id": "cp", "name": "Copper", "inCopper": 1 }, { "id": "gp", "name": "Gold", "inCopper": 100 }],
      "damageTypes": ["slashing", "piercing", "bludgeoning", "fire", "cold"],
      "sizes": ["small", "medium"],
      "conditions": ["core-mini:condition/prone", "core-mini:condition/exhaustion"],
      "restRules": { "shortRest": { "allowHitDice": true },
        "longRest": { "hpToMax": true, "restoreAllSlots": true, "hitDiceRegainDivisor": 2, "hitDiceRegainMin": 1, "exhaustionReduce": 1 } },
      "hpRules": { "firstLevelMaxHitDie": true, "averageRounding": "up" },
      "attunementMax": 3,
      "abilityGeneration": { "standardArray": [15, 14, 13, 12, 10, 8],
        "pointBuy": { "budget": 27, "min": 8, "max": 15, "costs": { "8": 0, "9": 1, "10": 2, "11": 3, "12": 4, "13": 5, "14": 7, "15": 9 } },
        "roll": "4d6kh3", "manual": { "min": 3, "max": 18 } },
      "choices": [{ "id": "core-mini:system/mini@0/ability-scores", "prompt": "Ability scores", "at": { "kind": "creation" }, "pick": { "abilityGeneration": true } }] },
    { "id": "core-mini:condition/prone", "type": "condition", "name": "Prone", "description": "You are lying down." },
    { "id": "core-mini:condition/exhaustion", "type": "condition", "name": "Exhaustion", "levels": 6 },
    { "id": "core-mini:language/common", "type": "language", "name": "Common" },
    { "id": "core-mini:skill/stealth", "type": "skill", "name": "Stealth", "ability": "dex" },
    { "id": "core-mini:feature/darkvision", "type": "feature", "name": "Darkvision", "description": "See in dim light within 60 feet.",
      "effects": [{ "type": "sense.grant", "sense": "darkvision", "range": 60 }] },
    { "id": "core-mini:species/elf", "type": "species", "name": "Elf", "size": "medium", "speed": 30, "creatureType": "humanoid",
      "grants": [{ "feature": "core-mini:feature/darkvision" }], "effects": [{ "type": "language.grant", "language": "core-mini:language/common" }] },
    { "id": "core-mini:feat/alert", "type": "feat", "name": "Alert", "category": "origin", "effects": [{ "type": "initiative.bonus", "value": "prof" }] },
    { "id": "core-mini:feat/defense", "type": "feat", "name": "Defense", "category": "fightingStyle", "tags": ["fighting-style"],
      "effects": [{ "type": "ac.bonus", "value": 1, "key": "defense", "when": { "not": { "armor": { "category": ["none"] } } } }] },
    { "id": "core-mini:feat/archery", "type": "feat", "name": "Archery", "category": "fightingStyle", "tags": ["fighting-style"],
      "effects": [{ "type": "attack.bonus", "value": 2, "filter": { "weapon": "ranged" } }] },
    { "id": "core-mini:background/acolyte", "type": "background", "name": "Acolyte", "abilityScores": ["int", "wis", "cha"],
      "originFeat": "core-mini:feat/alert", "skillProficiencies": ["perception"] },
    { "id": "core-mini:feature/second-wind", "type": "feature", "name": "Second Wind", "description": "Regain hit points.",
      "effects": [{ "type": "resource.define", "id": "second-wind", "name": "Second Wind", "max": "2", "reset": "shortRest" }] },
    { "id": "core-mini:feature/action-surge", "type": "feature", "name": "Action Surge", "description": "One extra action.",
      "effects": [{ "type": "action.define", "id": "action-surge", "name": "Action Surge", "kind": "free", "description": "Take one additional action.", "uses": { "count": "1", "per": "shortRest" } }] },
    { "id": "core-mini:feature/extra-attack", "type": "feature", "name": "Extra Attack", "description": "Attack twice.",
      "effects": [{ "type": "extraAttack.set", "count": 2 }] },
    { "id": "core-mini:feature/improved-critical", "type": "feature", "name": "Improved Critical", "description": "Crit on 19–20.",
      "effects": [{ "type": "tag.grant", "tag": "improved-critical" }] },
    { "id": "core-mini:item/longsword", "type": "item", "name": "Longsword", "category": "weapon", "cost": { "amount": 15, "currency": "gp" }, "weight": 3,
      "weapon": { "kind": "melee", "category": "martial", "damage": "1d8", "damageType": "slashing", "versatile": "1d10", "properties": ["versatile"], "mastery": "sap" } },
    { "id": "core-mini:item/chain-mail", "type": "item", "name": "Chain Mail", "category": "armor", "cost": { "amount": 75, "currency": "gp" }, "weight": 55,
      "armor": { "category": "heavy", "ac": 16, "strength": 13, "stealthDisadvantage": true } },
    { "id": "core-mini:item/shield", "type": "item", "name": "Shield", "category": "shield", "weight": 6, "shield": { "ac": 2 } },
    { "id": "core-mini:spell/fireball", "type": "spell", "name": "Fireball", "description": "A bright streak flashes.", "level": 3, "school": "evocation",
      "castingTime": { "value": 1, "unit": "action" }, "range": { "kind": "feet", "distance": 150 },
      "components": { "v": true, "s": true, "m": true, "materialText": "a ball of bat guano and sulfur" },
      "duration": { "kind": "instantaneous" }, "concentration": false, "ritual": false, "classes": ["wizard"],
      "damage": { "dice": "8d6", "type": "fire" }, "save": "dex" },
    { "id": "core-mini:class/fighter", "type": "class", "name": "Fighter", "hitDie": 10, "primaryAbility": ["str", "dex"], "saves": ["str", "con"],
      "armorTraining": ["light", "medium", "heavy", "shields"], "weaponProficiencies": ["simple", "martial"],
      "skillChoice": { "from": ["athletics", "perception", "stealth"], "count": 2 }, "subclassLevel": 3,
      "levels": [
        { "level": 1, "grants": [{ "feature": "core-mini:feature/second-wind" }],
          "choices": [{ "id": "core-mini:class/fighter@1/fighting-style", "prompt": "Fighting Style", "at": { "kind": "classLevel", "class": "fighter", "level": 1 },
            "pick": { "query": { "type": "feat", "tags": ["fighting-style"] } } },
            { "id": "core-mini:class/fighter@1/equipment", "prompt": "Starting equipment", "at": { "kind": "classLevel", "class": "fighter", "level": 1 },
              "pick": { "equipmentOption": [[{ "item": "core-mini:item/chain-mail" }, { "item": "core-mini:item/longsword" }, { "item": "core-mini:item/shield" }]] } }] },
        { "level": 2, "grants": [{ "feature": "core-mini:feature/action-surge" }] },
        { "level": 3, "choices": [{ "id": "core-mini:class/fighter@3/subclass", "prompt": "Subclass", "at": { "kind": "classLevel", "class": "fighter", "level": 3 },
          "pick": { "query": { "type": "subclass", "classes": ["fighter"] } } }] },
        { "level": 5, "grants": [{ "feature": "core-mini:feature/extra-attack" }] } ] },
    { "id": "core-mini:subclass/champion", "type": "subclass", "name": "Champion", "class": "core-mini:class/fighter",
      "levels": [{ "level": 3, "grants": [{ "feature": "core-mini:feature/improved-critical" }] }] }
  ]
}
```

`packages/protocol/test/fixtures/packs/content-mini.json`:

```json
{
  "format": 1, "id": "homebrew-mini", "version": "1.2.0", "kind": "content", "system": "mini",
  "name": "Homebrew mini (test)", "dependencies": [{ "id": "core-mini", "range": "^1" }],
  "entities": [
    { "id": "homebrew-mini:feature/cat-reflexes", "type": "feature", "name": "Cat Reflexes", "description": "Bonus to initiative.",
      "effects": [{ "type": "initiative.bonus", "value": 2 }] },
    { "id": "homebrew-mini:species/catfolk", "type": "species", "name": "Catfolk", "size": "medium", "speed": 30, "creatureType": "humanoid",
      "grants": [{ "feature": "core-mini:feature/darkvision" }, { "feature": "homebrew-mini:feature/cat-reflexes" }] }
  ],
  "overrides": [
    { "target": "core-mini:class/fighter", "patch": [{ "op": "add", "path": "/levels/0/grants/-", "value": { "feature": "homebrew-mini:feature/cat-reflexes" } }] }
  ],
  "i18n": { "ru": { "species/catfolk": { "name": "Кошколюд" } } }
}
```

`packages/protocol/test/fixtures/packs/translation-mini.json`:

```json
{
  "format": 1, "id": "core-mini-ru", "version": "1.0.0", "kind": "translation", "system": "mini", "locale": "ru",
  "name": "Mini core — Russian", "translates": { "id": "core-mini", "range": "^1" },
  "strings": {
    "spell/fireball": { "name": "Огненный шар", "description": "Яркая вспышка." },
    "class/fighter": { "name": "Воин" },
    "class/fighter@1/fighting-style": { "prompt": "Боевой стиль" }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`packages/protocol/test/pack.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PackSchema, formatIssues, parsePack } from '../src/pack/pack.ts';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/packs/${name}.json`, import.meta.url), 'utf8'));

describe('PackSchema', () => {
  it('accepts the three fixture packs', () => {
    for (const name of ['core-mini', 'content-mini', 'translation-mini']) {
      const r = parsePack(load(name));
      expect(r.ok, name + ': ' + (r.ok ? '' : formatIssues(r.issues).join('\n'))).toBe(true);
    }
  });

  it('applies defaults', () => {
    const r = parsePack(load('core-mini'));
    if (!r.ok) throw new Error('unexpected');
    expect(r.pack.dependencies).toEqual([]);
    expect(r.pack.overrides).toEqual([]);
    expect(r.pack.assets).toEqual([]);
    expect(r.pack.i18n).toEqual({});
  });

  it('rejects entities outside the pack namespace', () => {
    const pack = load('content-mini') as { entities: { id: string }[] };
    pack.entities[0]!.id = 'core-mini:feature/cat-reflexes';
    const r = parsePack(pack);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(formatIssues(r.issues).join('\n')).toMatch(/namespace/);
  });

  it('rejects duplicate entity ids', () => {
    const pack = load('core-mini') as { entities: { id: string }[] };
    pack.entities.push({ ...(pack.entities[1] as object) } as { id: string });
    expect(parsePack(pack).ok).toBe(false);
  });

  it('enforces kind-specific rules', () => {
    const core = load('core-mini') as Record<string, unknown>;
    expect(parsePack({ ...core, kind: 'content' }).ok).toBe(false); // content must not define a system entity
    expect(parsePack({ ...core, system: undefined }).ok).toBe(false); // core needs system
    const tr = load('translation-mini') as Record<string, unknown>;
    expect(parsePack({ ...tr, translates: undefined }).ok).toBe(false);
    expect(parsePack({ ...tr, locale: 'en' }).ok).toBe(false);
    const content = load('content-mini') as Record<string, unknown>;
    expect(parsePack({ ...content, overrides: [{ target: 'homebrew-mini:species/catfolk', patch: [{ op: 'remove', path: '/speed' }] }] }).ok).toBe(false); // own entities are edited directly
  });

  it('rejects unknown format versions and bad semver', () => {
    const core = load('core-mini') as Record<string, unknown>;
    expect(PackSchema.safeParse({ ...core, format: 2 }).success).toBe(false);
    expect(PackSchema.safeParse({ ...core, version: '1.0' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement**

`packages/protocol/src/pack/pack.ts`:

```ts
import { z } from 'zod';
import { EntityIdSchema, PackIdSchema, SlugSchema, parseEntityId } from '../ids.ts';
import { BlobHashSchema, SemverSchema } from './common.ts';
import { EntitySchema } from './entity.ts';
import { LongTextSchema, ShortTextSchema } from './enums.ts';

export const PACK_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxEntities: 5000,
  maxDescriptionBytes: 20 * 1024,
  maxDependencyDepth: 4,
  maxAssets: 2000,
} as const;

export const PackKindSchema = z.enum(['core', 'content', 'translation', 'theme']);
export const DependencySchema = z.strictObject({ id: PackIdSchema, range: z.string().min(1).max(64) });
export type Dependency = z.infer<typeof DependencySchema>;

export const JsonPointerSchema = z.string().regex(/^(\/([^/~]|~0|~1)*)*$/, 'Expected an RFC 6901 JSON Pointer');
export const OverrideOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), path: JsonPointerSchema, value: z.unknown() }),
  z.strictObject({ op: z.literal('replace'), path: JsonPointerSchema, value: z.unknown() }),
  z.strictObject({ op: z.literal('remove'), path: JsonPointerSchema }),
]);
export type OverrideOp = z.infer<typeof OverrideOpSchema>;
export const OverrideSchema = z.strictObject({ target: EntityIdSchema, patch: z.array(OverrideOpSchema).min(1).max(100) });
export type Override = z.infer<typeof OverrideSchema>;

export const AssetSchema = z.strictObject({
  hash: BlobHashSchema,
  kind: z.enum(['icon', 'portrait', 'banner', 'token']),
  mime: z.enum(['image/webp', 'image/jpeg', 'image/png']),
  size: z.int().min(1).max(400 * 1024),
});
export type Asset = z.infer<typeof AssetSchema>;

export const LocaleSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
/** field path → text, e.g. { "name": "…", "description": "…", "prompt": "…" } */
export const TranslationFieldsSchema = z.record(z.string().min(1).max(200), z.string().max(PACK_LIMITS.maxDescriptionBytes));
/** "<type>/<slug>" or a choice id without the pack prefix → fields */
export const TranslationStringsSchema = z.record(z.string().min(1).max(200), TranslationFieldsSchema);

const PackShape = z.strictObject({
  format: z.literal(1),
  id: PackIdSchema,
  version: SemverSchema,
  kind: PackKindSchema,
  system: SlugSchema.optional(),
  name: ShortTextSchema,
  description: LongTextSchema.optional(),
  authors: z.array(ShortTextSchema).default([]),
  license: z.string().min(1).max(100).optional(),
  attribution: z.string().max(4000).optional(),
  dependencies: z.array(DependencySchema).max(50).default([]),
  locale: LocaleSchema.default('en'),
  translates: z.strictObject({ id: PackIdSchema, range: z.string().min(1).max(64) }).optional(),
  entities: z.array(EntitySchema).max(PACK_LIMITS.maxEntities).default([]),
  overrides: z.array(OverrideSchema).max(500).default([]),
  assets: z.array(AssetSchema).max(PACK_LIMITS.maxAssets).default([]),
  i18n: z.record(LocaleSchema, TranslationStringsSchema).default({}),
  strings: TranslationStringsSchema.optional(),
});

export const PackSchema = PackShape.superRefine((pack, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });

  // namespace rule + uniqueness
  const seen = new Set<string>();
  pack.entities.forEach((e, i) => {
    const parsed = parseEntityId(e.id);
    if (parsed && parsed.packId !== pack.id) issue(`Entity "${e.id}" is outside this pack's namespace "${pack.id}"`, ['entities', i, 'id']);
    if (seen.has(e.id)) issue(`Duplicate entity id "${e.id}"`, ['entities', i, 'id']);
    seen.add(e.id);
  });
  pack.overrides.forEach((o, i) => {
    if (parseEntityId(o.target)?.packId === pack.id) issue('Overrides may only target other packs; edit own entities directly', ['overrides', i, 'target']);
  });

  const systems = pack.entities.filter((e) => e.type === 'system');
  switch (pack.kind) {
    case 'core':
      if (!pack.system) issue('Core packs must declare "system"', ['system']);
      if (systems.length !== 1) issue('Core packs must define exactly one system entity', ['entities']);
      else if (pack.system && parseEntityId(systems[0]!.id)?.slug !== pack.system) issue('System entity slug must equal "system"', ['entities']);
      break;
    case 'content':
      if (!pack.system) issue('Content packs must declare "system"', ['system']);
      if (systems.length > 0) issue('Content packs may not define system entities', ['entities']);
      break;
    case 'translation':
      if (!pack.translates) issue('Translation packs must declare "translates"', ['translates']);
      if (!pack.strings) issue('Translation packs must provide "strings"', ['strings']);
      if (pack.locale === 'en') issue('Translation packs cannot target the source language "en"', ['locale']);
      if (pack.entities.length > 0 || pack.overrides.length > 0) issue('Translation packs carry strings only', ['entities']);
      break;
    case 'theme':
      if (pack.entities.length > 0 || pack.overrides.length > 0) issue('Theme packs carry assets only', ['entities']);
      break;
  }
});
export type Pack = z.infer<typeof PackSchema>;

export interface PackIssue {
  path: string;
  message: string;
}
export type ParsePackResult = { ok: true; pack: Pack } | { ok: false; issues: PackIssue[] };

export function parsePack(input: unknown): ParsePackResult {
  const r = PackSchema.safeParse(input);
  if (r.success) return { ok: true, pack: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message })),
  };
}

export function formatIssues(issues: PackIssue[]): string[] {
  return issues.map((i) => `${i.path}: ${i.message}`);
}
```

Add `export * from './pack/pack.ts';` to `index.ts`. If the installed Zod rejects `.superRefine` on a strict object, use `.check((ctx) => { … ctx.issues.push({ code: 'custom', message, path, input: ctx.value }) })` — Zod 4's low-level equivalent.

- [ ] **Step 5: Run tests, typecheck, lint** → green.

- [ ] **Step 6: Commit** — `git add packages/protocol && git commit -m "feat(protocol): pack document schema with cross-field rules and test fixtures"`.

---

### Task 9: Published JSON Schema (`@hk/protocol`)

**Files:**
- Create: `packages/protocol/src/pack/json-schema.ts`, `packages/protocol/scripts/build-schema.ts`, `packages/protocol/schema/pack-v1.json` (generated)
- Modify: `packages/protocol/package.json` (script), `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/json-schema.test.ts`

**Interfaces:**
- Produces: `toPackJsonSchema(): Record<string, unknown>` (draft 2020-12, `$id: "https://herokeep.app/schema/pack-v1.json"`), the committed `schema/pack-v1.json`, and script `pnpm --filter @hk/protocol build:schema`.

- [ ] **Step 1: Write the failing test**

`packages/protocol/test/json-schema.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toPackJsonSchema } from '../src/pack/json-schema.ts';

describe('pack JSON Schema', () => {
  it('is a draft 2020-12 schema with an $id and object root', () => {
    const s = toPackJsonSchema() as { $schema?: string; $id?: string; type?: string };
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(s.$id).toBe('https://herokeep.app/schema/pack-v1.json');
    expect(s.type).toBe('object');
  });

  it('matches the committed schema/pack-v1.json (run `pnpm --filter @hk/protocol build:schema` after schema changes)', () => {
    const committed = JSON.parse(readFileSync(new URL('../schema/pack-v1.json', import.meta.url), 'utf8')) as unknown;
    expect(committed).toEqual(toPackJsonSchema());
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/protocol/src/pack/json-schema.ts`:

```ts
import { z } from 'zod';
import { PackSchema } from './pack.ts';

export const PACK_SCHEMA_ID = 'https://herokeep.app/schema/pack-v1.json';

export function toPackJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(PackSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    cycles: 'ref',
    reused: 'ref',
  }) as Record<string, unknown>;
  return { $id: PACK_SCHEMA_ID, ...schema };
}
```

`packages/protocol/scripts/build-schema.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { toPackJsonSchema } from '../src/pack/json-schema.ts';

const out = new URL('../schema/pack-v1.json', import.meta.url);
mkdirSync(new URL('../schema/', import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify(toPackJsonSchema(), null, 2) + '\n');
console.log(`wrote ${out.pathname}`);
```

Add to `packages/protocol/package.json` scripts: `"build:schema": "node scripts/build-schema.ts"` (Node 24 strips types; the file only uses erasable syntax). Add `export * from './pack/json-schema.ts';` to `index.ts`. Run `pnpm --filter @hk/protocol build:schema` and commit the generated file.

- [ ] **Step 4: Run tests, typecheck, lint** → green. Also confirm `git status` shows `schema/pack-v1.json` and that the file is excluded from ESLint (root config ignores `**/schema/*.json`) and Prettier (`.prettierignore` with `packages/*/schema/` — create it now).

- [ ] **Step 5: Commit** — `git add packages/protocol .prettierignore && git commit -m "feat(protocol): publish pack JSON Schema (draft 2020-12)"`.

### Task 10: `@hk/engine` package skeleton, diagnostics type, formula lexer

**Files:**
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/tsconfig.build.json`, `packages/engine/vitest.config.ts`, `packages/engine/src/index.ts`, `packages/engine/src/diagnostics.ts`, `packages/engine/src/formula/lexer.ts`
- Modify: `tsconfig.json` (root references), `pnpm-workspace.yaml` (nothing new — `semver` is already in the catalog)
- Test: `packages/engine/test/formula/lexer.test.ts`

**Interfaces:**
- Produces: `Diagnostic { severity: 'error' | 'warning'; code: string; message: string; path?: string; entityId?: string }`, `error(code, message, extra?)`, `warning(code, message, extra?)`; `Token { kind: 'num' | 'ident' | 'op' | 'eof'; value: string; pos: number }`, `tokenize(src: string): Token[]`, `FormulaError extends Error { code: 'length' | 'syntax' | 'depth' | 'identifier' | 'arity'; pos: number }`, `FORMULA_MAX_DEPTH = 16`.

- [ ] **Step 1: Package skeleton**

`packages/engine/package.json`:

```json
{
  "name": "@hk/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "tsc -b tsconfig.build.json",
    "test": "vitest run"
  },
  "dependencies": { "@hk/protocol": "workspace:*", "semver": "catalog:" },
  "devDependencies": { "@types/semver": "catalog:" }
}
```

`packages/engine/tsconfig.json` (type-check against protocol *source* so no build is needed):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "paths": { "@hk/protocol": ["../protocol/src/index.ts"] }
  },
  "include": ["src", "test", "vitest.config.ts", "../protocol/src"]
}
```

`packages/engine/tsconfig.build.json` (build against protocol's built output):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "rootDir": "src", "outDir": "dist", "tsBuildInfoFile": "dist/.tsbuildinfo" },
  "include": ["src"],
  "references": [{ "path": "../protocol/tsconfig.build.json" }]
}
```

`packages/engine/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@hk/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)) } },
  test: { name: 'engine', include: ['test/**/*.test.ts'], environment: 'node' },
});
```

Root `tsconfig.json` → add `{ "path": "packages/engine/tsconfig.build.json" }` to `references`. Run `pnpm install`.

`packages/engine/src/diagnostics.ts`:

```ts
export interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
  entityId?: string;
}

type Extra = Pick<Diagnostic, 'path' | 'entityId'>;

export function error(code: string, message: string, extra: Extra = {}): Diagnostic {
  return { severity: 'error', code, message, ...extra };
}

export function warning(code: string, message: string, extra: Extra = {}): Diagnostic {
  return { severity: 'warning', code, message, ...extra };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
```

- [ ] **Step 2: Write the failing lexer test**

`packages/engine/test/formula/lexer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FormulaError, tokenize } from '../../src/formula/lexer.ts';

const kinds = (src: string) => tokenize(src).map((t) => `${t.kind}:${t.value}`);

describe('tokenize', () => {
  it('splits numbers, identifiers and operators', () => {
    expect(kinds('10 + mod(dex)')).toEqual(['num:10', 'op:+', 'ident:mod', 'op:(', 'ident:dex', 'op:)', 'eof:']);
  });
  it('lexes two-character comparison operators', () => {
    expect(kinds('a>=1 <= == != < >')).toEqual(['ident:a', 'op:>=', 'num:1', 'op:<=', 'op:==', 'op:!=', 'op:<', 'op:>', 'eof:']);
  });
  it('keeps minus as an operator (identifiers never contain dashes at lex time)', () => {
    expect(kinds('level-1')).toEqual(['ident:level', 'op:-', 'num:1', 'eof:']);
  });
  it('rejects characters outside the grammar and over-long input', () => {
    expect(() => tokenize('mod(dex) $ 1')).toThrow(FormulaError);
    expect(() => tokenize('1 + '.repeat(100))).toThrow(FormulaError);
    try {
      tokenize('1'.repeat(300));
    } catch (e) {
      expect((e as FormulaError).code).toBe('length');
    }
  });
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm vitest run --project engine`.

- [ ] **Step 4: Implement**

`packages/engine/src/formula/lexer.ts`:

```ts
import { FORMULA_MAX_LENGTH } from '@hk/protocol';

export const FORMULA_MAX_DEPTH = 16;

export type FormulaErrorCode = 'length' | 'syntax' | 'depth' | 'identifier' | 'arity';

export class FormulaError extends Error {
  constructor(
    public readonly code: FormulaErrorCode,
    message: string,
    public readonly pos: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

export interface Token {
  kind: 'num' | 'ident' | 'op' | 'eof';
  value: string;
  pos: number;
}

const TWO_CHAR_OPS = new Set(['>=', '<=', '==', '!=']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '(', ')', ',', '<', '>']);

export function tokenize(src: string): Token[] {
  if (src.length > FORMULA_MAX_LENGTH) {
    throw new FormulaError('length', `Formula longer than ${FORMULA_MAX_LENGTH} characters`, FORMULA_MAX_LENGTH);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && src[j]! >= '0' && src[j]! <= '9') j++;
      tokens.push({ kind: 'num', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      tokens.push({ kind: 'ident', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ kind: 'op', value: c, pos: i });
      i++;
      continue;
    }
    throw new FormulaError('syntax', `Unexpected character "${c}"`, i);
  }
  tokens.push({ kind: 'eof', value: '', pos: src.length });
  return tokens;
}
```

`packages/engine/src/index.ts`:

```ts
export * from './diagnostics.ts';
export * from './formula/lexer.ts';
```

- [ ] **Step 5: Run tests, typecheck, lint** → green.

- [ ] **Step 6: Commit** — `git add packages/engine tsconfig.json pnpm-lock.yaml && git commit -m "feat(engine): package skeleton, diagnostics, formula lexer"`.

---

### Task 11: Formula parser (Pratt) with depth limit and identifier whitelist

**Files:**
- Create: `packages/engine/src/formula/ast.ts`, `packages/engine/src/formula/parser.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/formula/parser.test.ts`

**Interfaces:**
- Produces: AST types `FormulaAst = NumNode | VarNode | CallNode | UnaryNode | BinaryNode | CompareNode` (`{ k: 'num'; v: number }`, `{ k: 'var'; name: 'level' | 'prof' }`, `{ k: 'call'; name: CallName; args: FormulaAst[]; slug?: string }`, `{ k: 'un'; op: '-'; e }`, `{ k: 'bin'; op: '+' | '-' | '*' | '/'; l; r }`, `{ k: 'cmp'; op: '>=' | '<=' | '>' | '<' | '==' | '!='; l; r }`), `VARIABLES = ['level', 'prof']`, `SLUG_CALLS = ['classLevel', 'hitDie', 'resource']`, `ABILITY_CALLS = ['mod', 'score']`, `MATH_CALLS = ['max', 'min', 'floor', 'ceil', 'abs']`, `parseFormula(src: string): FormulaAst` (throws `FormulaError`), `containsComparison(ast): boolean`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/formula/parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FormulaError } from '../../src/formula/lexer.ts';
import { containsComparison, parseFormula } from '../../src/formula/parser.ts';

describe('parseFormula', () => {
  it('respects precedence: comparison < additive < multiplicative < unary < call', () => {
    expect(parseFormula('1 + 2 * 3')).toEqual({
      k: 'bin', op: '+', l: { k: 'num', v: 1 }, r: { k: 'bin', op: '*', l: { k: 'num', v: 2 }, r: { k: 'num', v: 3 } },
    });
    expect(parseFormula('-level + 1')).toEqual({
      k: 'bin', op: '+', l: { k: 'un', op: '-', e: { k: 'var', name: 'level' } }, r: { k: 'num', v: 1 },
    });
    expect(parseFormula('mod(dex) >= 2')).toEqual({
      k: 'cmp', op: '>=', l: { k: 'call', name: 'mod', args: [], slug: 'dex' }, r: { k: 'num', v: 2 },
    });
  });

  it('parses slug arguments with dashes and multi-arg math calls', () => {
    expect(parseFormula('classLevel(fighter-arcane)')).toEqual({ k: 'call', name: 'classLevel', args: [], slug: 'fighter-arcane' });
    expect(parseFormula('max(1, level + mod(int))')).toMatchObject({ k: 'call', name: 'max' });
    expect(parseFormula('floor(level / 2)')).toMatchObject({ k: 'call', name: 'floor' });
  });

  it('rejects unknown identifiers, wrong arity and trailing input', () => {
    const code = (src: string) => {
      try {
        parseFormula(src);
        return 'ok';
      } catch (e) {
        return (e as FormulaError).code;
      }
    };
    expect(code('strength')).toBe('identifier');
    expect(code('hp(1)')).toBe('identifier');
    expect(code('mod(dex, con)')).toBe('arity');
    expect(code('max(1)')).toBe('arity');
    expect(code('floor(1, 2)')).toBe('arity');
    expect(code('1 + ')).toBe('syntax');
    expect(code('1 2')).toBe('syntax');
    expect(code('(1')).toBe('syntax');
    expect(code('mod()')).toBe('syntax');
  });

  it('enforces the nesting depth limit', () => {
    expect(() => parseFormula('('.repeat(17) + '1' + ')'.repeat(17))).toThrow(/depth/);
    expect(parseFormula('('.repeat(15) + '1' + ')'.repeat(15))).toEqual({ k: 'num', v: 1 });
  });

  it('reports whether a comparison is present', () => {
    expect(containsComparison(parseFormula('level >= 5'))).toBe(true);
    expect(containsComparison(parseFormula('max(level, 5)'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/formula/ast.ts`:

```ts
export const VARIABLES = ['level', 'prof'] as const;
export const SLUG_CALLS = ['classLevel', 'hitDie', 'resource'] as const;
export const ABILITY_CALLS = ['mod', 'score'] as const;
export const MATH_CALLS = ['max', 'min', 'floor', 'ceil', 'abs'] as const;

export type VarName = (typeof VARIABLES)[number];
export type CallName = (typeof SLUG_CALLS)[number] | (typeof ABILITY_CALLS)[number] | (typeof MATH_CALLS)[number];
export type BinOp = '+' | '-' | '*' | '/';
export type CmpOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

export type FormulaAst =
  | { k: 'num'; v: number }
  | { k: 'var'; name: VarName }
  | { k: 'call'; name: CallName; args: FormulaAst[]; slug?: string }
  | { k: 'un'; op: '-'; e: FormulaAst }
  | { k: 'bin'; op: BinOp; l: FormulaAst; r: FormulaAst }
  | { k: 'cmp'; op: CmpOp; l: FormulaAst; r: FormulaAst };

export function containsComparison(ast: FormulaAst): boolean {
  switch (ast.k) {
    case 'cmp':
      return true;
    case 'bin':
      return containsComparison(ast.l) || containsComparison(ast.r);
    case 'un':
      return containsComparison(ast.e);
    case 'call':
      return ast.args.some(containsComparison);
    default:
      return false;
  }
}
```

`packages/engine/src/formula/parser.ts`:

```ts
import { ABILITY_CALLS, type CallName, type FormulaAst, MATH_CALLS, SLUG_CALLS, VARIABLES, type VarName } from './ast.ts';
import { FORMULA_MAX_DEPTH, FormulaError, type Token, tokenize } from './lexer.ts';

const CMP_OPS = new Set(['>=', '<=', '>', '<', '==', '!=']);
const isVar = (s: string): s is VarName => (VARIABLES as readonly string[]).includes(s);
const isSlugCall = (s: string) => (SLUG_CALLS as readonly string[]).includes(s);
const isAbilityCall = (s: string) => (ABILITY_CALLS as readonly string[]).includes(s);
const isMathCall = (s: string) => (MATH_CALLS as readonly string[]).includes(s);

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly t: Token[]) {}

  parse(): FormulaAst {
    const ast = this.comparison();
    if (this.peek().kind !== 'eof') throw new FormulaError('syntax', `Unexpected "${this.peek().value}"`, this.peek().pos);
    return ast;
  }

  private peek(): Token {
    return this.t[this.i]!;
  }
  private next(): Token {
    return this.t[this.i++]!;
  }
  private expectOp(v: string): void {
    const tok = this.next();
    if (tok.kind !== 'op' || tok.value !== v) throw new FormulaError('syntax', `Expected "${v}"`, tok.pos);
  }
  private enter(pos: number): void {
    if (++this.depth > FORMULA_MAX_DEPTH) throw new FormulaError('depth', `Nesting deeper than ${FORMULA_MAX_DEPTH}`, pos);
  }
  private leave(): void {
    this.depth--;
  }

  private comparison(): FormulaAst {
    const l = this.additive();
    const tok = this.peek();
    if (tok.kind === 'op' && CMP_OPS.has(tok.value)) {
      this.next();
      const r = this.additive();
      return { k: 'cmp', op: tok.value as FormulaAst extends { k: 'cmp'; op: infer O } ? O : never, l, r };
    }
    return l;
  }

  private additive(): FormulaAst {
    let l = this.multiplicative();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'op' && (tok.value === '+' || tok.value === '-')) {
        this.next();
        l = { k: 'bin', op: tok.value, l, r: this.multiplicative() };
      } else return l;
    }
  }

  private multiplicative(): FormulaAst {
    let l = this.unary();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'op' && (tok.value === '*' || tok.value === '/')) {
        this.next();
        l = { k: 'bin', op: tok.value, l, r: this.unary() };
      } else return l;
    }
  }

  private unary(): FormulaAst {
    const tok = this.peek();
    if (tok.kind === 'op' && tok.value === '-') {
      this.next();
      this.enter(tok.pos);
      const e = this.unary();
      this.leave();
      return { k: 'un', op: '-', e };
    }
    return this.primary();
  }

  private primary(): FormulaAst {
    const tok = this.next();
    if (tok.kind === 'num') return { k: 'num', v: Number(tok.value) };
    if (tok.kind === 'op' && tok.value === '(') {
      this.enter(tok.pos);
      const e = this.comparison();
      this.leave();
      this.expectOp(')');
      return e;
    }
    if (tok.kind === 'ident') {
      const next = this.peek();
      const isCall = next.kind === 'op' && next.value === '(';
      if (!isCall) {
        if (isVar(tok.value)) return { k: 'var', name: tok.value };
        throw new FormulaError('identifier', `Unknown identifier "${tok.value}"`, tok.pos);
      }
      return this.call(tok);
    }
    throw new FormulaError('syntax', `Unexpected "${tok.value || 'end of formula'}"`, tok.pos);
  }

  private call(nameTok: Token): FormulaAst {
    const name = nameTok.value;
    this.expectOp('(');
    this.enter(nameTok.pos);
    let node: FormulaAst;
    if (isSlugCall(name) || isAbilityCall(name)) {
      node = { k: 'call', name: name as CallName, args: [], slug: this.slugArgument(isAbilityCall(name)) };
    } else if (isMathCall(name)) {
      const args: FormulaAst[] = [this.comparison()];
      while (this.peek().kind === 'op' && this.peek().value === ',') {
        this.next();
        args.push(this.comparison());
      }
      const unary = name === 'floor' || name === 'ceil' || name === 'abs';
      if (unary && args.length !== 1) throw new FormulaError('arity', `${name}() takes exactly one argument`, nameTok.pos);
      if (!unary && args.length < 2) throw new FormulaError('arity', `${name}() takes at least two arguments`, nameTok.pos);
      node = { k: 'call', name: name as CallName, args };
    } else {
      throw new FormulaError('identifier', `Unknown function "${name}"`, nameTok.pos);
    }
    this.leave();
    this.expectOp(')');
    return node;
  }

  /** ident ('-' ident)* joined with dashes; ability calls require a 3-letter key. */
  private slugArgument(ability: boolean): string {
    const first = this.next();
    if (first.kind !== 'ident') throw new FormulaError('syntax', 'Expected a name argument', first.pos);
    let slug = first.value;
    while (this.peek().kind === 'op' && this.peek().value === '-') {
      this.next();
      const part = this.next();
      if (part.kind !== 'ident' && part.kind !== 'num') throw new FormulaError('syntax', 'Bad name argument', part.pos);
      slug += '-' + part.value;
    }
    if (this.peek().kind === 'op' && this.peek().value === ',') {
      throw new FormulaError('arity', 'This function takes exactly one argument', this.peek().pos);
    }
    if (ability && !/^[a-z]{3}$/.test(slug)) throw new FormulaError('syntax', 'Ability key must be 3 lowercase letters', first.pos);
    return slug.toLowerCase();
  }
}

export function parseFormula(src: string): FormulaAst {
  return new Parser(tokenize(src)).parse();
}

export { containsComparison } from './ast.ts';
```

Replace the awkward conditional type on the `cmp` node with a plain cast if the compiler complains: `op: tok.value as CmpOp` after importing `CmpOp` from `./ast.ts`.

Add to `index.ts`: `export * from './formula/ast.ts'; export * from './formula/parser.ts';`

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): formula parser with depth limit and identifier whitelist"`.

---

### Task 12: Formula evaluator and `validateFormula`

**Files:**
- Create: `packages/engine/src/formula/evaluate.ts`, `packages/engine/src/formula/validate.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/formula/evaluate.test.ts`

**Interfaces:**
- Produces: `FormulaContext { level: number; prof: number; classLevel(slug: string): number; mod(ability: string): number; score(ability: string): number; hitDie(slug: string): number; resource(slug: string): number }`, `evaluateFormula(ast: FormulaAst, ctx: FormulaContext): number` (total: division by zero → 0, integer division rounds down, comparisons yield 1/0), `evalFormulaString(src: string, ctx): number` (parses + evaluates; throws `FormulaError`), `validateFormula(src: string, opts?: { allowComparison?: boolean; path?: string; entityId?: string }): Diagnostic[]` (codes `formula.length | formula.syntax | formula.depth | formula.identifier | formula.arity | formula.comparison`), `constantContext(): FormulaContext` (all zeros; used by validators).

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/formula/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type FormulaContext, evalFormulaString } from '../../src/formula/evaluate.ts';
import { validateFormula } from '../../src/formula/validate.ts';

const ctx: FormulaContext = {
  level: 5,
  prof: 3,
  classLevel: (s) => ({ fighter: 5, wizard: 0 })[s] ?? 0,
  mod: (a) => ({ str: 3, dex: 2, con: 1, int: -1 })[a] ?? 0,
  score: (a) => ({ str: 16, dex: 14, con: 12, int: 8 })[a] ?? 10,
  hitDie: (s) => (s === 'fighter' ? 10 : 6),
  resource: () => 0,
};

describe('evaluateFormula', () => {
  it.each([
    ['10 + mod(dex) + mod(con)', 13],
    ['level / 2', 2],
    ['-7 / 2', -4],
    ['floor(level / 2)', 2],
    ['ceil(level / 2)', 3],
    ['max(1, level + mod(int))', 4],
    ['min(prof, 2)', 2],
    ['abs(mod(int))', 1],
    ['classLevel(fighter) * hitDie(fighter)', 50],
    ['score(str) >= 13', 1],
    ['mod(dex) == 3', 0],
    ['1 / 0', 0],
    ['-level', -5],
  ])('%s → %d', (src, expected) => {
    expect(evalFormulaString(src, ctx)).toBe(expected);
  });
});

describe('validateFormula', () => {
  it('returns no diagnostics for valid formulas', () => {
    expect(validateFormula('10 + mod(dex)')).toEqual([]);
  });
  it('maps parser errors to diagnostic codes', () => {
    expect(validateFormula('mod(dex) +')[0]?.code).toBe('formula.syntax');
    expect(validateFormula('hp')[0]?.code).toBe('formula.identifier');
    expect(validateFormula('max(1)')[0]?.code).toBe('formula.arity');
    expect(validateFormula('('.repeat(20) + '1' + ')'.repeat(20))[0]?.code).toBe('formula.depth');
    expect(validateFormula('1'.repeat(300))[0]?.code).toBe('formula.length');
  });
  it('rejects comparisons unless allowed', () => {
    expect(validateFormula('level >= 5')[0]?.code).toBe('formula.comparison');
    expect(validateFormula('level >= 5', { allowComparison: true })).toEqual([]);
  });
  it('carries path and entityId', () => {
    const d = validateFormula('bad(1)', { path: 'effects.0.formula', entityId: 'x:feat/y' })[0]!;
    expect(d.path).toBe('effects.0.formula');
    expect(d.entityId).toBe('x:feat/y');
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/formula/evaluate.ts`:

```ts
import { type FormulaAst } from './ast.ts';
import { parseFormula } from './parser.ts';

export interface FormulaContext {
  level: number;
  prof: number;
  classLevel(slug: string): number;
  mod(ability: string): number;
  score(ability: string): number;
  hitDie(slug: string): number;
  resource(slug: string): number;
}

export function constantContext(): FormulaContext {
  return { level: 0, prof: 0, classLevel: () => 0, mod: () => 0, score: () => 0, hitDie: () => 0, resource: () => 0 };
}

const intDiv = (a: number, b: number): number => (b === 0 ? 0 : Math.floor(a / b));

export function evaluateFormula(ast: FormulaAst, ctx: FormulaContext): number {
  switch (ast.k) {
    case 'num':
      return ast.v;
    case 'var':
      return ast.name === 'level' ? ctx.level : ctx.prof;
    case 'un':
      return -evaluateFormula(ast.e, ctx);
    case 'bin': {
      const l = evaluateFormula(ast.l, ctx);
      const r = evaluateFormula(ast.r, ctx);
      switch (ast.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return intDiv(l, r);
      }
      break;
    }
    case 'cmp': {
      const l = evaluateFormula(ast.l, ctx);
      const r = evaluateFormula(ast.r, ctx);
      const ok =
        ast.op === '>=' ? l >= r : ast.op === '<=' ? l <= r : ast.op === '>' ? l > r : ast.op === '<' ? l < r : ast.op === '==' ? l === r : l !== r;
      return ok ? 1 : 0;
    }
    case 'call': {
      const slug = ast.slug ?? '';
      switch (ast.name) {
        case 'classLevel':
          return ctx.classLevel(slug);
        case 'hitDie':
          return ctx.hitDie(slug);
        case 'resource':
          return ctx.resource(slug);
        case 'mod':
          return ctx.mod(slug);
        case 'score':
          return ctx.score(slug);
        case 'max':
          return Math.max(...ast.args.map((a) => evaluateFormula(a, ctx)));
        case 'min':
          return Math.min(...ast.args.map((a) => evaluateFormula(a, ctx)));
        case 'floor':
          return Math.floor(evaluateFormula(ast.args[0]!, ctx));
        case 'ceil':
          return Math.ceil(evaluateFormula(ast.args[0]!, ctx));
        case 'abs':
          return Math.abs(evaluateFormula(ast.args[0]!, ctx));
      }
    }
  }
  return 0;
}

export function evalFormulaString(src: string, ctx: FormulaContext): number {
  return evaluateFormula(parseFormula(src), ctx);
}
```

`packages/engine/src/formula/validate.ts`:

```ts
import { type Diagnostic, error } from '../diagnostics.ts';
import { containsComparison } from './ast.ts';
import { FormulaError } from './lexer.ts';
import { parseFormula } from './parser.ts';

export interface ValidateFormulaOptions {
  allowComparison?: boolean;
  path?: string;
  entityId?: string;
}

export function validateFormula(src: string, opts: ValidateFormulaOptions = {}): Diagnostic[] {
  const extra = { ...(opts.path !== undefined && { path: opts.path }), ...(opts.entityId !== undefined && { entityId: opts.entityId }) };
  try {
    const ast = parseFormula(src);
    if (!opts.allowComparison && containsComparison(ast)) {
      return [error('formula.comparison', 'Comparisons are only allowed in predicate formulas', extra)];
    }
    return [];
  } catch (e) {
    if (e instanceof FormulaError) {
      return [error(`formula.${e.code}`, `${e.message} (at ${e.pos}) in "${src}"`, extra)];
    }
    throw e;
  }
}
```

Add both to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): formula evaluator and validateFormula diagnostics"`.

### Task 13: Predicate evaluator

**Files:**
- Create: `packages/engine/src/predicate/context.ts`, `packages/engine/src/predicate/evaluate.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/predicate/evaluate.test.ts`

**Interfaces:**
- Produces: `PredicateContext` interface (below), `constantPredicateContext(): PredicateContext` (everything false/0/undefined), `evaluatePredicate(p: Predicate, ctx: PredicateContext): boolean`, `matchesComparison(value: number, cmp: Comparison): boolean`, `collectPredicateFormulas(p: Predicate, path: string): { path: string; src: string }[]`.
- Consumes: `Predicate`, `Comparison` (`@hk/protocol`), `FormulaContext`, `evalFormulaString` (Task 12).

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/predicate/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { constantPredicateContext, type PredicateContext } from '../../src/predicate/context.ts';
import { collectPredicateFormulas, evaluatePredicate } from '../../src/predicate/evaluate.ts';

const ctx: PredicateContext = {
  ...constantPredicateContext(),
  level: 5,
  abilityScore: (a) => ({ str: 16, dex: 14 })[a] ?? 10,
  classLevel: (r) => (r === 'fighter' || r === 'core-mini:class/fighter' ? 5 : 0),
  hasFeature: (id) => id === 'core-mini:feature/second-wind',
  hasFeat: (id) => id === 'core-mini:feat/alert',
  hasSpell: (id) => id === 'core-mini:spell/fireball',
  hasTag: (t) => t === 'martial',
  isProficient: (kind, target) => kind === 'armor' && target === 'heavy',
  armorCategory: () => 'heavy',
  hasShield: () => true,
  speciesId: () => 'core-mini:species/elf',
  classIds: () => ['core-mini:class/fighter'],
  subclassIds: () => ['core-mini:subclass/champion'],
  hasCondition: (id) => id === 'core-mini:condition/prone',
  isSpellcaster: () => false,
  formula: { level: 5, prof: 3, classLevel: () => 5, mod: (a) => (a === 'dex' ? 2 : 0), score: () => 10, hitDie: () => 10, resource: () => 0 },
};

describe('evaluatePredicate', () => {
  it.each([
    [{ ability: { str: { gte: 13 } } }, true],
    [{ ability: { str: { gte: 13, lte: 15 } } }, false],
    [{ level: { eq: 5 } }, true],
    [{ classLevel: { fighter: { gte: 3 } } }, true],
    [{ classLevel: { 'core-mini:class/fighter': { gt: 5 } } }, false],
    [{ hasFeature: 'core-mini:feature/second-wind' }, true],
    [{ hasFeat: 'core-mini:feat/alert' }, true],
    [{ hasSpell: 'core-mini:spell/fireball' }, true],
    [{ tag: 'martial' }, true],
    [{ proficient: { kind: 'armor', target: 'heavy' } }, true],
    [{ armor: { category: ['none', 'light'] } }, false],
    [{ armor: { category: ['heavy'] } }, true],
    [{ shield: true }, true],
    [{ species: 'core-mini:species/elf' }, true],
    [{ class: 'core-mini:class/fighter' }, true],
    [{ subclass: 'core-mini:subclass/champion' }, true],
    [{ condition: 'core-mini:condition/prone' }, true],
    [{ spellcaster: true }, false],
    [{ formula: 'mod(dex) >= 2' }, true],
    [{ all: [{ level: { gte: 4 } }, { not: { shield: false } }] }, true],
    [{ any: [{ spellcaster: true }, { tag: 'martial' }] }, true],
    [{ not: { any: [{ tag: 'martial' }] } }, false],
  ])('%j → %s', (pred, expected) => {
    expect(evaluatePredicate(pred as never, ctx)).toBe(expected);
  });

  it('is false for everything against the constant context', () => {
    const c = constantPredicateContext();
    expect(evaluatePredicate({ level: { gte: 1 } }, c)).toBe(false);
    expect(evaluatePredicate({ not: { level: { gte: 1 } } }, c)).toBe(true);
  });

  it('collects formulas with paths', () => {
    expect(collectPredicateFormulas({ all: [{ formula: 'a >= 1' }, { not: { formula: 'b < 2' } }] }, 'when')).toEqual([
      { path: 'when.all.0.formula', src: 'a >= 1' },
      { path: 'when.all.1.not.formula', src: 'b < 2' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/predicate/context.ts`:

```ts
import { type FormulaContext, constantContext } from '../formula/evaluate.ts';

export type ArmorCategory = 'none' | 'light' | 'medium' | 'heavy';

export interface PredicateContext {
  level: number;
  abilityScore(ability: string): number;
  /** Accepts a class slug or a full entity id. */
  classLevel(ref: string): number;
  hasFeature(id: string): boolean;
  hasFeat(id: string): boolean;
  hasSpell(id: string): boolean;
  hasTag(tag: string): boolean;
  isProficient(kind: string, target: string): boolean;
  armorCategory(): ArmorCategory;
  hasShield(): boolean;
  speciesId(): string | undefined;
  classIds(): string[];
  subclassIds(): string[];
  hasCondition(id: string): boolean;
  isSpellcaster(): boolean;
  formula: FormulaContext;
}

export function constantPredicateContext(): PredicateContext {
  return {
    level: 0,
    abilityScore: () => 0,
    classLevel: () => 0,
    hasFeature: () => false,
    hasFeat: () => false,
    hasSpell: () => false,
    hasTag: () => false,
    isProficient: () => false,
    armorCategory: () => 'none',
    hasShield: () => false,
    speciesId: () => undefined,
    classIds: () => [],
    subclassIds: () => [],
    hasCondition: () => false,
    isSpellcaster: () => false,
    formula: constantContext(),
  };
}
```

`packages/engine/src/predicate/evaluate.ts`:

```ts
import type { Comparison, Predicate } from '@hk/protocol';
import { evalFormulaString } from '../formula/evaluate.ts';
import type { PredicateContext } from './context.ts';

export function matchesComparison(value: number, cmp: Comparison): boolean {
  if (cmp.gte !== undefined && !(value >= cmp.gte)) return false;
  if (cmp.lte !== undefined && !(value <= cmp.lte)) return false;
  if (cmp.gt !== undefined && !(value > cmp.gt)) return false;
  if (cmp.lt !== undefined && !(value < cmp.lt)) return false;
  if (cmp.eq !== undefined && value !== cmp.eq) return false;
  return true;
}

export function evaluatePredicate(p: Predicate, ctx: PredicateContext): boolean {
  if ('all' in p) return p.all.every((q) => evaluatePredicate(q, ctx));
  if ('any' in p) return p.any.some((q) => evaluatePredicate(q, ctx));
  if ('not' in p) return !evaluatePredicate(p.not, ctx);
  if ('ability' in p) return Object.entries(p.ability).every(([a, cmp]) => matchesComparison(ctx.abilityScore(a), cmp));
  if ('level' in p) return matchesComparison(ctx.level, p.level);
  if ('classLevel' in p) return Object.entries(p.classLevel).every(([ref, cmp]) => matchesComparison(ctx.classLevel(ref), cmp));
  if ('hasFeature' in p) return ctx.hasFeature(p.hasFeature);
  if ('hasFeat' in p) return ctx.hasFeat(p.hasFeat);
  if ('hasSpell' in p) return ctx.hasSpell(p.hasSpell);
  if ('tag' in p) return ctx.hasTag(p.tag);
  if ('proficient' in p) return ctx.isProficient(p.proficient.kind, p.proficient.target);
  if ('armor' in p) return (p.armor.category as string[]).includes(ctx.armorCategory());
  if ('shield' in p) return ctx.hasShield() === p.shield;
  if ('species' in p) return ctx.speciesId() === p.species;
  if ('class' in p) return ctx.classIds().includes(p.class);
  if ('subclass' in p) return ctx.subclassIds().includes(p.subclass);
  if ('condition' in p) return ctx.hasCondition(p.condition);
  if ('spellcaster' in p) return ctx.isSpellcaster() === p.spellcaster;
  if ('formula' in p) {
    try {
      return evalFormulaString(p.formula, ctx.formula) !== 0;
    } catch {
      return false; // invalid formulas are reported by validation; at runtime they never grant anything
    }
  }
  return false;
}

export function collectPredicateFormulas(p: Predicate, path: string): { path: string; src: string }[] {
  if ('all' in p) return p.all.flatMap((q, i) => collectPredicateFormulas(q, `${path}.all.${i}`));
  if ('any' in p) return p.any.flatMap((q, i) => collectPredicateFormulas(q, `${path}.any.${i}`));
  if ('not' in p) return collectPredicateFormulas(p.not, `${path}.not`);
  if ('formula' in p) return [{ path: `${path}.formula`, src: p.formula }];
  return [];
}
```

Add both files to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): predicate evaluator and context"`.

---

### Task 14: Effects registry and effect validation

**Files:**
- Create: `packages/engine/src/effects/registry.ts`, `packages/engine/src/effects/validate.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/effects/validate.test.ts`

**Interfaces:**
- Produces: `KNOWN_EFFECT_TYPES: ReadonlySet<string>`, `isKnownEffectType(type: string): boolean`, `collectEffectFormulas(effect: Effect, path: string): { path: string; src: string; allowComparison: boolean }[]`, `validateEffect(effect: unknown, path: string, entityId: string): Diagnostic[]` (warning `effect.unknownType` for types outside the vocabulary; `formula.*` errors for bad formulas; predicate formulas inside `when` allow comparisons), `validateEffects(effects: unknown[], path: string, entityId: string): Diagnostic[]`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/effects/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collectEffectFormulas, isKnownEffectType, validateEffects } from '../../src/effects/validate.ts';

describe('effects', () => {
  it('knows the vocabulary', () => {
    expect(isKnownEffectType('ac.formula')).toBe(true);
    expect(isKnownEffectType('ac.bonuses')).toBe(false);
  });

  it('collects formula-bearing fields', () => {
    expect(collectEffectFormulas({ type: 'ac.formula', formula: '10 + mod(dex)' }, 'effects.0')).toEqual([
      { path: 'effects.0.formula', src: '10 + mod(dex)', allowComparison: false },
    ]);
    expect(collectEffectFormulas({ type: 'hp.bonus', value: 'level' }, 'effects.1')).toEqual([
      { path: 'effects.1.value', src: 'level', allowComparison: false },
    ]);
    expect(collectEffectFormulas({ type: 'hp.bonus', value: 3 }, 'effects.2')).toEqual([]);
    expect(
      collectEffectFormulas(
        { type: 'spell.grant', spell: 'x:spell/y', uses: { count: 'prof', per: 'longRest' }, alwaysPrepared: false, when: { formula: 'level >= 3' } },
        'effects.3',
      ),
    ).toEqual([
      { path: 'effects.3.uses.count', src: 'prof', allowComparison: false },
      { path: 'effects.3.when.formula', src: 'level >= 3', allowComparison: true },
    ]);
  });

  it('reports unknown types as warnings and bad formulas as errors', () => {
    const d = validateEffects(
      [{ type: 'ac.bonuses', value: 1 }, { type: 'ac.bonus', value: 'mod(dex' }, { type: 'ac.bonus', value: 'level >= 2' }],
      'effects',
      'x:feat/y',
    );
    expect(d.map((x) => [x.severity, x.code, x.path])).toEqual([
      ['warning', 'effect.unknownType', 'effects.0.type'],
      ['error', 'formula.syntax', 'effects.1.value'],
      ['error', 'formula.comparison', 'effects.2.value'],
    ]);
    expect(d.every((x) => x.entityId === 'x:feat/y')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/effects/registry.ts`:

```ts
import { EFFECT_TYPES } from '@hk/protocol';

export const KNOWN_EFFECT_TYPES: ReadonlySet<string> = new Set<string>(EFFECT_TYPES);

export function isKnownEffectType(type: string): boolean {
  return KNOWN_EFFECT_TYPES.has(type);
}
```

`packages/engine/src/effects/validate.ts`:

```ts
import { type Effect, EffectSchema, type Predicate } from '@hk/protocol';
import { type Diagnostic, error, warning } from '../diagnostics.ts';
import { validateFormula } from '../formula/validate.ts';
import { collectPredicateFormulas } from '../predicate/evaluate.ts';
import { isKnownEffectType } from './registry.ts';

export { isKnownEffectType } from './registry.ts';

export interface FormulaSite {
  path: string;
  src: string;
  allowComparison: boolean;
}

/** Field names that hold a formula (or an int-or-formula value) per effect type. */
const FORMULA_FIELDS: Record<string, string[]> = {
  'ac.formula': ['formula'],
  'ac.bonus': ['value'],
  'hp.bonus': ['value'],
  'resource.define': ['max'],
  'spellcasting.define': ['cantripsKnown', 'preparedCount', 'spellsKnown'],
  'attack.bonus': ['value'],
  'damage.bonus': ['value'],
  'initiative.bonus': ['value'],
  'save.bonus': ['value'],
  'skill.bonus': ['value'],
  'check.bonus': ['value'],
  'mastery.grant': ['count'],
};

export function collectEffectFormulas(effect: Effect, path: string): FormulaSite[] {
  const sites: FormulaSite[] = [];
  const rec = effect as unknown as Record<string, unknown>;
  for (const field of FORMULA_FIELDS[effect.type] ?? []) {
    const v = rec[field];
    if (typeof v === 'string') sites.push({ path: `${path}.${field}`, src: v, allowComparison: false });
  }
  const uses = rec['uses'] as { count?: unknown } | undefined;
  if (uses && typeof uses.count === 'string') sites.push({ path: `${path}.uses.count`, src: uses.count, allowComparison: false });
  if (effect.when) {
    for (const f of collectPredicateFormulas(effect.when as Predicate, `${path}.when`)) sites.push({ ...f, allowComparison: true });
  }
  return sites;
}

export function validateEffect(effect: unknown, path: string, entityId: string): Diagnostic[] {
  const type = (effect as { type?: unknown })?.type;
  if (typeof type !== 'string' || !isKnownEffectType(type)) {
    return [warning('effect.unknownType', `Unknown effect type "${String(type)}" (ignored at runtime)`, { path: `${path}.type`, entityId })];
  }
  const parsed = EffectSchema.safeParse(effect);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => error('effect.invalid', i.message, { path: `${path}.${i.path.map(String).join('.')}`, entityId }));
  }
  return collectEffectFormulas(parsed.data, path).flatMap((s) =>
    validateFormula(s.src, { allowComparison: s.allowComparison, path: s.path, entityId }),
  );
}

export function validateEffects(effects: unknown[], path: string, entityId: string): Diagnostic[] {
  return effects.flatMap((e, i) => validateEffect(e, `${path}.${i}`, entityId));
}
```

Add both to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): effect type registry and effect validation"`.

---

### Task 15: Minimal JSON Patch and pack dependency resolution

**Files:**
- Create: `packages/engine/src/content/patch.ts`, `packages/engine/src/content/deps.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/content/patch.test.ts`, `packages/engine/test/content/deps.test.ts`

**Interfaces:**
- Produces: `parsePointer(path: string): string[]`, `applyPatch<T>(doc: T, ops: OverrideOp[]): { ok: true; result: T } | { ok: false; error: string; opIndex: number }` (pure; `structuredClone` first; `add` to arrays supports index and `-`; `replace`/`remove` require an existing target); `Pins = Record<string, string>` (packId → version), `selectPackVersions(packs: Pack[], pins?: Pins): { selected: Map<string, Pack>; diagnostics: Diagnostic[] }`, `resolveDependencyOrder(selected: Map<string, Pack>, roots: string[]): { order: Pack[]; diagnostics: Diagnostic[] }` (dependencies before dependants; codes `deps.missing`, `deps.versionMismatch`, `deps.cycle`, `deps.depth`).
- Consumes: `Pack`, `OverrideOp`, `PACK_LIMITS` (`@hk/protocol`), `semver`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/content/patch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyPatch, parsePointer } from '../../src/content/patch.ts';

describe('json patch', () => {
  it('parses pointers with escapes', () => {
    expect(parsePointer('/levels/0/grants/-')).toEqual(['levels', '0', 'grants', '-']);
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    expect(parsePointer('')).toEqual([]);
  });

  it('adds, replaces and removes without mutating the input', () => {
    const doc = { levels: [{ level: 1, grants: [{ feature: 'a' }] }], name: 'Fighter' };
    const r = applyPatch(doc, [
      { op: 'add', path: '/levels/0/grants/-', value: { feature: 'b' } },
      { op: 'replace', path: '/name', value: 'Warrior' },
      { op: 'add', path: '/levels/0/grants/0', value: { feature: 'z' } },
      { op: 'remove', path: '/levels/0/level' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toEqual({ levels: [{ grants: [{ feature: 'z' }, { feature: 'a' }, { feature: 'b' }] }], name: 'Warrior' });
    expect(doc.name).toBe('Fighter');
    expect(doc.levels[0]!.grants).toHaveLength(1);
  });

  it('fails on missing targets and reports the op index', () => {
    const r = applyPatch({ a: 1 }, [{ op: 'replace', path: '/b', value: 2 }]);
    expect(r).toMatchObject({ ok: false, opIndex: 0 });
    expect(applyPatch({ a: [1] }, [{ op: 'remove', path: '/a/5' }]).ok).toBe(false);
    expect(applyPatch({ a: 1 }, [{ op: 'add', path: '/a/b', value: 1 }]).ok).toBe(false);
  });
});
```

`packages/engine/test/content/deps.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { type Pack, parsePack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { resolveDependencyOrder, selectPackVersions } from '../../src/content/deps.ts';

const load = (name: string): Pack => {
  const r = parsePack(JSON.parse(readFileSync(new URL(`../../../protocol/test/fixtures/packs/${name}.json`, import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(name);
  return r.pack;
};
const core = load('core-mini');
const content = load('content-mini');
const mk = (id: string, version: string, deps: { id: string; range: string }[] = []): Pack =>
  ({ ...content, id, version, dependencies: deps, entities: [], overrides: [], i18n: {} }) as Pack;

describe('selectPackVersions', () => {
  it('prefers pinned versions, else the highest', () => {
    const v1 = mk('x', '1.0.0');
    const v2 = mk('x', '1.5.0');
    expect(selectPackVersions([v1, v2]).selected.get('x')?.version).toBe('1.5.0');
    expect(selectPackVersions([v1, v2], { x: '1.0.0' }).selected.get('x')?.version).toBe('1.0.0');
    const r = selectPackVersions([v1], { x: '9.9.9' });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['deps.pinMissing']);
  });
});

describe('resolveDependencyOrder', () => {
  it('orders dependencies first', () => {
    const { order, diagnostics } = resolveDependencyOrder(new Map([[core.id, core], [content.id, content]]), [content.id]);
    expect(diagnostics).toEqual([]);
    expect(order.map((p) => p.id)).toEqual(['core-mini', 'homebrew-mini']);
  });

  it('reports missing dependencies and version mismatches', () => {
    const onlyContent = resolveDependencyOrder(new Map([[content.id, content]]), [content.id]);
    expect(onlyContent.diagnostics.map((d) => d.code)).toEqual(['deps.missing']);
    const mismatch = resolveDependencyOrder(new Map([[core.id, { ...core, version: '2.0.0' }], [content.id, content]]), [content.id]);
    expect(mismatch.diagnostics.map((d) => d.code)).toEqual(['deps.versionMismatch']);
  });

  it('detects cycles and depth', () => {
    const a = mk('aaa', '1.0.0', [{ id: 'bbb', range: '^1' }]);
    const b = mk('bbb', '1.0.0', [{ id: 'aaa', range: '^1' }]);
    expect(resolveDependencyOrder(new Map([['aaa', a], ['bbb', b]]), ['aaa']).diagnostics.map((d) => d.code)).toContain('deps.cycle');
    const chain = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i, all) => mk(id, '1.0.0', i < all.length - 1 ? [{ id: all[i + 1]!, range: '^1' }] : []));
    const deep = resolveDependencyOrder(new Map(chain.map((p) => [p.id, p])), ['p1']);
    expect(deep.diagnostics.map((d) => d.code)).toContain('deps.depth');
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/content/patch.ts`:

```ts
import type { OverrideOp } from '@hk/protocol';

export function parsePointer(path: string): string[] {
  if (path === '') return [];
  return path
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

type Json = Record<string, unknown> | unknown[];
type PatchResult<T> = { ok: true; result: T } | { ok: false; error: string; opIndex: number };

function isContainer(v: unknown): v is Json {
  return typeof v === 'object' && v !== null;
}

function walk(root: unknown, segments: string[]): { parent: Json; key: string } | string {
  let cur: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    if (!isContainer(cur)) return `Path segment "${segments[i]}" has no container parent`;
    cur = Array.isArray(cur) ? cur[Number(segments[i])] : (cur as Record<string, unknown>)[segments[i]!];
  }
  if (!isContainer(cur)) return 'Parent is not an object or array';
  return { parent: cur, key: segments[segments.length - 1]! };
}

export function applyPatch<T>(doc: T, ops: OverrideOp[]): PatchResult<T> {
  const result = structuredClone(doc);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const segments = parsePointer(op.path);
    if (segments.length === 0) return { ok: false, error: 'Root replacement is not allowed', opIndex: i };
    const w = walk(result, segments);
    if (typeof w === 'string') return { ok: false, error: w, opIndex: i };
    const { parent, key } = w;
    if (Array.isArray(parent)) {
      const idx = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(idx) || idx < 0) return { ok: false, error: `Bad array index "${key}"`, opIndex: i };
      if (op.op === 'add') {
        if (idx > parent.length) return { ok: false, error: 'Array index out of range', opIndex: i };
        parent.splice(idx, 0, structuredClone(op.value));
      } else {
        if (idx >= parent.length) return { ok: false, error: 'Array index out of range', opIndex: i };
        if (op.op === 'replace') parent[idx] = structuredClone(op.value);
        else parent.splice(idx, 1);
      }
    } else {
      const exists = Object.prototype.hasOwnProperty.call(parent, key);
      if (op.op === 'add') parent[key] = structuredClone(op.value);
      else if (!exists) return { ok: false, error: `Key "${key}" does not exist`, opIndex: i };
      else if (op.op === 'replace') parent[key] = structuredClone(op.value);
      else delete parent[key];
    }
  }
  return { ok: true, result };
}
```

`packages/engine/src/content/deps.ts`:

```ts
import { PACK_LIMITS, type Pack } from '@hk/protocol';
import semver from 'semver';
import { type Diagnostic, error } from '../diagnostics.ts';

export type Pins = Record<string, string>;

export function selectPackVersions(packs: Pack[], pins: Pins = {}): { selected: Map<string, Pack>; diagnostics: Diagnostic[] } {
  const byId = new Map<string, Pack[]>();
  for (const p of packs) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  const selected = new Map<string, Pack>();
  const diagnostics: Diagnostic[] = [];
  for (const [id, versions] of byId) {
    const pin = pins[id];
    if (pin !== undefined) {
      const hit = versions.find((p) => p.version === pin);
      if (hit) selected.set(id, hit);
      else diagnostics.push(error('deps.pinMissing', `Pinned version ${id}@${pin} is not available (have ${versions.map((v) => v.version).join(', ')})`));
      continue;
    }
    const best = [...versions].sort((a, b) => semver.rcompare(a.version, b.version))[0]!;
    selected.set(id, best);
  }
  return { selected, diagnostics };
}

export function resolveDependencyOrder(selected: Map<string, Pack>, roots: string[]): { order: Pack[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const order: Pack[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string, depth: number, chain: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      diagnostics.push(error('deps.cycle', `Dependency cycle: ${[...chain, id].join(' → ')}`));
      return;
    }
    if (depth > PACK_LIMITS.maxDependencyDepth) {
      diagnostics.push(error('deps.depth', `Dependency depth exceeds ${PACK_LIMITS.maxDependencyDepth} at ${[...chain, id].join(' → ')}`));
      return;
    }
    const pack = selected.get(id);
    if (!pack) {
      diagnostics.push(error('deps.missing', `Missing pack "${id}" (required by ${chain[chain.length - 1] ?? 'roots'})`));
      return;
    }
    state.set(id, 'visiting');
    for (const dep of pack.dependencies) {
      const target = selected.get(dep.id);
      if (target && !semver.satisfies(target.version, dep.range)) {
        diagnostics.push(error('deps.versionMismatch', `${pack.id} needs ${dep.id}@${dep.range} but ${target.version} is selected`));
        continue;
      }
      visit(dep.id, depth + 1, [...chain, id]);
    }
    if (pack.kind === 'translation' && pack.translates) visit(pack.translates.id, depth + 1, [...chain, id]);
    state.set(id, 'done');
    order.push(pack);
  };

  for (const root of roots) visit(root, 0, []);
  return { order, diagnostics };
}
```

Add both to `index.ts`. `semver` ships CommonJS; with `verbatimModuleSyntax` the default import `import semver from 'semver'` is correct under NodeNext (`esModuleInterop` is implied for NodeNext).

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): JSON patch overrides and dependency resolution"`.

### Task 16: Content index (entity map, overrides, queries)

**Files:**
- Create: `packages/engine/src/content/index.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/content/index.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ContentIndexOptions { pins?: Pins; roots?: string[] }   // roots default = every given pack id
  interface ContentIndex {
    get(id: string): Entity | undefined;
    has(id: string): boolean;
    byType(type: EntityType): Entity[];                 // sorted by id
    query(q: EntityQuery): Entity[];                    // EntityQuery from @hk/protocol (type, tags, level, classes, school)
    system(): SystemEntity;                             // throws Error('No system entity') if absent
    packs(): Pack[];                                    // dependency order, translation packs excluded
    translationPacks(): Pack[];
    resolveClassRef(ref: string): string | undefined;   // 'fighter' → 'core-mini:class/fighter'; ids pass through if present
    readonly diagnostics: Diagnostic[];
  }
  function createContentIndex(packs: Pack[], opts?: ContentIndexOptions): ContentIndex
  ```
  Diagnostics codes: `index.duplicateId`, `index.overrideTargetMissing`, `index.overrideFailed`, `index.overrideInvalid`, plus all `deps.*`.
- Consumes: Tasks 7, 8, 15.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/content/index.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { type Pack, parsePack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';

const load = (name: string): Pack => {
  const r = parsePack(JSON.parse(readFileSync(new URL(`../../../protocol/test/fixtures/packs/${name}.json`, import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(name);
  return r.pack;
};
const core = load('core-mini');
const content = load('content-mini');
const ru = load('translation-mini');

describe('createContentIndex', () => {
  it('indexes entities from all packs in dependency order', () => {
    const idx = createContentIndex([content, core, ru]);
    expect(idx.diagnostics).toEqual([]);
    expect(idx.packs().map((p) => p.id)).toEqual(['core-mini', 'homebrew-mini']);
    expect(idx.translationPacks().map((p) => p.id)).toEqual(['core-mini-ru']);
    expect(idx.get('core-mini:spell/fireball')?.name).toBe('Fireball');
    expect(idx.has('homebrew-mini:species/catfolk')).toBe(true);
    expect(idx.byType('species').map((e) => e.id)).toEqual(['core-mini:species/elf', 'homebrew-mini:species/catfolk']);
    expect(idx.system().id).toBe('core-mini:system/mini');
  });

  it('applies overrides from dependants onto dependencies', () => {
    const idx = createContentIndex([core, content]);
    const fighter = idx.get('core-mini:class/fighter');
    expect(fighter?.type).toBe('class');
    if (fighter?.type !== 'class') return;
    expect(fighter.levels[0]?.grants.map((g) => g.feature)).toEqual(['core-mini:feature/second-wind', 'homebrew-mini:feature/cat-reflexes']);
    // the original pack object is untouched
    expect((core.entities.find((e) => e.id === 'core-mini:class/fighter') as { levels: { grants: unknown[] }[] }).levels[0]!.grants).toHaveLength(1);
  });

  it('answers queries', () => {
    const idx = createContentIndex([core, content]);
    expect(idx.query({ type: 'feat', tags: ['fighting-style'] }).map((e) => e.id)).toEqual(['core-mini:feat/archery', 'core-mini:feat/defense']);
    expect(idx.query({ type: 'spell', level: 3, classes: ['wizard'] }).map((e) => e.id)).toEqual(['core-mini:spell/fireball']);
    expect(idx.query({ type: 'spell', classes: ['cleric'] })).toEqual([]);
    expect(idx.query({ type: 'subclass', classes: ['fighter'] }).map((e) => e.id)).toEqual(['core-mini:subclass/champion']);
    expect(idx.resolveClassRef('fighter')).toBe('core-mini:class/fighter');
    expect(idx.resolveClassRef('core-mini:class/fighter')).toBe('core-mini:class/fighter');
    expect(idx.resolveClassRef('wizard')).toBeUndefined();
  });

  it('reports duplicate ids across packs and bad override targets', () => {
    const dup = { ...content, entities: [...content.entities, { ...core.entities[1]!, id: 'homebrew-mini:condition/prone' }] } as Pack;
    // same id twice inside one pack is a schema error; across packs it is an index error:
    const clash = { ...content, id: 'core-mini', version: '1.0.1', dependencies: [] } as Pack;
    expect(createContentIndex([core, clash], { pins: { 'core-mini': '9.9.9' } }).diagnostics.map((d) => d.code)).toContain('deps.pinMissing');
    const badTarget = { ...content, overrides: [{ target: 'core-mini:class/wizard', patch: [{ op: 'remove', path: '/hitDie' }] }] } as Pack;
    expect(createContentIndex([core, badTarget]).diagnostics.map((d) => d.code)).toEqual(['index.overrideTargetMissing']);
    const invalidPatch = { ...content, overrides: [{ target: 'core-mini:class/fighter', patch: [{ op: 'replace', path: '/hitDie', value: 7 }] }] } as Pack;
    expect(createContentIndex([core, invalidPatch]).diagnostics.map((d) => d.code)).toEqual(['index.overrideInvalid']);
    void dup;
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/content/index.ts`:

```ts
import { type Entity, EntitySchema, type EntityQuery, type EntityType, type Pack, type SystemEntity, parseEntityId } from '@hk/protocol';
import { type Diagnostic, error } from '../diagnostics.ts';
import { type Pins, resolveDependencyOrder, selectPackVersions } from './deps.ts';
import { applyPatch } from './patch.ts';

export interface ContentIndexOptions {
  pins?: Pins;
  roots?: string[];
}

export interface ContentIndex {
  get(id: string): Entity | undefined;
  has(id: string): boolean;
  byType(type: EntityType): Entity[];
  query(q: EntityQuery): Entity[];
  system(): SystemEntity;
  packs(): Pack[];
  translationPacks(): Pack[];
  resolveClassRef(ref: string): string | undefined;
  readonly diagnostics: Diagnostic[];
}

const byIdAsc = (a: Entity, b: Entity) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createContentIndex(input: Pack[], opts: ContentIndexOptions = {}): ContentIndex {
  const diagnostics: Diagnostic[] = [];
  const { selected, diagnostics: selDiag } = selectPackVersions(input, opts.pins);
  diagnostics.push(...selDiag);
  const roots = opts.roots ?? [...selected.keys()];
  const { order, diagnostics: depDiag } = resolveDependencyOrder(selected, roots);
  diagnostics.push(...depDiag);

  const entities = new Map<string, Entity>();
  const contentPacks = order.filter((p) => p.kind !== 'translation');
  for (const pack of contentPacks) {
    for (const e of pack.entities) {
      if (entities.has(e.id)) diagnostics.push(error('index.duplicateId', `Entity "${e.id}" defined by more than one pack`, { entityId: e.id }));
      else entities.set(e.id, e);
    }
  }
  for (const pack of contentPacks) {
    pack.overrides.forEach((o, i) => {
      const target = entities.get(o.target);
      const path = `overrides.${i}`;
      if (!target) {
        diagnostics.push(error('index.overrideTargetMissing', `${pack.id} overrides missing entity "${o.target}"`, { path, entityId: o.target }));
        return;
      }
      const patched = applyPatch(target, o.patch);
      if (!patched.ok) {
        diagnostics.push(error('index.overrideFailed', `${pack.id}: ${patched.error} (op ${patched.opIndex})`, { path, entityId: o.target }));
        return;
      }
      const revalidated = EntitySchema.safeParse(patched.result);
      if (!revalidated.success) {
        diagnostics.push(error('index.overrideInvalid', `${pack.id}: override produces an invalid entity`, { path, entityId: o.target }));
        return;
      }
      entities.set(o.target, revalidated.data);
    });
  }

  const classSlugToId = new Map<string, string>();
  for (const e of entities.values()) {
    if (e.type === 'class') {
      const slug = parseEntityId(e.id)?.slug;
      if (slug && !classSlugToId.has(slug)) classSlugToId.set(slug, e.id);
    }
  }
  const resolveClassRef = (ref: string): string | undefined => (entities.has(ref) ? ref : classSlugToId.get(ref));

  const all = [...entities.values()].sort(byIdAsc);
  const byType = new Map<EntityType, Entity[]>();
  for (const e of all) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);

  const index: ContentIndex = {
    get: (id) => entities.get(id),
    has: (id) => entities.has(id),
    byType: (type) => byType.get(type) ?? [],
    query(q) {
      const wantClasses = q.classes?.map((c) => resolveClassRef(c) ?? c);
      return (byType.get(q.type) ?? []).filter((e) => {
        if (q.tags && !q.tags.every((t) => e.tags.includes(t))) return false;
        if (q.level !== undefined && !(e.type === 'spell' && e.level === q.level)) return false;
        if (q.school !== undefined && !(e.type === 'spell' && e.school === q.school)) return false;
        if (wantClasses) {
          if (e.type === 'spell') {
            const have = e.classes.map((c) => resolveClassRef(c) ?? c);
            if (!wantClasses.some((c) => have.includes(c))) return false;
          } else if (e.type === 'subclass') {
            if (!wantClasses.includes(e.class)) return false;
          } else return false;
        }
        return true;
      });
    },
    system() {
      const s = (byType.get('system') ?? [])[0];
      if (!s || s.type !== 'system') throw new Error('No system entity in content index');
      return s;
    },
    packs: () => contentPacks,
    translationPacks: () => order.filter((p) => p.kind === 'translation'),
    resolveClassRef,
    diagnostics,
  };
  return index;
}
```

Export `EntityQuery` from protocol if not already (`export type EntityQuery = z.infer<typeof EntityQuerySchema>` in `choice.ts`). Add `export * from './content/index.ts';` to the engine barrel.

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/engine packages/protocol && git commit -m "feat(engine): content index with overrides and queries"`.

---

### Task 17: Semantic pack validation (`validatePack`)

**Files:**
- Create: `packages/engine/src/content/refs.ts`, `packages/engine/src/content/validate.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/content/validate.test.ts`

**Interfaces:**
- Produces: `collectEntityRefs(entity: Entity): { path: string; id: string }[]` (every entity-id reference an entity can carry), `validatePack(pack: Pack, available: Pack[]): Diagnostic[]` with codes: `deps.*`, `index.*`, `ref.missing`, `ref.classUnresolved` (warning), `choice.idMismatch`, `class.rowLevelMismatch`, `asset.missing`, `entity.descriptionTooLong`, `pack.tooLarge`, `i18n.unknownKey` (warning), plus `effect.*`/`formula.*` from Task 14.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/content/validate.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { type Pack, parsePack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { validatePack } from '../../src/content/validate.ts';

const load = (name: string): Pack => {
  const r = parsePack(JSON.parse(readFileSync(new URL(`../../../protocol/test/fixtures/packs/${name}.json`, import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(name);
  return r.pack;
};
const core = load('core-mini');
const content = load('content-mini');
const ru = load('translation-mini');
const codes = (d: { code: string }[]) => d.map((x) => x.code);

describe('validatePack', () => {
  it('passes the fixtures', () => {
    expect(validatePack(core, [])).toEqual([]);
    expect(validatePack(content, [core])).toEqual([]);
    expect(validatePack(ru, [core])).toEqual([]);
  });

  it('reports dangling references with paths', () => {
    const broken = structuredClone(content);
    (broken.entities[1] as { grants: { feature: string }[] }).grants[0]!.feature = 'core-mini:feature/nope';
    const d = validatePack(broken, [core]);
    expect(codes(d)).toEqual(['ref.missing']);
    expect(d[0]?.path).toBe('entities.1.grants.0.feature');
    expect(d[0]?.entityId).toBe('homebrew-mini:species/catfolk');
  });

  it('reports choice id mismatches and class row level mismatches', () => {
    const bad = structuredClone(core);
    const fighter = bad.entities.find((e) => e.id === 'core-mini:class/fighter');
    if (fighter?.type !== 'class') throw new Error();
    fighter.levels[0]!.choices[0]!.id = 'core-mini:class/wizard@1/fighting-style';
    fighter.levels[1]!.choices = [{ ...fighter.levels[0]!.choices[1]!, id: 'core-mini:class/fighter@1/dup', at: { kind: 'classLevel', class: 'fighter', level: 1 } }];
    expect(codes(validatePack(bad, []))).toEqual(['choice.idMismatch', 'class.rowLevelMismatch']);
  });

  it('warns on unknown translation keys and missing deps error', () => {
    const tr = structuredClone(ru);
    tr.strings!['spell/meteor'] = { name: 'x' };
    const d = validatePack(tr, [core]);
    expect(d).toEqual([expect.objectContaining({ severity: 'warning', code: 'i18n.unknownKey' })]);
    expect(codes(validatePack(content, []))).toEqual(['deps.missing']);
  });

  it('flags oversize descriptions and missing assets', () => {
    const big = structuredClone(core);
    big.entities[1]!.description = 'x'.repeat(20 * 1024 + 1);
    expect(codes(validatePack(big, []))).toEqual(['entity.descriptionTooLong']);
    const icon = structuredClone(core);
    icon.entities[1]!.icon = 'sha256:' + 'a'.repeat(64);
    expect(codes(validatePack(icon, []))).toEqual(['asset.missing']);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/content/refs.ts`:

```ts
import type { Choice, Entity, Predicate } from '@hk/protocol';

export interface EntityRef {
  path: string;
  id: string;
}

function predicateRefs(p: Predicate, path: string): EntityRef[] {
  if ('all' in p) return p.all.flatMap((q, i) => predicateRefs(q, `${path}.all.${i}`));
  if ('any' in p) return p.any.flatMap((q, i) => predicateRefs(q, `${path}.any.${i}`));
  if ('not' in p) return predicateRefs(p.not, `${path}.not`);
  for (const key of ['hasFeature', 'hasFeat', 'hasSpell', 'species', 'class', 'subclass', 'condition'] as const) {
    if (key in p) return [{ path: `${path}.${key}`, id: (p as Record<string, string>)[key]! }];
  }
  return [];
}

function choiceRefs(c: Choice, path: string): EntityRef[] {
  const refs: EntityRef[] = c.prerequisites.flatMap((p, i) => predicateRefs(p, `${path}.prerequisites.${i}`));
  if ('static' in c.pick) refs.push(...c.pick.static.map((id, i) => ({ path: `${path}.pick.static.${i}`, id })));
  if ('equipmentOption' in c.pick) {
    c.pick.equipmentOption.forEach((opt, i) => opt.forEach((it, j) => refs.push({ path: `${path}.pick.equipmentOption.${i}.${j}.item`, id: it.item })));
  }
  return refs;
}

export function collectEntityRefs(e: Entity): EntityRef[] {
  const refs: EntityRef[] = [];
  e.grants.forEach((g, i) => {
    refs.push({ path: `grants.${i}.feature`, id: g.feature });
    if (g.when) refs.push(...predicateRefs(g.when, `grants.${i}.when`));
  });
  e.prerequisites.forEach((p, i) => refs.push(...predicateRefs(p, `prerequisites.${i}`)));
  e.choices.forEach((c, i) => refs.push(...choiceRefs(c, `choices.${i}`)));
  e.effects.forEach((ef, i) => {
    const path = `effects.${i}`;
    if (ef.when) refs.push(...predicateRefs(ef.when, `${path}.when`));
    switch (ef.type) {
      case 'spell.grant': refs.push({ path: `${path}.spell`, id: ef.spell }); break;
      case 'spell.listAdd': ef.spells.forEach((id, j) => refs.push({ path: `${path}.spells.${j}`, id })); break;
      case 'condition.immunity': ef.conditions.forEach((id, j) => refs.push({ path: `${path}.conditions.${j}`, id })); break;
      case 'item.grant': refs.push({ path: `${path}.item`, id: ef.item }); break;
      case 'language.grant': refs.push({ path: `${path}.language`, id: ef.language }); break;
      default: break;
    }
  });
  if (e.deprecated?.replacedBy) refs.push({ path: 'deprecated.replacedBy', id: e.deprecated.replacedBy });
  switch (e.type) {
    case 'background': refs.push({ path: 'originFeat', id: e.originFeat }); break;
    case 'subclass':
      refs.push({ path: 'class', id: e.class });
      e.levels.forEach((row, i) => {
        row.grants.forEach((g, j) => refs.push({ path: `levels.${i}.grants.${j}.feature`, id: g.feature }));
        row.choices.forEach((c, j) => refs.push(...choiceRefs(c, `levels.${i}.choices.${j}`)));
      });
      break;
    case 'class':
      e.levels.forEach((row, i) => {
        row.grants.forEach((g, j) => refs.push({ path: `levels.${i}.grants.${j}.feature`, id: g.feature }));
        row.choices.forEach((c, j) => refs.push(...choiceRefs(c, `levels.${i}.choices.${j}`)));
      });
      break;
    case 'system': e.conditions.forEach((id, i) => refs.push({ path: `conditions.${i}`, id })); break;
    default: break;
  }
  return refs;
}
```

`packages/engine/src/content/validate.ts`:

```ts
import { type Choice, type Entity, PACK_LIMITS, type Pack, parseChoiceId, parseEntityId } from '@hk/protocol';
import { type Diagnostic, error, warning } from '../diagnostics.ts';
import { validateEffects } from '../effects/validate.ts';
import { createContentIndex } from './index.ts';
import { collectEntityRefs } from './refs.ts';

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

function choiceDiagnostics(c: Choice, owner: Entity, path: string, rowLevel: number | undefined, resolveClass: (r: string) => string | undefined): Diagnostic[] {
  const out: Diagnostic[] = [];
  const parsed = parseChoiceId(c.id);
  if (parsed?.entityId !== owner.id) out.push(error('choice.idMismatch', `Choice id "${c.id}" must start with the owning entity id "${owner.id}"`, { path: `${path}.id`, entityId: owner.id }));
  if (c.at.kind === 'classLevel') {
    if (!resolveClass(c.at.class)) out.push(warning('ref.classUnresolved', `Class "${c.at.class}" not found for choice "${c.id}"`, { path: `${path}.at.class`, entityId: owner.id }));
    if (rowLevel !== undefined && c.at.level !== rowLevel) out.push(error('class.rowLevelMismatch', `Choice "${c.id}" is at level ${c.at.level} but sits in the level ${rowLevel} row`, { path: `${path}.at.level`, entityId: owner.id }));
  }
  return out;
}

export function validatePack(pack: Pack, available: Pack[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const bytes = utf8Bytes(JSON.stringify(pack));
  if (bytes > PACK_LIMITS.maxBytes) out.push(error('pack.tooLarge', `Pack is ${bytes} bytes; limit is ${PACK_LIMITS.maxBytes}`));

  const others = available.filter((p) => !(p.id === pack.id && p.version === pack.version));
  const index = createContentIndex([...others, pack], { roots: [pack.id] });
  out.push(...index.diagnostics);
  if (index.diagnostics.some((d) => d.code.startsWith('deps.'))) return out; // nothing below is meaningful without the closure

  const assetHashes = new Set(pack.assets.map((a) => a.hash));
  pack.entities.forEach((e, i) => {
    const base = `entities.${i}`;
    if (e.description && utf8Bytes(e.description) > PACK_LIMITS.maxDescriptionBytes) {
      out.push(error('entity.descriptionTooLong', `Description of "${e.id}" exceeds ${PACK_LIMITS.maxDescriptionBytes} bytes`, { path: `${base}.description`, entityId: e.id }));
    }
    if (e.icon?.startsWith('sha256:') && !assetHashes.has(e.icon)) {
      out.push(error('asset.missing', `Icon ${e.icon} of "${e.id}" is not listed in pack.assets`, { path: `${base}.icon`, entityId: e.id }));
    }
    for (const ref of collectEntityRefs(e)) {
      if (!index.has(ref.id)) out.push(error('ref.missing', `"${e.id}" references missing entity "${ref.id}"`, { path: `${base}.${ref.path}`, entityId: e.id }));
    }
    out.push(...validateEffects(e.effects, `${base}.effects`, e.id));
    e.choices.forEach((c, j) => out.push(...choiceDiagnostics(c, e, `${base}.choices.${j}`, undefined, index.resolveClassRef)));
    if (e.type === 'class' || e.type === 'subclass') {
      e.levels.forEach((row, r) => row.choices.forEach((c, j) => out.push(...choiceDiagnostics(c, e, `${base}.levels.${r}.choices.${j}`, row.level, index.resolveClassRef))));
    }
  });

  const checkStrings = (strings: Record<string, unknown>, targetPackId: string, path: string) => {
    for (const key of Object.keys(strings)) {
      const choice = parseChoiceId(`${targetPackId}:${key}`);
      const entityKey = choice ? choice.entityId : `${targetPackId}:${key}`;
      if (parseEntityId(entityKey) === null || !index.has(entityKey)) out.push(warning('i18n.unknownKey', `Translation key "${key}" does not match an entity in ${targetPackId}`, { path: `${path}.${key}` }));
    }
  };
  if (pack.kind === 'translation' && pack.translates && pack.strings) checkStrings(pack.strings, pack.translates.id, 'strings');
  for (const [locale, strings] of Object.entries(pack.i18n)) checkStrings(strings, pack.id, `i18n.${locale}`);

  return out;
}
```

Add `export * from './content/refs.ts'; export * from './content/validate.ts';` to the barrel.

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): semantic pack validation (references, choices, assets, i18n keys)"`.

### Task 18: Localizer (content text with per-field English fallback)

**Files:**
- Create: `packages/engine/src/i18n/localizer.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/i18n/localizer.test.ts`

**Interfaces:**
- Produces: `LocalizedText { text: string; locale: string; isFallback: boolean }`, `Localizer { readonly locale: string; text(entityId: string, field: string): LocalizedText; name(entityId: string): string; choicePrompt(choiceId: string): LocalizedText }`, `createLocalizer(index: ContentIndex, locale: string): Localizer`, `baseLanguage(locale: string): string`.
- Resolution order per field: translation pack (exact locale) → translation pack (base language) → owning pack's inline `i18n` (exact) → inline (base) → English source field on the entity/choice. `isFallback` is true only when the English source was used and `locale !== 'en'`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/i18n/localizer.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { type Pack, parsePack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { createLocalizer } from '../../src/i18n/localizer.ts';

const load = (name: string): Pack => {
  const r = parsePack(JSON.parse(readFileSync(new URL(`../../../protocol/test/fixtures/packs/${name}.json`, import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(name);
  return r.pack;
};
const index = createContentIndex([load('core-mini'), load('content-mini'), load('translation-mini')]);

describe('createLocalizer', () => {
  it('uses translation packs and reports fallback per field', () => {
    const ru = createLocalizer(index, 'ru');
    expect(ru.text('core-mini:spell/fireball', 'name')).toEqual({ text: 'Огненный шар', locale: 'ru', isFallback: false });
    expect(ru.text('core-mini:class/fighter', 'name').text).toBe('Воин');
    expect(ru.text('core-mini:class/fighter', 'description')).toEqual({ text: '', locale: 'en', isFallback: true });
    expect(ru.text('core-mini:feat/alert', 'name')).toEqual({ text: 'Alert', locale: 'en', isFallback: true });
  });

  it('uses inline i18n of the owning pack and resolves regional locales to the base language', () => {
    expect(createLocalizer(index, 'ru').name('homebrew-mini:species/catfolk')).toBe('Кошколюд');
    expect(createLocalizer(index, 'ru-UA').name('core-mini:spell/fireball')).toBe('Огненный шар');
    expect(createLocalizer(index, 'uk').name('core-mini:spell/fireball')).toBe('Fireball');
  });

  it('localizes choice prompts', () => {
    const ru = createLocalizer(index, 'ru');
    expect(ru.choicePrompt('core-mini:class/fighter@1/fighting-style').text).toBe('Боевой стиль');
    expect(ru.choicePrompt('core-mini:class/fighter@1/equipment')).toEqual({ text: 'Starting equipment', locale: 'en', isFallback: true });
  });

  it('is the identity for English', () => {
    const en = createLocalizer(index, 'en');
    expect(en.text('core-mini:spell/fireball', 'name')).toEqual({ text: 'Fireball', locale: 'en', isFallback: false });
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/i18n/localizer.ts`:

```ts
import { type Choice, type Entity, type Pack, parseChoiceId, parseEntityId } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';

export interface LocalizedText {
  text: string;
  locale: string;
  isFallback: boolean;
}

export interface Localizer {
  readonly locale: string;
  text(entityId: string, field: string): LocalizedText;
  name(entityId: string): string;
  choicePrompt(choiceId: string): LocalizedText;
}

export function baseLanguage(locale: string): string {
  return locale.split('-')[0]!.toLowerCase();
}

type Strings = Record<string, Record<string, string>>;

function stripPack(id: string): string {
  const i = id.indexOf(':');
  return i === -1 ? id : id.slice(i + 1);
}

function findChoice(entity: Entity, choiceId: string): Choice | undefined {
  const direct = entity.choices.find((c) => c.id === choiceId);
  if (direct) return direct;
  if (entity.type === 'class' || entity.type === 'subclass') {
    for (const row of entity.levels) {
      const hit = row.choices.find((c) => c.id === choiceId);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function createLocalizer(index: ContentIndex, locale: string): Localizer {
  const base = baseLanguage(locale);
  const packsById = new Map<string, Pack>(index.packs().map((p) => [p.id, p]));
  /** targetPackId → locale → strings, from translation packs (later packs win) */
  const translations = new Map<string, Map<string, Strings>>();
  for (const t of index.translationPacks()) {
    if (!t.translates || !t.strings) continue;
    const byLocale = translations.get(t.translates.id) ?? new Map<string, Strings>();
    byLocale.set(t.locale, { ...(byLocale.get(t.locale) ?? {}), ...t.strings });
    translations.set(t.translates.id, byLocale);
  }

  const lookup = (packId: string, key: string, field: string): LocalizedText | undefined => {
    const tries: [string, Strings | undefined][] = [
      [locale, translations.get(packId)?.get(locale)],
      [base, translations.get(packId)?.get(base)],
      [locale, packsById.get(packId)?.i18n[locale]],
      [base, packsById.get(packId)?.i18n[base]],
    ];
    for (const [loc, strings] of tries) {
      const v = strings?.[key]?.[field];
      if (typeof v === 'string' && v.length > 0) return { text: v, locale: loc, isFallback: false };
    }
    return undefined;
  };

  const source = (text: string | undefined): LocalizedText => ({ text: text ?? '', locale: 'en', isFallback: locale !== 'en' && base !== 'en' });

  const text = (entityId: string, field: string): LocalizedText => {
    const parsed = parseEntityId(entityId);
    const entity = index.get(entityId);
    if (!parsed || !entity) return { text: '', locale: 'en', isFallback: true };
    if (base !== 'en') {
      const hit = lookup(parsed.packId, stripPack(entityId), field);
      if (hit) return hit;
    }
    const rec = entity as unknown as Record<string, unknown>;
    const v = rec[field];
    return source(typeof v === 'string' ? v : undefined);
  };

  const choicePrompt = (choiceId: string): LocalizedText => {
    const parsed = parseChoiceId(choiceId);
    const owner = parsed ? index.get(parsed.entityId) : undefined;
    const choice = owner && findChoice(owner, choiceId);
    if (!parsed || !owner || !choice) return { text: '', locale: 'en', isFallback: true };
    if (base !== 'en') {
      const hit = lookup(parseEntityId(parsed.entityId)!.packId, stripPack(choiceId), 'prompt');
      if (hit) return hit;
    }
    return source(choice.prompt);
  };

  return { locale, text, name: (id) => text(id, 'name').text, choicePrompt };
}
```

Add to the barrel.

- [ ] **Step 4: Run tests, typecheck, lint** → green.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): localizer with translation packs, inline i18n and English fallback"`.

---

### Task 19: Text normalization and search index

**Files:**
- Create: `packages/engine/src/i18n/normalize.ts`, `packages/engine/src/i18n/search.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/i18n/search.test.ts`

**Interfaces:**
- Produces: `normalizeSearchText(s: string): string` (NFD → strip combining marks → lowercase → `ё→е`, `’→'` → collapse whitespace → trim), `SearchHit { id: string; type: EntityType; name: string; score: number }`, `SearchIndex { query(text: string, opts?: { types?: EntityType[]; limit?: number }): SearchHit[] }`, `createSearchIndex(index: ContentIndex, localizer: Localizer): SearchIndex`.
- Ranking: every query word must match (prefix or substring) in the localized name **or** the English name; score = exact 100 / all-words-prefix 80 / substring 60, +5 when the localized name matched; ties broken by `Intl.Collator(localizer.locale)` on the localized name, then id. This is the only place in the engine allowed to use `Intl.Collator`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/i18n/search.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { type Pack, parsePack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { createLocalizer } from '../../src/i18n/localizer.ts';
import { normalizeSearchText } from '../../src/i18n/normalize.ts';
import { createSearchIndex } from '../../src/i18n/search.ts';

const load = (name: string): Pack => {
  const r = parsePack(JSON.parse(readFileSync(new URL(`../../../protocol/test/fixtures/packs/${name}.json`, import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(name);
  return r.pack;
};
const index = createContentIndex([load('core-mini'), load('content-mini'), load('translation-mini')]);

describe('normalizeSearchText', () => {
  it('folds case, marks, yo and apostrophes', () => {
    expect(normalizeSearchText('  Ёлка  Résumé  ’x’ ')).toBe('елка resume \'x\'');
    expect(normalizeSearchText('Ґанок')).toBe('ґанок');
  });
});

describe('createSearchIndex', () => {
  const ru = createSearchIndex(index, createLocalizer(index, 'ru'));
  const en = createSearchIndex(index, createLocalizer(index, 'en'));
  const ids = (hits: { id: string }[]) => hits.map((h) => h.id);

  it('finds by localized and by English name', () => {
    for (const q of ['fireball', 'Огненный', 'огненн', 'шар', 'fire ball', 'FIRE']) {
      expect(ids(ru.query(q)), q).toContain('core-mini:spell/fireball');
    }
    expect(ids(en.query('огненный'))).toEqual([]);
  });

  it('ranks exact > prefix > substring and filters by type', () => {
    expect(ids(en.query('fighter', { types: ['class'] }))).toEqual(['core-mini:class/fighter']);
    expect(ids(en.query('e', { types: ['species'] }))).toEqual(['core-mini:species/elf']); // catfolk has no "e"... it does not
    const hits = en.query('a', { types: ['feat'] });
    expect(hits.map((h) => h.name)).toEqual(['Alert', 'Archery']); // both prefix matches, collated; "Defense" contains no "a"
    expect(en.query('a', { limit: 1 })).toHaveLength(1);
  });

  it('returns nothing for empty or whitespace queries', () => {
    expect(en.query('   ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`packages/engine/src/i18n/normalize.ts`:

```ts
export function normalizeSearchText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
```

`packages/engine/src/i18n/search.ts`:

```ts
import type { EntityType } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import type { Localizer } from './localizer.ts';
import { normalizeSearchText } from './normalize.ts';

export interface SearchHit {
  id: string;
  type: EntityType;
  name: string;
  score: number;
}

export interface SearchOptions {
  types?: EntityType[];
  limit?: number;
}

export interface SearchIndex {
  query(text: string, opts?: SearchOptions): SearchHit[];
}

interface Entry {
  id: string;
  type: EntityType;
  name: string;
  local: string;
  english: string;
}

function matchScore(words: string[], target: string): number {
  if (target === words.join(' ')) return 100;
  const targetWords = target.split(' ');
  if (words.every((w) => targetWords.some((t) => t.startsWith(w)))) return 80;
  if (words.every((w) => target.includes(w))) return 60;
  return 0;
}

export function createSearchIndex(index: ContentIndex, localizer: Localizer): SearchIndex {
  const collator = new Intl.Collator(localizer.locale, { sensitivity: 'base', numeric: true });
  const entries: Entry[] = [];
  for (const type of ['spell', 'item', 'feat', 'feature', 'species', 'background', 'class', 'subclass', 'condition', 'skill', 'language', 'tool', 'rule', 'table'] as EntityType[]) {
    for (const e of index.byType(type)) {
      const name = localizer.name(e.id);
      entries.push({ id: e.id, type, name, local: normalizeSearchText(name), english: normalizeSearchText(e.name) });
    }
  }

  return {
    query(text, opts = {}) {
      const q = normalizeSearchText(text);
      if (q === '') return [];
      const words = q.split(' ');
      const types = opts.types ? new Set<EntityType>(opts.types) : undefined;
      const hits: SearchHit[] = [];
      for (const en of entries) {
        if (types && !types.has(en.type)) continue;
        const local = matchScore(words, en.local);
        const english = matchScore(words, en.english);
        const score = Math.max(local > 0 ? local + 5 : 0, english);
        if (score > 0) hits.push({ id: en.id, type: en.type, name: en.name, score });
      }
      hits.sort((a, b) => b.score - a.score || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
      return opts.limit !== undefined ? hits.slice(0, opts.limit) : hits;
    },
  };
}
```

The `no-restricted-*` engine lint rules do not forbid `Intl.Collator`; add a file-level comment `// Intl.Collator is permitted only in i18n/search.ts (docs/02-architecture/05-rules-engine.md)`. Add both files to the barrel.

- [ ] **Step 4: Run tests, typecheck, lint** → green. If the `'e'`-species expectation fails because "Catfolk" contains no "e" but "Elf" does — that is the intended behaviour; if Node's ICU sorts differently, adjust the expected order to what `Intl.Collator('en')` produces and keep the test.

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): search index with normalization and locale-aware ranking"`.

### Task 20: Event envelope, first character events, reducer skeleton and golden harness

**Files:**
- Create: `packages/protocol/src/events/envelope.ts`, `packages/protocol/src/events/character.ts`, `packages/protocol/src/events/index.ts`
- Create: `packages/engine/src/reduce/facts.ts`, `packages/engine/src/reduce/reducer.ts`, `packages/engine/src/version.ts`, `packages/engine/test/golden/fighter-created.json`, `packages/engine/test/golden.test.ts`, `packages/engine/test/support/golden.ts`
- Modify: both `index.ts` barrels
- Test: `packages/protocol/test/events.test.ts`, `packages/engine/test/reduce/reducer.test.ts`, `packages/engine/test/golden.test.ts`

**Interfaces:**
- Protocol produces: `ActorRoleSchema`, `StreamIdSchema` (`char:<uuid>` | `camp:<uuid>`), `EventEnvelopeSchema`, `Event` (envelope with `payload: unknown`), `EVENT_ACTORS: Record<string, ActorRole[]>`, `EVENT_PAYLOADS: Record<string /* "type@v" */, ZodType>`, payload schemas `CharacterCreatedV1`, `PackPinnedV1`, `DecisionMadeV1`, `parseEvent(input: unknown): { ok: true; event: Event } | { ok: false; issues: PackIssue[] }` (validates envelope, then payload for a known `type@v`; unknown → issue `event.unknownType`).
- Engine produces: `ENGINE_VERSION`, `Facts`, `emptyFacts(streamId: string): Facts`, `reduce(events: Event[], from?: Snapshot): Facts`, `Snapshot { seq: number; facts: Facts; engineVersion: string }`, handler registry `HANDLERS: Record<string, Handler>` where `Handler = (facts: Facts, event: Event) => Facts | string` (a string return = skip reason).
- Golden harness: `runGolden(fixture)` reading `{ name, packs: string[], events: Event[], expect: Record<path, value> }` and comparing `getPath({ facts }, path)` to the expected value.

- [ ] **Step 1: Write the failing protocol test**

`packages/protocol/test/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EVENT_ACTORS, parseEvent } from '../src/events/index.ts';

const base = {
  id: '018f6d2e-7b1a-7c3d-9e4f-5a6b7c8d9e0f',
  stream: 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f',
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'usr_1', deviceId: 'dev_1', role: 'owner' },
  v: 1,
};

describe('parseEvent', () => {
  it('accepts the three phase-1a events', () => {
    const ok = (type: string, payload: unknown) => {
      const r = parseEvent({ ...base, type, payload });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    };
    ok('character.created', { name: 'Ivan', system: 'mini', corePack: { id: 'core-mini', version: '1.0.0' }, engineVersion: '0.1.0', grammaticalGender: 'masculine' });
    ok('pack.pinned', { packId: 'core-mini', version: '1.0.0' });
    ok('decision.made', { choiceId: 'core-mini:class/fighter@1/fighting-style', selection: ['core-mini:feat/defense'] });
  });

  it('rejects unknown types, bad payloads and malformed envelopes', () => {
    expect(parseEvent({ ...base, type: 'hp.exploded', payload: {} }).ok).toBe(false);
    expect(parseEvent({ ...base, type: 'pack.pinned', payload: { packId: 'core-mini' } }).ok).toBe(false);
    expect(parseEvent({ ...base, stream: 'char:not-a-uuid', type: 'pack.pinned', payload: { packId: 'core-mini', version: '1.0.0' } }).ok).toBe(false);
    expect(parseEvent({ ...base, seq: 0, type: 'pack.pinned', payload: { packId: 'core-mini', version: '1.0.0' } }).ok).toBe(false);
  });

  it('declares allowed actors per type', () => {
    expect(EVENT_ACTORS['character.created']).toEqual(['owner']);
    expect(EVENT_ACTORS['pack.pinned']).toEqual(['owner', 'dm']);
  });
});
```

- [ ] **Step 2: Implement the protocol side**

`packages/protocol/src/events/envelope.ts`:

```ts
import { z } from 'zod';

export const ActorRoleSchema = z.enum(['owner', 'dm', 'system']);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const StreamIdSchema = z.string().regex(new RegExp(`^(char|camp):${UUID.source.slice(1, -1)}$`, 'i'));

export const EventEnvelopeSchema = z.strictObject({
  id: z.string().regex(UUID),
  stream: StreamIdSchema,
  seq: z.int().min(1).optional(),
  ts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/),
  actor: z.strictObject({ userId: z.string().min(1).max(64), deviceId: z.string().min(1).max(64), role: ActorRoleSchema }),
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  v: z.int().min(1),
  txId: z.string().regex(UUID).optional(),
  payload: z.unknown(),
});
export type Event = z.infer<typeof EventEnvelopeSchema>;
```

`packages/protocol/src/events/character.ts`:

```ts
import { z } from 'zod';
import { PackIdSchema, SlugSchema } from '../ids.ts';
import { ChoiceIdSchema } from '../pack/choice.ts';
import { SemverSchema } from '../pack/common.ts';
import { ShortTextSchema } from '../pack/enums.ts';
import type { ActorRole } from './envelope.ts';

export const GrammaticalGenderSchema = z.enum(['masculine', 'feminine', 'neuter']);

export const CharacterCreatedV1 = z.strictObject({
  name: ShortTextSchema,
  system: SlugSchema,
  corePack: z.strictObject({ id: PackIdSchema, version: SemverSchema }),
  engineVersion: SemverSchema,
  grammaticalGender: GrammaticalGenderSchema,
});
export const PackPinnedV1 = z.strictObject({ packId: PackIdSchema, version: SemverSchema, previous: SemverSchema.optional() });
export const DecisionMadeV1 = z.strictObject({
  choiceId: ChoiceIdSchema,
  selection: z.array(z.string().min(1).max(200)).max(20),
  context: z.record(z.string().max(64), z.unknown()).optional(),
});

export const EVENT_PAYLOADS: Record<string, z.ZodType> = {
  'character.created@1': CharacterCreatedV1,
  'pack.pinned@1': PackPinnedV1,
  'decision.made@1': DecisionMadeV1,
};

export const EVENT_ACTORS: Record<string, ActorRole[]> = {
  'character.created': ['owner'],
  'pack.pinned': ['owner', 'dm'],
  'decision.made': ['owner'],
};

export type CharacterCreated = z.infer<typeof CharacterCreatedV1>;
export type PackPinned = z.infer<typeof PackPinnedV1>;
export type DecisionMade = z.infer<typeof DecisionMadeV1>;
```

`packages/protocol/src/events/index.ts`:

```ts
import type { PackIssue } from '../pack/pack.ts';
import { EVENT_PAYLOADS } from './character.ts';
import { type Event, EventEnvelopeSchema } from './envelope.ts';

export * from './envelope.ts';
export * from './character.ts';

export type ParseEventResult = { ok: true; event: Event } | { ok: false; issues: PackIssue[] };

export function parseEvent(input: unknown): ParseEventResult {
  const env = EventEnvelopeSchema.safeParse(input);
  if (!env.success) return { ok: false, issues: env.error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message })) };
  const key = `${env.data.type}@${env.data.v}`;
  const payloadSchema = EVENT_PAYLOADS[key];
  if (!payloadSchema) return { ok: false, issues: [{ path: 'type', message: `event.unknownType: ${key}` }] };
  const payload = payloadSchema.safeParse(env.data.payload);
  if (!payload.success) return { ok: false, issues: payload.error.issues.map((i) => ({ path: `payload.${i.path.map(String).join('.')}`, message: i.message })) };
  return { ok: true, event: { ...env.data, payload: payload.data } };
}
```

Add `export * from './events/index.ts';` to the protocol barrel. Run the protocol tests → green. Commit: `git add packages/protocol && git commit -m "feat(protocol): event envelope, first character events, parseEvent"`.

- [ ] **Step 3: Write the failing engine tests**

`packages/engine/test/reduce/reducer.test.ts`:

```ts
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { reduce } from '../../src/reduce/reducer.ts';

const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const ev = (n: number, type: string, payload: unknown, extra: Partial<Event> = {}): Event => ({
  id: `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`,
  stream,
  seq: n,
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v: 1,
  payload,
  ...extra,
});
const created = ev(1, 'character.created', { name: 'Ivan', system: 'mini', corePack: { id: 'core-mini', version: '1.0.0' }, engineVersion: '0.1.0', grammaticalGender: 'masculine' });
const pinned = ev(2, 'pack.pinned', { packId: 'homebrew-mini', version: '1.2.0' });
const decided = ev(3, 'decision.made', { choiceId: 'core-mini:class/fighter@1/fighting-style', selection: ['core-mini:feat/defense'] });

describe('reduce', () => {
  it('folds the three events into facts', () => {
    const f = reduce([created, pinned, decided]);
    expect(f.name).toBe('Ivan');
    expect(f.pins).toEqual({ 'core-mini': '1.0.0', 'homebrew-mini': '1.2.0' });
    expect(f.decisions).toEqual({ 'core-mini:class/fighter@1/fighting-style': ['core-mini:feat/defense'] });
    expect(f.lastSeq).toBe(3);
    expect(f.skipped).toEqual([]);
  });

  it('orders by seq, applies pending (no seq) events last, and skips duplicates', () => {
    const pending = { ...decided, id: '018f6d2e-7b1a-7c3d-9e4f-aaaaaaaaaaaa', seq: undefined } as Event;
    const f = reduce([pinned, created, pending, { ...pinned }]);
    expect(f.pins['homebrew-mini']).toBe('1.2.0');
    expect(f.decisions['core-mini:class/fighter@1/fighting-style']).toEqual(['core-mini:feat/defense']);
    expect(f.skipped).toEqual([{ eventId: pinned.id, reason: 'duplicate' }]);
    expect(f.lastSeq).toBe(2);
  });

  it('never throws: unknown types and out-of-order creation are recorded as skipped', () => {
    const f = reduce([decided, ev(4, 'hp.exploded', {}), created, { ...created, id: '018f6d2e-7b1a-7c3d-9e4f-bbbbbbbbbbbb', seq: 5 }]);
    expect(f.skipped.map((s) => s.reason)).toEqual(['not-created', 'unknown-type', 'already-created']);
    expect(f.name).toBe('Ivan');
  });

  it('resumes from a snapshot', () => {
    const first = reduce([created, pinned]);
    const resumed = reduce([created, pinned, decided], { seq: 2, facts: first, engineVersion: '0.1.0' });
    expect(resumed).toEqual(reduce([created, pinned, decided]));
  });
});
```

`packages/engine/test/golden/fighter-created.json`:

```json
{
  "name": "fighter-created-with-defense",
  "packs": ["core-mini"],
  "events": [
    { "id": "018f6d2e-7b1a-7c3d-9e4f-000000000001", "stream": "char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f", "seq": 1, "ts": "2026-08-30T12:00:00.000Z",
      "actor": { "userId": "u", "deviceId": "d", "role": "owner" }, "type": "character.created", "v": 1,
      "payload": { "name": "Ivan", "system": "mini", "corePack": { "id": "core-mini", "version": "1.0.0" }, "engineVersion": "0.1.0", "grammaticalGender": "masculine" } },
    { "id": "018f6d2e-7b1a-7c3d-9e4f-000000000002", "stream": "char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f", "seq": 2, "ts": "2026-08-30T12:00:01.000Z",
      "actor": { "userId": "u", "deviceId": "d", "role": "owner" }, "type": "decision.made", "v": 1,
      "payload": { "choiceId": "core-mini:class/fighter@1/fighting-style", "selection": ["core-mini:feat/defense"] } }
  ],
  "expect": {
    "facts.name": "Ivan",
    "facts.pins.core-mini": "1.0.0",
    "facts.decisions[\"core-mini:class/fighter@1/fighting-style\"]": ["core-mini:feat/defense"],
    "facts.skipped": []
  }
}
```

`packages/engine/test/support/golden.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { type Event, type Pack, parseEvent, parsePack } from '@hk/protocol';
import { createContentIndex } from '../../src/content/index.ts';
import { reduce } from '../../src/reduce/reducer.ts';

export interface GoldenFixture {
  name: string;
  packs: string[];
  events: Event[];
  expect: Record<string, unknown>;
}

const packsDir = new URL('../../../protocol/test/fixtures/packs/', import.meta.url);
const goldenDir = new URL('../golden/', import.meta.url);

export function loadPack(name: string): Pack {
  const r = parsePack(JSON.parse(readFileSync(new URL(`${name}.json`, packsDir), 'utf8')));
  if (!r.ok) throw new Error(`fixture pack ${name}: ${r.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  return r.pack;
}

export function loadGoldens(): GoldenFixture[] {
  return readdirSync(goldenDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, goldenDir), 'utf8')) as GoldenFixture);
}

/** Path grammar: dot segments and ["quoted"] segments, e.g. facts.decisions["a:b/c@1/d"].0 */
export function getPath(root: unknown, path: string): unknown {
  const segs = [...path.matchAll(/\["((?:[^"\\]|\\.)*)"\]|([^.[\]]+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]!));
  let cur: unknown = root;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

export function runGolden(fx: GoldenFixture): { actual: Record<string, unknown>; expected: Record<string, unknown> } {
  const packs = fx.packs.map(loadPack);
  const index = createContentIndex(packs);
  if (index.diagnostics.length > 0) throw new Error(`${fx.name}: ${JSON.stringify(index.diagnostics)}`);
  const events = fx.events.map((e) => {
    const r = parseEvent(e);
    if (!r.ok) throw new Error(`${fx.name}: bad event ${JSON.stringify(r.issues)}`);
    return r.event;
  });
  const root = { facts: reduce(events) };
  const actual: Record<string, unknown> = {};
  for (const path of Object.keys(fx.expect)) actual[path] = getPath(root, path);
  return { actual, expected: fx.expect };
}
```

`packages/engine/test/golden.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadGoldens, runGolden } from './support/golden.ts';

describe('golden characters', () => {
  for (const fx of loadGoldens()) {
    it(fx.name, () => {
      const { actual, expected } = runGolden(fx);
      expect(actual).toEqual(expected);
    });
  }
});
```

- [ ] **Step 4: Run to verify failure**, then implement the engine side

`packages/engine/src/version.ts`:

```ts
export const ENGINE_VERSION = '0.1.0';
```

`packages/engine/src/reduce/facts.ts`:

```ts
export interface SkippedEvent {
  eventId: string;
  reason: string;
}

export interface Facts {
  streamId: string;
  created: boolean;
  name: string;
  system: string;
  grammaticalGender: 'masculine' | 'feminine' | 'neuter';
  createdWith: { engineVersion: string };
  pins: Record<string, string>;
  decisions: Record<string, string[]>;
  skipped: SkippedEvent[];
  lastSeq: number;
  appliedEventIds: string[];
}

export function emptyFacts(streamId: string): Facts {
  return {
    streamId,
    created: false,
    name: '',
    system: '',
    grammaticalGender: 'neuter',
    createdWith: { engineVersion: '' },
    pins: {},
    decisions: {},
    skipped: [],
    lastSeq: 0,
    appliedEventIds: [],
  };
}

export interface Snapshot {
  seq: number;
  facts: Facts;
  engineVersion: string;
}
```

`packages/engine/src/reduce/reducer.ts`:

```ts
import { type CharacterCreated, type DecisionMade, type Event, type PackPinned } from '@hk/protocol';
import { ENGINE_VERSION } from '../version.ts';
import { type Facts, type Snapshot, emptyFacts } from './facts.ts';

/** Returns the next facts, or a string reason to skip the event. Must be pure. */
export type Handler = (facts: Facts, event: Event) => Facts | string;

const requireCreated = (f: Facts): string | undefined => (f.created ? undefined : 'not-created');

export const HANDLERS: Record<string, Handler> = {
  'character.created@1': (f, e) => {
    if (f.created) return 'already-created';
    const p = e.payload as CharacterCreated;
    return {
      ...f,
      created: true,
      name: p.name,
      system: p.system,
      grammaticalGender: p.grammaticalGender,
      createdWith: { engineVersion: p.engineVersion },
      pins: { ...f.pins, [p.corePack.id]: p.corePack.version },
    };
  },
  'pack.pinned@1': (f, e) => {
    const p = e.payload as PackPinned;
    return { ...f, pins: { ...f.pins, [p.packId]: p.version } };
  },
  'decision.made@1': (f, e) => {
    const p = e.payload as DecisionMade;
    return requireCreated(f) ?? { ...f, decisions: { ...f.decisions, [p.choiceId]: [...p.selection] } };
  },
};

function orderEvents(events: Event[]): Event[] {
  const committed = events.filter((e) => e.seq !== undefined).sort((a, b) => a.seq! - b.seq!);
  const pending = events.filter((e) => e.seq === undefined);
  return [...committed, ...pending];
}

export function reduce(events: Event[], from?: Snapshot): Facts {
  let facts: Facts =
    from && from.engineVersion === ENGINE_VERSION ? structuredClone(from.facts) : emptyFacts(events[0]?.stream ?? '');
  const applied = new Set(facts.appliedEventIds);
  const startSeq = from && from.engineVersion === ENGINE_VERSION ? from.seq : 0;

  for (const e of orderEvents(events)) {
    if (e.seq !== undefined && e.seq <= startSeq) continue;
    if (applied.has(e.id)) {
      facts = { ...facts, skipped: [...facts.skipped, { eventId: e.id, reason: 'duplicate' }] };
      continue;
    }
    applied.add(e.id);
    const handler = HANDLERS[`${e.type}@${e.v}`];
    const outcome = handler ? handler(facts, e) : 'unknown-type';
    facts =
      typeof outcome === 'string'
        ? { ...facts, skipped: [...facts.skipped, { eventId: e.id, reason: outcome }] }
        : outcome;
    facts = {
      ...facts,
      lastSeq: e.seq !== undefined ? Math.max(facts.lastSeq, e.seq) : facts.lastSeq,
      appliedEventIds: [...facts.appliedEventIds, e.id],
    };
  }
  return facts;
}
```

Note on the duplicate test: the second `pinned` copy has the same `id` and `seq`; after sorting it comes right after the first and is skipped as `duplicate`. The snapshot test passes because a resumed run skips events with `seq <= from.seq` and yields identical facts (including `appliedEventIds`) — keep `appliedEventIds` in the snapshot for that reason.

Add `export * from './version.ts'; export * from './reduce/facts.ts'; export * from './reduce/reducer.ts';` to the engine barrel.

- [ ] **Step 5: Run tests, typecheck, lint** → green (golden runner reports one fixture).

- [ ] **Step 6: Commit** — `git add packages/engine && git commit -m "feat(engine): reducer skeleton with snapshots and golden-character harness"`.

### Task 21: `@hk/pack-tools` package, shared I/O, and `validate` command

**Files:**
- Create: `packages/pack-tools/package.json`, `packages/pack-tools/tsconfig.json`, `packages/pack-tools/tsconfig.build.json`, `packages/pack-tools/vitest.config.ts`, `packages/pack-tools/src/io.ts`, `packages/pack-tools/src/result.ts`, `packages/pack-tools/src/commands/validate.ts`, `packages/pack-tools/src/cli.ts`, `packages/pack-tools/src/index.ts`
- Modify: root `tsconfig.json` (reference)
- Test: `packages/pack-tools/test/validate.test.ts`

**Interfaces:**
- Produces: `CommandResult { exitCode: 0 | 1 | 2; lines: string[] }` (2 = usage/IO error), `readPackFile(path: string): unknown` (JSON or YAML by extension), `readJson(path)`, `writeJson(path, value)`, `listPackFiles(dir: string): string[]`, `loadAvailablePacks(dir?: string): { packs: Pack[]; lines: string[] }`, `formatDiagnostic(d: Diagnostic): string`, `runValidate(opts: { path: string; packsDir?: string }): CommandResult`, CLI entry `node dist/cli.js validate <pack> [--packs <dir>]`.

- [ ] **Step 1: Package skeleton**

`packages/pack-tools/package.json`:

```json
{
  "name": "@hk/pack-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "herokeep-pack": "./dist/cli.js" },
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "tsc -b tsconfig.build.json",
    "test": "vitest run",
    "cli": "node dist/cli.js"
  },
  "dependencies": { "@hk/engine": "workspace:*", "@hk/protocol": "workspace:*", "yaml": "catalog:" }
}
```

`packages/pack-tools/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "paths": { "@hk/protocol": ["../protocol/src/index.ts"], "@hk/engine": ["../engine/src/index.ts"] }
  },
  "include": ["src", "test", "vitest.config.ts", "../protocol/src", "../engine/src"]
}
```

`packages/pack-tools/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "rootDir": "src", "outDir": "dist", "tsBuildInfoFile": "dist/.tsbuildinfo" },
  "include": ["src"],
  "references": [{ "path": "../protocol/tsconfig.build.json" }, { "path": "../engine/tsconfig.build.json" }]
}
```

`packages/pack-tools/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  resolve: { alias: { '@hk/protocol': src('../protocol/src/index.ts'), '@hk/engine': src('../engine/src/index.ts') } },
  test: { name: 'pack-tools', include: ['test/**/*.test.ts'], environment: 'node' },
});
```

Add `{ "path": "packages/pack-tools/tsconfig.build.json" }` to the root `tsconfig.json` references; run `pnpm install`.

- [ ] **Step 2: Write the failing test**

`packages/pack-tools/test/validate.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runValidate } from '../src/commands/validate.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

describe('validate', () => {
  it('passes a valid core pack', () => {
    const r = runValidate({ path: join(fixtures, 'core-mini.json') });
    expect(r.exitCode).toBe(0);
    expect(r.lines.at(-1)).toMatch(/OK: core-mini@1\.0\.0/);
  });

  it('resolves dependencies from --packs and reports semantic errors', () => {
    expect(runValidate({ path: join(fixtures, 'content-mini.json'), packsDir: fixtures }).exitCode).toBe(0);
    const r = runValidate({ path: join(fixtures, 'content-mini.json') });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/error deps\.missing/);
  });

  it('reports schema issues with paths and exits 1; missing file exits 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ format: 1, id: 'x', version: '1', kind: 'content', name: 'Bad' }));
    const r = runValidate({ path: bad });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/version/);
    expect(runValidate({ path: join(dir, 'nope.json') }).exitCode).toBe(2);
  });

  it('reads YAML packs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-'));
    const y = join(dir, 'p.yaml');
    writeFileSync(y, ['format: 1', 'id: yaml-mini', 'version: 1.0.0', 'kind: content', 'system: mini', 'name: Yaml', 'dependencies:', '  - id: core-mini', '    range: ^1', 'entities: []'].join('\n'));
    expect(runValidate({ path: y, packsDir: fixtures }).exitCode).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**, then implement

`packages/pack-tools/src/result.ts`:

```ts
import type { Diagnostic } from '@hk/engine';

export interface CommandResult {
  exitCode: 0 | 1 | 2;
  lines: string[];
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = [d.path, d.entityId].filter(Boolean).join(' @ ');
  return `${d.severity} ${d.code}${where ? ` [${where}]` : ''}: ${d.message}`;
}
```

`packages/pack-tools/src/io.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { type Pack, formatIssues, parsePack } from '@hk/protocol';
import { parse as parseYaml } from 'yaml';

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function readPackFile(path: string): unknown {
  const ext = extname(path).toLowerCase();
  const text = readFileSync(path, 'utf8');
  return ext === '.yaml' || ext === '.yml' ? (parseYaml(text) as unknown) : (JSON.parse(text) as unknown);
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function listPackFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(json|ya?ml)$/i.test(f))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())
    .sort();
}

export function loadAvailablePacks(dir?: string): { packs: Pack[]; lines: string[] } {
  const packs: Pack[] = [];
  const lines: string[] = [];
  if (!dir) return { packs, lines };
  for (const file of listPackFiles(dir)) {
    try {
      const r = parsePack(readPackFile(file));
      if (r.ok) packs.push(r.pack);
      else lines.push(`skipping ${file}: ${formatIssues(r.issues)[0]}`);
    } catch (e) {
      lines.push(`skipping ${file}: ${(e as Error).message}`);
    }
  }
  return { packs, lines };
}
```

`packages/pack-tools/src/commands/validate.ts`:

```ts
import { existsSync } from 'node:fs';
import { hasErrors, validatePack } from '@hk/engine';
import { formatIssues, parsePack } from '@hk/protocol';
import { loadAvailablePacks, readPackFile } from '../io.ts';
import { type CommandResult, formatDiagnostic } from '../result.ts';

export interface ValidateOptions {
  path: string;
  packsDir?: string;
}

export function runValidate(opts: ValidateOptions): CommandResult {
  if (!existsSync(opts.path)) return { exitCode: 2, lines: [`file not found: ${opts.path}`] };
  let input: unknown;
  try {
    input = readPackFile(opts.path);
  } catch (e) {
    return { exitCode: 2, lines: [`cannot read ${opts.path}: ${(e as Error).message}`] };
  }
  const parsed = parsePack(input);
  if (!parsed.ok) return { exitCode: 1, lines: ['schema errors:', ...formatIssues(parsed.issues).map((l) => `  ${l}`)] };

  const { packs, lines } = loadAvailablePacks(opts.packsDir);
  const diagnostics = validatePack(parsed.pack, packs);
  const out = [...lines, ...diagnostics.map(formatDiagnostic)];
  const errors = hasErrors(diagnostics);
  out.push(errors ? `FAILED: ${parsed.pack.id}@${parsed.pack.version}` : `OK: ${parsed.pack.id}@${parsed.pack.version} (${parsed.pack.entities.length} entities, ${diagnostics.length} warnings)`);
  return { exitCode: errors ? 1 : 0, lines: out };
}
```

`packages/pack-tools/src/cli.ts` (subcommands are wired as they are added in Tasks 22–24; ship `validate` now):

```ts
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runValidate } from './commands/validate.ts';
import type { CommandResult } from './result.ts';

const USAGE = [
  'herokeep-pack <command> [options]',
  '  validate <pack.json|yaml> [--packs <dir>]',
  '  build <dir> [--out <file>] [--packs <dir>]',
  '  diff <a> <b>',
  '  i18n extract <pack> --locale <xx> [--out <file>]',
].join('\n');

export function main(argv: string[]): CommandResult {
  const [command, ...rest] = argv;
  if (command === 'validate') {
    const { values, positionals } = parseArgs({ args: rest, options: { packs: { type: 'string' } }, allowPositionals: true });
    const path = positionals[0];
    if (!path) return { exitCode: 2, lines: [USAGE] };
    return runValidate({ path, ...(values.packs !== undefined && { packsDir: values.packs }) });
  }
  return { exitCode: 2, lines: [USAGE] };
}

if (process.argv[1] && /cli\.(js|ts)$/.test(process.argv[1])) {
  const r = main(process.argv.slice(2));
  for (const line of r.lines) (r.exitCode === 0 ? console.log : console.error)(line);
  process.exit(r.exitCode);
}
```

`packages/pack-tools/src/index.ts`: `export * from './result.ts'; export * from './io.ts'; export * from './commands/validate.ts';`

- [ ] **Step 4: Run tests, typecheck, lint, then `pnpm build && node packages/pack-tools/dist/cli.js validate packages/protocol/test/fixtures/packs/core-mini.json`** → prints `OK: core-mini@1.0.0 …`, exit 0.

- [ ] **Step 5: Commit** — `git add packages/pack-tools tsconfig.json pnpm-lock.yaml && git commit -m "feat(pack-tools): package skeleton and validate command"`.

---

### Task 22: `build` command (folder of YAML/JSON entities → `pack.json`)

**Files:**
- Create: `packages/pack-tools/src/commands/build.ts`
- Modify: `packages/pack-tools/src/cli.ts`, `packages/pack-tools/src/index.ts`
- Test: `packages/pack-tools/test/build.test.ts`

**Interfaces:**
- Produces: `runBuild(opts: { dir: string; out?: string; packsDir?: string }): CommandResult`. Input layout: `<dir>/pack.yaml` (or `pack.json`) holding every pack field except `entities`; `<dir>/entities/**/*.{yaml,yml,json}` each containing one entity object or an array of entities. Output: `<out>` (default `<dir>/dist/pack.json`) written only when schema-valid; semantic validation runs when `--packs` is given (or always, with only the pack itself, when omitted); exit 1 on errors.

- [ ] **Step 1: Write the failing test**

`packages/pack-tools/test/build.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBuild } from '../src/commands/build.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hk-build-'));
  writeFileSync(join(dir, 'pack.yaml'), ['format: 1', 'id: yaml-pack', 'version: 0.1.0', 'kind: content', 'system: mini', 'name: Yaml pack', 'dependencies:', '  - id: core-mini', '    range: ^1'].join('\n'));
  mkdirSync(join(dir, 'entities', 'feats'), { recursive: true });
  writeFileSync(join(dir, 'entities', 'feats', 'lucky.yaml'), ['id: yaml-pack:feat/lucky', 'type: feat', 'name: Lucky', 'category: origin', 'effects:', '  - type: tag.grant', '    tag: lucky'].join('\n'));
  writeFileSync(join(dir, 'entities', 'features.json'), JSON.stringify([
    { id: 'yaml-pack:feature/a', type: 'feature', name: 'A' },
    { id: 'yaml-pack:feature/b', type: 'feature', name: 'B', grants: [{ feature: 'core-mini:feature/darkvision' }] },
  ]));
  return dir;
}

describe('build', () => {
  it('merges manifest and entity files into a validated pack.json', () => {
    const dir = scaffold();
    const r = runBuild({ dir, packsDir: fixtures });
    expect(r.exitCode, r.lines.join('\n')).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'dist', 'pack.json'), 'utf8')) as { entities: { id: string }[] };
    expect(out.entities.map((e) => e.id)).toEqual(['yaml-pack:feat/lucky', 'yaml-pack:feature/a', 'yaml-pack:feature/b']);
  });

  it('does not write output when validation fails', () => {
    const dir = scaffold();
    writeFileSync(join(dir, 'entities', 'broken.yaml'), ['id: yaml-pack:feature/c', 'type: feature', 'name: C', 'grants:', '  - feature: core-mini:feature/nope'].join('\n'));
    const r = runBuild({ dir, packsDir: fixtures, out: join(dir, 'custom.json') });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/ref\.missing/);
    expect(existsSync(join(dir, 'custom.json'))).toBe(false);
  });

  it('exits 2 without a manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-build-'));
    expect(runBuild({ dir }).exitCode).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement

`packages/pack-tools/src/commands/build.ts`:

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hasErrors, validatePack } from '@hk/engine';
import { formatIssues, parsePack } from '@hk/protocol';
import { loadAvailablePacks, readPackFile, writeJson } from '../io.ts';
import { type CommandResult, formatDiagnostic } from '../result.ts';

export interface BuildOptions {
  dir: string;
  out?: string;
  packsDir?: string;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(json|ya?ml)$/i.test(name)) out.push(p);
  }
  return out;
}

export function runBuild(opts: BuildOptions): CommandResult {
  const manifestPath = ['pack.yaml', 'pack.yml', 'pack.json'].map((f) => join(opts.dir, f)).find(existsSync);
  if (!manifestPath) return { exitCode: 2, lines: [`no pack.yaml / pack.json in ${opts.dir}`] };
  const lines: string[] = [];
  let manifest: Record<string, unknown>;
  try {
    manifest = readPackFile(manifestPath) as Record<string, unknown>;
  } catch (e) {
    return { exitCode: 2, lines: [`cannot read ${manifestPath}: ${(e as Error).message}`] };
  }
  const entities: unknown[] = [];
  for (const file of walk(join(opts.dir, 'entities'))) {
    try {
      const v = readPackFile(file);
      if (Array.isArray(v)) entities.push(...(v as unknown[]));
      else entities.push(v);
    } catch (e) {
      return { exitCode: 2, lines: [`cannot read ${file}: ${(e as Error).message}`] };
    }
  }
  const parsed = parsePack({ ...manifest, entities });
  if (!parsed.ok) return { exitCode: 1, lines: ['schema errors:', ...formatIssues(parsed.issues).map((l) => `  ${l}`)] };

  const available = loadAvailablePacks(opts.packsDir);
  lines.push(...available.lines);
  const diagnostics = validatePack(parsed.pack, available.packs);
  lines.push(...diagnostics.map(formatDiagnostic));
  if (hasErrors(diagnostics)) return { exitCode: 1, lines: [...lines, `FAILED: ${parsed.pack.id}@${parsed.pack.version}`] };

  const out = opts.out ?? join(opts.dir, 'dist', 'pack.json');
  writeJson(out, parsed.pack);
  lines.push(`wrote ${out} (${parsed.pack.entities.length} entities)`);
  return { exitCode: 0, lines };
}
```

Wire into `cli.ts` (`build <dir> [--out] [--packs]`, options `{ out: { type: 'string' }, packs: { type: 'string' } }`) and export from `index.ts`.

- [ ] **Step 3: Run tests, typecheck, lint** → green.

- [ ] **Step 4: Commit** — `git add packages/pack-tools && git commit -m "feat(pack-tools): build command (YAML/JSON entity folders to pack.json)"`.

---

### Task 23: `diff` command

**Files:**
- Create: `packages/pack-tools/src/canonical.ts`, `packages/pack-tools/src/commands/diff.ts`
- Modify: `packages/pack-tools/src/cli.ts`, `packages/pack-tools/src/index.ts`
- Test: `packages/pack-tools/test/diff.test.ts`

**Interfaces:**
- Produces: `canonicalJson(value: unknown): string` (stable key order, no whitespace), `diffPacks(a: Pack, b: Pack): PackDiff` where `PackDiff = { version: [string, string]; added: string[]; removed: string[]; changed: { id: string; fields: string[] }[]; dependencies: { added: string[]; removed: string[]; changed: string[] } }`, `runDiff(opts: { a: string; b: string }): CommandResult` (always exit 0 on success; prints a human-readable change list suitable for release notes).

- [ ] **Step 1: Write the failing test**

`packages/pack-tools/test/diff.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonical.ts';
import { runDiff } from '../src/commands/diff.ts';
import { readJson } from '../src/io.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

describe('canonicalJson', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }));
  });
});

describe('diff', () => {
  it('lists added, removed and changed entities and version/dependency changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-diff-'));
    const a = readJson(join(fixtures, 'content-mini.json')) as { version: string; entities: Record<string, unknown>[]; dependencies: { range: string }[] };
    const b = structuredClone(a);
    b.version = '1.3.0';
    b.dependencies[0]!.range = '^1.1';
    b.entities[0]!['description'] = 'Bonus to initiative (changed).';
    b.entities.push({ id: 'homebrew-mini:feature/new', type: 'feature', name: 'New' });
    b.entities.splice(1, 1); // remove catfolk
    writeFileSync(join(dir, 'a.json'), JSON.stringify(a));
    writeFileSync(join(dir, 'b.json'), JSON.stringify(b));
    const r = runDiff({ a: join(dir, 'a.json'), b: join(dir, 'b.json') });
    expect(r.exitCode).toBe(0);
    const text = r.lines.join('\n');
    expect(text).toMatch(/version: 1\.2\.0 → 1\.3\.0/);
    expect(text).toMatch(/\+ homebrew-mini:feature\/new/);
    expect(text).toMatch(/- homebrew-mini:species\/catfolk/);
    expect(text).toMatch(/~ homebrew-mini:feature\/cat-reflexes \(description\)/);
    expect(text).toMatch(/dependency changed: core-mini \^1 → \^1\.1/);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement

`packages/pack-tools/src/canonical.ts`:

```ts
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
```

`packages/pack-tools/src/commands/diff.ts`:

```ts
import { existsSync } from 'node:fs';
import { type Entity, type Pack, formatIssues, parsePack } from '@hk/protocol';
import { canonicalJson } from '../canonical.ts';
import { readPackFile } from '../io.ts';
import type { CommandResult } from '../result.ts';

export interface PackDiff {
  version: [string, string];
  added: string[];
  removed: string[];
  changed: { id: string; fields: string[] }[];
  dependencies: { added: string[]; removed: string[]; changed: string[] };
}

function changedFields(a: Entity, b: Entity): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => canonicalJson((a as Record<string, unknown>)[k]) !== canonicalJson((b as Record<string, unknown>)[k])).sort();
}

export function diffPacks(a: Pack, b: Pack): PackDiff {
  const ea = new Map(a.entities.map((e) => [e.id, e]));
  const eb = new Map(b.entities.map((e) => [e.id, e]));
  const added = [...eb.keys()].filter((id) => !ea.has(id)).sort();
  const removed = [...ea.keys()].filter((id) => !eb.has(id)).sort();
  const changed = [...ea.keys()]
    .filter((id) => eb.has(id))
    .map((id) => ({ id, fields: changedFields(ea.get(id)!, eb.get(id)!) }))
    .filter((c) => c.fields.length > 0)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  const da = new Map(a.dependencies.map((d) => [d.id, d.range]));
  const db = new Map(b.dependencies.map((d) => [d.id, d.range]));
  return {
    version: [a.version, b.version],
    added,
    removed,
    changed,
    dependencies: {
      added: [...db.keys()].filter((id) => !da.has(id)).map((id) => `${id} ${db.get(id)}`),
      removed: [...da.keys()].filter((id) => !db.has(id)).map((id) => `${id} ${da.get(id)}`),
      changed: [...da.keys()].filter((id) => db.has(id) && db.get(id) !== da.get(id)).map((id) => `${id} ${da.get(id)} → ${db.get(id)}`),
    },
  };
}

export function runDiff(opts: { a: string; b: string }): CommandResult {
  const load = (p: string): Pack | string => {
    if (!existsSync(p)) return `file not found: ${p}`;
    const r = parsePack(readPackFile(p));
    return r.ok ? r.pack : `${p}: ${formatIssues(r.issues)[0]}`;
  };
  const a = load(opts.a);
  const b = load(opts.b);
  if (typeof a === 'string' || typeof b === 'string') return { exitCode: 2, lines: [typeof a === 'string' ? a : (b as string)] };
  const d = diffPacks(a, b);
  const lines = [
    `${a.id}: version: ${d.version[0]} → ${d.version[1]}`,
    ...d.dependencies.added.map((x) => `dependency added: ${x}`),
    ...d.dependencies.removed.map((x) => `dependency removed: ${x}`),
    ...d.dependencies.changed.map((x) => `dependency changed: ${x}`),
    ...d.added.map((id) => `+ ${id}`),
    ...d.removed.map((id) => `- ${id}`),
    ...d.changed.map((c) => `~ ${c.id} (${c.fields.join(', ')})`),
    `${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed`,
  ];
  return { exitCode: 0, lines };
}
```

Wire `diff <a> <b>` into `cli.ts`; export from `index.ts`.

- [ ] **Step 3: Run tests, typecheck, lint** → green.

- [ ] **Step 4: Commit** — `git add packages/pack-tools && git commit -m "feat(pack-tools): diff command with canonical JSON comparison"`.

---

### Task 24: `i18n extract` command (translation-pack skeleton)

**Files:**
- Create: `packages/pack-tools/src/commands/i18n-extract.ts`
- Modify: `packages/pack-tools/src/cli.ts`, `packages/pack-tools/src/index.ts`
- Test: `packages/pack-tools/test/i18n-extract.test.ts`

**Interfaces:**
- Produces: `collectTranslatableStrings(pack: Pack): Record<string, Record<string, string>>` (key = `type/slug` or choice id without pack prefix; fields: entity `name`, `description`; choice `prompt`; `feature.text` / `action.define` / `resource.define` effect texts as `effects.<i>.name` / `effects.<i>.description`), `buildTranslationSkeleton(pack: Pack, locale: string): string` (YAML text; every field is an empty string preceded by a `# en: <source>` comment), `runI18nExtract(opts: { path: string; locale: string; out?: string }): CommandResult` (default out `<pack-dir>/<packId>-<locale>.yaml`). The produced file validates as a translation pack (empty strings are allowed and are treated as "untranslated" by the localizer).

- [ ] **Step 1: Write the failing test**

`packages/pack-tools/test/i18n-extract.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePack } from '@hk/protocol';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { collectTranslatableStrings, runI18nExtract } from '../src/commands/i18n-extract.ts';
import { readJson } from '../src/io.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

describe('i18n extract', () => {
  it('collects names, descriptions, prompts and effect texts', () => {
    const r = parsePack(readJson(join(fixtures, 'core-mini.json')));
    if (!r.ok) throw new Error();
    const s = collectTranslatableStrings(r.pack);
    expect(s['spell/fireball']).toEqual({ name: 'Fireball', description: 'A bright streak flashes.' });
    expect(s['class/fighter@1/fighting-style']).toEqual({ prompt: 'Fighting Style' });
    expect(s['feature/action-surge']).toMatchObject({ 'effects.0.name': 'Action Surge', 'effects.0.description': 'Take one additional action.' });
    expect(s['feature/second-wind']).toMatchObject({ 'effects.0.name': 'Second Wind' });
    expect(s['system/mini@0/ability-scores']).toEqual({ prompt: 'Ability scores' });
  });

  it('writes a YAML skeleton that validates as a translation pack', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-i18n-'));
    const out = join(dir, 'core-mini-uk.yaml');
    const r = runI18nExtract({ path: join(fixtures, 'core-mini.json'), locale: 'uk', out });
    expect(r.exitCode, r.lines.join('\n')).toBe(0);
    const text = readFileSync(out, 'utf8');
    expect(text).toMatch(/# en: Fireball\n\s+name: ""/);
    const parsed = parsePack(parseYaml(text));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack).toMatchObject({ kind: 'translation', locale: 'uk', translates: { id: 'core-mini', range: '^1' }, id: 'core-mini-uk' });
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement

`packages/pack-tools/src/commands/i18n-extract.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type Choice, type Entity, type Pack, formatIssues, parsePack } from '@hk/protocol';
import { readPackFile } from '../io.ts';
import type { CommandResult } from '../result.ts';

type Strings = Record<string, Record<string, string>>;

const strip = (id: string) => id.slice(id.indexOf(':') + 1);

function choiceStrings(out: Strings, c: Choice): void {
  out[strip(c.id)] = { prompt: c.prompt };
}

export function collectTranslatableStrings(pack: Pack): Strings {
  const out: Strings = {};
  const add = (key: string, field: string, text: string | undefined) => {
    if (!text) return;
    (out[key] ??= {})[field] = text;
  };
  for (const e of pack.entities as Entity[]) {
    const key = strip(e.id);
    add(key, 'name', e.name);
    add(key, 'description', e.description);
    e.effects.forEach((ef, i) => {
      if (ef.type === 'feature.text' || ef.type === 'action.define') {
        add(key, `effects.${i}.name`, ef.name);
        add(key, `effects.${i}.description`, ef.description);
      } else if (ef.type === 'resource.define') add(key, `effects.${i}.name`, ef.name);
    });
    e.choices.forEach((c) => choiceStrings(out, c));
    if (e.type === 'class' || e.type === 'subclass') e.levels.forEach((row) => row.choices.forEach((c) => choiceStrings(out, c)));
  }
  return out;
}

const q = (s: string) => JSON.stringify(s); // JSON strings are valid YAML double-quoted scalars

export function buildTranslationSkeleton(pack: Pack, locale: string): string {
  const major = pack.version.split('.')[0];
  const lines = [
    'format: 1',
    `id: ${q(`${pack.id}-${locale}`)}`,
    `version: ${q(pack.version)}`,
    'kind: translation',
    ...(pack.system ? [`system: ${q(pack.system)}`] : []),
    `locale: ${q(locale)}`,
    `name: ${q(`${pack.name} — ${locale}`)}`,
    'translates:',
    `  id: ${q(pack.id)}`,
    `  range: ${q(`^${major}`)}`,
    'strings:',
  ];
  const strings = collectTranslatableStrings(pack);
  for (const key of Object.keys(strings).sort()) {
    lines.push(`  ${q(key)}:`);
    for (const [field, source] of Object.entries(strings[key]!)) {
      for (const srcLine of source.split('\n')) lines.push(`    # en: ${srcLine}`);
      lines.push(`    ${q(field)}: ""`);
    }
  }
  return lines.join('\n') + '\n';
}

export function runI18nExtract(opts: { path: string; locale: string; out?: string }): CommandResult {
  if (!existsSync(opts.path)) return { exitCode: 2, lines: [`file not found: ${opts.path}`] };
  const r = parsePack(readPackFile(opts.path));
  if (!r.ok) return { exitCode: 1, lines: ['schema errors:', ...formatIssues(r.issues)] };
  const out = opts.out ?? join(dirname(opts.path), `${r.pack.id}-${opts.locale}.yaml`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildTranslationSkeleton(r.pack, opts.locale));
  const count = Object.values(collectTranslatableStrings(r.pack)).reduce((n, f) => n + Object.keys(f).length, 0);
  return { exitCode: 0, lines: [`wrote ${basename(out)} (${count} strings to translate)`] };
}
```

Wire `i18n extract <pack> --locale <xx> [--out <file>]` into `cli.ts` (the first positional after `i18n` must be `extract`; options `{ locale: { type: 'string' }, out: { type: 'string' } }`; missing `--locale` → exit 2 with usage). Export from `index.ts`.

- [ ] **Step 3: Run tests, typecheck, lint; then `pnpm build` and smoke the CLI end to end**:

```bash
node packages/pack-tools/dist/cli.js i18n extract packages/protocol/test/fixtures/packs/core-mini.json --locale uk --out /tmp/core-mini-uk.yaml
node packages/pack-tools/dist/cli.js validate /tmp/core-mini-uk.yaml --packs packages/protocol/test/fixtures/packs
node packages/pack-tools/dist/cli.js diff packages/protocol/test/fixtures/packs/core-mini.json packages/protocol/test/fixtures/packs/core-mini.json
```
Expected: three exit codes 0; the validate run prints `OK: core-mini-uk@1.0.0`.

- [ ] **Step 4: Commit** — `git add packages/pack-tools && git commit -m "feat(pack-tools): i18n extract command producing translation-pack skeletons"`.

### Task 25: `derive` skeleton — outstanding creation-time choices

**Files:**
- Create: `packages/engine/src/derive/sheet.ts`, `packages/engine/src/derive/choices.ts`, `packages/engine/src/derive/index.ts`
- Modify: `packages/engine/src/index.ts`, `packages/engine/test/support/golden.ts` (root becomes `{ facts, sheet }`), `packages/engine/test/golden/fighter-created.json`, `packages/protocol/test/fixtures/packs/core-mini.json` (two more system choices)
- Test: `packages/engine/test/derive/choices.test.ts`, golden

**Interfaces:**
- Produces: `ChoiceRequest { choiceId: string; ownerId: string; count: number }`, `Sheet { name: string; system: string; level: number; classes: { classId: string; level: number }[]; pins: Record<string, string>; outstandingChoices: ChoiceRequest[]; issues: Diagnostic[] }`, `findChoice(index: ContentIndex, choiceId: string): { owner: Entity; choice: Choice } | undefined`, `outstandingChoices(facts: Facts, index: ContentIndex): ChoiceRequest[]`, `derive(facts: Facts, index: ContentIndex): Sheet`.
- Convention (data, not code): a system's composition slot `s` with `at: 'creation'` is asked through the choice with id `${system.id}@0/${s.id}` declared in the system entity's `choices`; a missing one yields warning `system.slotChoiceMissing`. Creation-time choices of *chosen* composition entities (e.g. a species' lineage choice) are asked too. Class-level choices, levels and everything else on the Sheet arrive in Phase 1b.

- [ ] **Step 1: Extend the fixture** — in `core-mini.json`, add to the system entity's `choices` array:

```json
{ "id": "core-mini:system/mini@0/species", "prompt": "Species", "at": { "kind": "creation" }, "pick": { "query": { "type": "species" } } },
{ "id": "core-mini:system/mini@0/background", "prompt": "Background", "at": { "kind": "creation" }, "pick": { "query": { "type": "background" } } }
```

Re-run `pnpm --filter @hk/protocol build:schema` is **not** needed (schema unchanged); run the protocol and pack-tools tests — the i18n-extract test's string count is unaffected (it asserts specific keys only).

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/derive/choices.test.ts`:

```ts
import { type Event, type Pack, parsePack } from '@hk/protocol';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { reduce } from '../../src/reduce/reducer.ts';

const load = (name: string): Pack => {
  const r = parsePack(JSON.parse(readFileSync(new URL(`../../../protocol/test/fixtures/packs/${name}.json`, import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(name);
  return r.pack;
};
const index = createContentIndex([load('core-mini'), load('content-mini')]);
const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const ev = (n: number, type: string, payload: unknown): Event => ({
  id: `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`, stream, seq: n, ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' }, type, v: 1, payload,
});
const created = ev(1, 'character.created', { name: 'Ivan', system: 'mini', corePack: { id: 'core-mini', version: '1.0.0' }, engineVersion: '0.1.0', grammaticalGender: 'masculine' });

describe('derive (1a skeleton)', () => {
  it('lists every undecided creation-time choice, sorted by id', () => {
    const sheet = derive(reduce([created]), index);
    expect(sheet.level).toBe(0);
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).toEqual([
      'core-mini:system/mini@0/ability-scores',
      'core-mini:system/mini@0/background',
      'core-mini:system/mini@0/species',
    ]);
    expect(sheet.issues).toEqual([]);
  });

  it('drops decided choices and adds the chosen entity's own creation choices', () => {
    const decided = ev(2, 'decision.made', { choiceId: 'core-mini:system/mini@0/species', selection: ['homebrew-mini:species/catfolk'] });
    const sheet = derive(reduce([created, decided]), index);
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).toEqual(['core-mini:system/mini@0/ability-scores', 'core-mini:system/mini@0/background']);
  });

  it('reports unknown decisions and missing slot choices as issues', () => {
    const bogus = ev(2, 'decision.made', { choiceId: 'core-mini:system/mini@0/nope', selection: ['x'] });
    expect(derive(reduce([created, bogus]), index).issues.map((i) => i.code)).toEqual(['decision.unknownChoice']);
    const core = load('core-mini');
    const sys = core.entities.find((e) => e.type === 'system')!;
    sys.choices = sys.choices.filter((c) => !c.id.endsWith('/background'));
    const sheet = derive(reduce([created]), createContentIndex([core]));
    expect(sheet.issues.map((i) => i.code)).toEqual(['system.slotChoiceMissing']);
  });
});
```

Golden fixture: add to `expect` in `fighter-created.json`:

```json
"sheet.level": 0,
"sheet.outstandingChoices": [
  { "choiceId": "core-mini:system/mini@0/ability-scores", "ownerId": "core-mini:system/mini", "count": 1 },
  { "choiceId": "core-mini:system/mini@0/background", "ownerId": "core-mini:system/mini", "count": 1 },
  { "choiceId": "core-mini:system/mini@0/species", "ownerId": "core-mini:system/mini", "count": 1 }
],
"sheet.issues": []
```

and in `test/support/golden.ts` change the root to `const facts = reduce(events); const root = { facts, sheet: derive(facts, index) };` (import `derive` from `../../src/derive/index.ts`).

- [ ] **Step 3: Run to verify failure**, then implement

`packages/engine/src/derive/sheet.ts`:

```ts
import type { Diagnostic } from '../diagnostics.ts';

export interface ChoiceRequest {
  choiceId: string;
  ownerId: string;
  count: number;
}

export interface Sheet {
  name: string;
  system: string;
  level: number;
  classes: { classId: string; level: number }[];
  pins: Record<string, string>;
  outstandingChoices: ChoiceRequest[];
  issues: Diagnostic[];
}
```

`packages/engine/src/derive/choices.ts`:

```ts
import { type Choice, type Entity, parseChoiceId } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import type { Facts } from '../reduce/facts.ts';
import type { ChoiceRequest } from './sheet.ts';

export function findChoice(index: ContentIndex, choiceId: string): { owner: Entity; choice: Choice } | undefined {
  const parsed = parseChoiceId(choiceId);
  const owner = parsed && index.get(parsed.entityId);
  if (!owner) return undefined;
  const top = owner.choices.find((c) => c.id === choiceId);
  if (top) return { owner, choice: top };
  if (owner.type === 'class' || owner.type === 'subclass') {
    for (const row of owner.levels) {
      const hit = row.choices.find((c) => c.id === choiceId);
      if (hit) return { owner, choice: hit };
    }
  }
  return undefined;
}

const byChoiceId = (a: ChoiceRequest, b: ChoiceRequest) => (a.choiceId < b.choiceId ? -1 : a.choiceId > b.choiceId ? 1 : 0);

export function creationChoices(facts: Facts, index: ContentIndex): { requests: ChoiceRequest[]; issues: Diagnostic[] } {
  const issues: Diagnostic[] = [];
  const system = index.system();
  const asked: Choice[] = [];
  const owners = new Map<Choice, Entity>();
  const push = (owner: Entity, c: Choice) => {
    asked.push(c);
    owners.set(c, owner);
  };

  for (const c of system.choices) if (c.at.kind === 'creation') push(system, c);
  for (const slot of system.compositionSlots) {
    if (slot.at !== 'creation') continue;
    const id = `${system.id}@0/${slot.id}`;
    if (!system.choices.some((c) => c.id === id)) {
      issues.push(warning('system.slotChoiceMissing', `System declares slot "${slot.id}" but no choice "${id}"`, { entityId: system.id }));
      continue;
    }
    for (const chosenId of facts.decisions[id] ?? []) {
      const chosen = index.get(chosenId);
      if (!chosen) continue; // reported by validation elsewhere
      for (const c of chosen.choices) if (c.at.kind === 'creation') push(chosen, c);
    }
  }

  const requests = asked
    .filter((c) => facts.decisions[c.id] === undefined)
    .map((c) => ({ choiceId: c.id, ownerId: owners.get(c)!.id, count: c.count }))
    .sort(byChoiceId);
  return { requests, issues };
}
```

`packages/engine/src/derive/index.ts`:

```ts
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import type { Facts } from '../reduce/facts.ts';
import { creationChoices, findChoice } from './choices.ts';
import type { Sheet } from './sheet.ts';

export * from './sheet.ts';
export { findChoice } from './choices.ts';

export function outstandingChoices(facts: Facts, index: ContentIndex) {
  return creationChoices(facts, index).requests;
}

export function derive(facts: Facts, index: ContentIndex): Sheet {
  const issues: Diagnostic[] = [];
  for (const choiceId of Object.keys(facts.decisions).sort()) {
    if (!findChoice(index, choiceId)) issues.push(warning('decision.unknownChoice', `Decision for unknown choice "${choiceId}"`));
  }
  const creation = creationChoices(facts, index);
  issues.push(...creation.issues);
  return {
    name: facts.name,
    system: facts.system,
    level: 0,
    classes: [],
    pins: { ...facts.pins },
    outstandingChoices: creation.requests,
    issues,
  };
}
```

Add `export * from './derive/index.ts';` to the engine barrel.

- [ ] **Step 4: Run tests, typecheck, lint** → green (golden now checks `sheet.*` paths too).

- [ ] **Step 5: Commit** — `git add packages/engine packages/protocol && git commit -m "feat(engine): derive skeleton with outstanding creation-time choices"`.

---

### Task 26: Wrap-up — repository docs, first push, tag

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Document the CLI and the plan location** — append to `README.md`:

```markdown
## Pack tools
`pnpm build && node packages/pack-tools/dist/cli.js <command>` — `validate`, `build`, `diff`, `i18n extract` (see `docs/02-architecture/04-content-packs.md`).

## Plans
Implementation plans live in `docs/superpowers/plans/`; the current one is `2026-08-30-phase-1a-foundation-protocol-engine.md`.
```

Add to `CLAUDE.md` under Commands: `pnpm --filter @hk/protocol build:schema` (after any schema change; CI fails on drift) and `node packages/pack-tools/dist/cli.js validate <pack> --packs <dir>`.

- [ ] **Step 2: Full verification** — `pnpm check && pnpm build` must be green from a clean checkout (`git stash -u` any stray files first).

- [ ] **Step 3: Publish** — the owner decided on a public repository. If the `gh` CLI is authenticated: `gh repo create herokeep --public --source . --push`; otherwise create the empty repo in the GitHub UI and `git remote add origin … && git push -u origin main`. Confirm the `ci` workflow passes on GitHub (Actions tab).

- [ ] **Step 4: Tag and commit** — `git tag -a v0.1.0-plan1 -m "Phase 1a plan 1: foundation, protocol, engine core, pack-tools" && git push --tags`.

---

## Self-review (performed 2026-08-30 while writing this plan)

**Spec coverage** (`docs/03-roadmap/phase-1-solo-builder.md` § 1a, deliverables owned by this plan):

| Deliverable | Tasks | Notes |
|-------------|-------|-------|
| 1 Monorepo, lint/format/test/build, CI | 1, 26 | `CLAUDE.md` created here as the docs allow for the first implementation session |
| 2 `@hk/protocol`: pack schema, JSON Schema export, fixtures | 2–9 | complete |
| 2 event envelope + Phase-1 event catalog | 20 | **Scoped down deliberately:** the envelope, the `type@v` payload registry, actor table and `parseEvent` are complete; only the three events the 1a reducer needs are defined. The remaining Phase-1 events (`hp.changed`, `slot.spent`, …) are added in the 1b plan together with their reducer handlers — adding entries to `EVENT_PAYLOADS`/`EVENT_ACTORS`/`HANDLERS` requires no structural change. |
| 2 bundle manifest (`.hero` export) | — | **Deferred to the 1b plan** (export/import is a 1b deliverable; nothing in 1a consumes it). |
| 3 engine: content index, formulas, predicates, effects registry, localizer, search | 10–19 | complete; effect *appliers* are 1b by spec |
| 3 `reduce`/`derive` skeletons + golden harness | 20, 25 | complete |
| 5 `pack-tools` validate / build / diff / i18n extract | 21–24 | complete |
| 4, 6, 7, 8 (SRD import, tokens/components, PWA shell, Library view) | — | plans 2 and 3 |

**Placeholder scan:** no TBD/TODO/"similar to Task N"; every code step has code; every referenced symbol is defined in an earlier task (checked: `hasErrors` T10, `formatIssues` T8, `parseChoiceId` T5, `EntityQuery` T5/T16, `collectPredicateFormulas` T13 → T14, `Pins` T15 → T16, `findChoice` T25 uses the same lookup as the localizer in T18).

**Type consistency fixes applied while reviewing:** Task 16's pin test now pins a version that does not exist (`9.9.9`) so `deps.pinMissing` is actually produced; Task 19's feat-ranking expectation lists only names that contain an "a" (`Alert`, `Archery`).

**Known judgement calls for the executor:** Zod 4 API names that may differ by minor version (`z.int()`, `.superRefine`, getter-based recursion) each carry an inline fallback in the task text; `semver`/`yaml`/`@types/node` versions are resolved at first install (Task 1).

## What comes next

- **Plan 2 — SRD 5.2.1 content import** (`packages/content`): open5e `srd-2024` JSON → `srd-5e-2024` core pack in this vocabulary, `icons.json`, attribution, CI validation via `herokeep-pack validate`.
- **Plan 3 — Angular Library PWA** (`apps/web`, `packages/ui-tokens`): shell, tokens/components, Transloco `en/ru/uk`, service worker, Library browse/search using `createContentIndex` + `createLocalizer` + `createSearchIndex`, sample RU translation pack.
- Then the **Phase 1b plan** (solo builder & play): remaining events and reducer handlers, effect appliers, full `derive`, wizard, sheet, export bundle.
