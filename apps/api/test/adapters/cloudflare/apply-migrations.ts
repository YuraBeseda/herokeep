/**
 * Runs INSIDE the workerd test runtime (a `test.setupFiles` entry, `vitest.config.ts`) — applies
 * the SAME committed D1 migrations (`src/core/db/migrations`, `wrangler.jsonc`'s `d1_databases[].
 * migrations_dir`) the Node adapter applies at startup and `wrangler d1 migrations apply` applies
 * at deploy time (doc-10 §Accounts database), so every test in this suite starts against a
 * schema-complete, empty D1 database — task-8-brief step 1's "D1 migrations apply" smoke,
 * satisfied as a setup precondition every other test in the suite also depends on.
 *
 * `TEST_MIGRATIONS` is computed on the NODE side (`vitest.config.ts`'s async `cloudflareTest`
 * factory calls `readD1Migrations`, which needs real filesystem access workerd doesn't have) and
 * threaded in as an extra miniflare binding — `applyD1Migrations` (the `cloudflare:test` runtime
 * half) then just replays that already-parsed migration content against `env.DB`.
 */
import { applyD1Migrations } from 'cloudflare:test';
import { env } from './typed-env.ts';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
