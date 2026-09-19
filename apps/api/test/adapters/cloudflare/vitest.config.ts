/**
 * The pool-workers vitest project (task-8-brief: "gets its OWN vitest project/config ... so its
 * runtime settings don't disturb the existing projects"). Deliberately NOT merged into the root
 * `vitest.config.ts`'s `projects` array or `apps/api/vitest.config.ts`'s plain-Node `test` block:
 * `@cloudflare/vitest-pool-workers` replaces vitest's runner with one that executes test code
 * INSIDE the actual `workerd` runtime (a fundamentally different execution environment — no
 * `node:*`, real Durable Objects/D1, `cloudflare:test` globals), so it gets its own `vitest run`
 * invocation (`apps/api/package.json`'s `test:cloudflare` script) rather than sharing a process
 * with the plain-Node `api` project. Root wiring (`pnpm check`'s gate) is `apps/api/package.json`'s
 * `test:cloudflare` script, invoked from the repo root's `test` script — see that file's comment.
 *
 * `@cloudflare/vitest-pool-workers@0.22.0`'s current (Vitest-4-compatible) configuration surface
 * is the `cloudflareTest` PLUGIN (not the older `defineWorkersConfig`/`poolOptions.workers` shape,
 * which predates this package's Vitest 4 support) — verified against the installed 0.22.0 package
 * at execution time (2026-09-19); see task-8-report.md for the version-resolution write-up.
 */
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../../../src/core/db/migrations', import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // `readD1Migrations` reads real files from disk — only possible in this Node-side config
      // function, never inside the workerd test runtime itself (`apply-migrations.ts`'s doc
      // comment explains why the parsed result is threaded in as a binding instead).
      const migrations = await readD1Migrations(migrationsDir);
      return {
        wrangler: { configPath: fileURLToPath(new URL('../../../wrangler.jsonc', import.meta.url)) },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Fixed TEST-ONLY secrets (Global Constraints: "conformance/unit tests use fixed test
            // values") — `wrangler.jsonc` declares no `vars`/`SESSION_PEPPER` etc. (real deploys
            // use `wrangler secret put`/`.dev.vars`, per `.dev.vars.example`), so the pool's own
            // `miniflare.bindings` is this suite's equivalent of Node's `server.test.ts` setting
            // `process.env['SESSION_PEPPER']` directly before booting its own server.
            SESSION_PEPPER: 'test-only-cloudflare-pool-session-pepper',
            SALT_HMAC_KEY: 'test-only-cloudflare-pool-salt-hmac-key',
            APP_ORIGIN: 'https://herokeep.test',
          },
        },
      };
    }),
  ],
  // Pinned explicitly: `vitest run --config <path>` run from `apps/api` (this project's
  // `test:cloudflare` script) otherwise resolves `root` from the CURRENT WORKING DIRECTORY, not
  // this config file's own directory — without this, `include` below matched every `*.test.ts`
  // under the WHOLE `apps/api` tree (the plain-Node suite's files included), each one failing to
  // start under the cloudflare-pool worker. Verified at execution time (task-8-report.md).
  root: here,
  resolve: {
    // Same alias `apps/api/vitest.config.ts` uses, for the same reason: `@hk/protocol`'s
    // package.json resolves to its BUILT `dist/index.js` by default, which only reflects the
    // last `pnpm --filter @hk/protocol build` — not necessarily current source (verified at
    // execution time: the checked-in `dist/` here predates Task 1's `sync/` module, so
    // `parseClientMessage` etc. were simply missing from it at runtime, a real failure caught by
    // this suite's own tests, not a theoretical one). Aliasing straight to source keeps this
    // suite (like the plain-Node one) correct regardless of whether `dist/` has been rebuilt.
    alias: { '@hk/protocol': fileURLToPath(new URL('../../../../../packages/protocol/src/index.ts', import.meta.url)) },
  },
  test: {
    name: 'api-cloudflare',
    // Task 9's `test/conformance/cloudflare.conformance.test.ts` lives OUTSIDE this directory (the
    // brief's required path — shared with the Node runner's sibling file and the adapter-agnostic
    // `scenarios.ts` table) but must run under THIS pool-workers project, not the plain-Node one
    // (it imports `cloudflare:test`) — included via a parent-relative glob alongside the normal
    // in-directory one.
    include: ['**/*.test.ts', '../../conformance/cloudflare.conformance.test.ts'],
    setupFiles: ['./apply-migrations.ts'],
  },
});
