// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/schema/*.json', 'apps/web/**']),
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
        {
          object: 'Math',
          property: 'random',
          message: 'Engine code must be deterministic; use dice/ with injectable RNG.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Engine code must be deterministic.' },
      ],
    },
  },
  {
    // Locale-dependent ops restricted outside i18n/ (docs/02-architecture/05-rules-engine.md)
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/dice/**', 'packages/engine/src/i18n/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Engine code must be deterministic.' },
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: 'Locale-dependent string ops only in i18n/.',
        },
        {
          selector: 'CallExpression[callee.property.name=/^toLocale/]',
          message: 'Locale-dependent string ops only in i18n/.',
        },
        { selector: "MemberExpression[object.name='Intl']", message: 'Intl only in i18n/.' },
      ],
    },
  },
  {
    // apps/api core-boundary contract (docs/02-architecture/10-backend-architecture.md
    // §Layout; ADR-014's ports/adapters split): `src/core/**` is runtime-agnostic and may
    // depend only on `./ports` and `@hk/protocol`, never on a specific adapter's runtime or
    // driver. Adapters (src/adapters/{cloudflare,node}/) are the only place these may be
    // imported.
    files: ['apps/api/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['cloudflare:*'], message: 'src/core is runtime-agnostic; adapters own cloudflare:* imports.' },
            { group: ['node:*'], message: 'src/core is runtime-agnostic; adapters own node:* imports.' },
          ],
          paths: [
            { name: 'ws', message: 'src/core is runtime-agnostic; the Node adapter owns ws.' },
            { name: 'better-sqlite3', message: 'src/core is runtime-agnostic; the Node adapter owns better-sqlite3.' },
            {
              name: 'drizzle-orm/d1',
              message: 'src/core is runtime-agnostic; the Cloudflare adapter owns drizzle-orm/d1.',
            },
            {
              name: 'drizzle-orm/better-sqlite3',
              message: 'src/core is runtime-agnostic; the Node adapter owns drizzle-orm/better-sqlite3.',
            },
          ],
        },
      ],
    },
  },
  {
    // Root-level orchestration scripts (`scripts/dev.mjs`) run under plain Node, not a bundler
    // with ambient globals baked in — `process`/`console` are real Node globals, just not ones
    // `js.configs.recommended`'s `no-undef` knows about without them being named explicitly.
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    // `test/conformance/cloudflare.conformance.test.ts` (task 9) is covered by
    // `test/adapters/cloudflare/tsconfig.json`'s `include` (a parent-relative glob — see that
    // file's own comment), but typescript-eslint's default `projectService: true` (the top-level
    // config above) discovers a file's program by walking UP from the file's own directory, which
    // never reaches a SIBLING directory's tsconfig — `apps/api/test/conformance` is not a
    // descendant of `apps/api/test/adapters/cloudflare`. An explicit `project` array (rather than
    // `projectService`) has no such ancestry requirement: it just loads the named tsconfig and
    // matches the file against its `include`, which already lists this file by its actual path.
    files: ['apps/api/test/conformance/cloudflare.conformance.test.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['apps/api/test/adapters/cloudflare/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // `test/adapters/cloudflare/tsconfig.json` deliberately excludes this ONE file (its own doc
    // comment: workers-types' global `URL`/`Response`/etc. conflict with `node:url`'s own types
    // the moment it imports `fileURLToPath` — it runs under plain Node, not workerd) and neither
    // does `apps/api/tsconfig.json` (which excludes the whole `test/adapters/cloudflare`
    // directory) — so no project covers it for type-aware linting; disable that here rather than
    // contort a tsconfig around one config file with no runtime-agnostic-core-style correctness
    // obligation of its own.
    files: ['apps/api/test/adapters/cloudflare/vitest.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
]);
