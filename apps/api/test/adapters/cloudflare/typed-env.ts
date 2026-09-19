/**
 * A typed wrapper around `cloudflare:test`'s `env` (real `Env` + the one extra `TEST_MIGRATIONS`
 * binding `vitest.config.ts`'s `cloudflareTest` factory injects). `cloudflare:test` types `env`
 * against the global `Cloudflare.Env` namespace (`@cloudflare/vitest-pool-workers`'s own
 * `types/cloudflare-test.d.ts`; see git history for `env.d.ts`, this file's now-removed
 * predecessor) — declaration-merging a project's real bindings into that global namespace from a
 * SEPARATE `.d.ts` file is the officially documented pattern, but did not visibly take effect at
 * execution time against this exact toolchain (verified: `tsc` kept reporting `env`'s type as the
 * base package's empty `interface Env {}`, even with the merge file confirmed present in the
 * program via `--listFiles`). Rather than keep chasing why declaration merging didn't take here,
 * this file sidesteps it entirely with a single explicit, load-bearing cast at the one place
 * `cloudflare:test`'s `env` is actually read from — every OTHER file in this suite imports `env`
 * from HERE, never from `cloudflare:test` directly.
 */
import { env as rawEnv } from 'cloudflare:test';
import type { Env } from '../../../src/adapters/cloudflare/env.ts';
import type { applyD1Migrations } from 'cloudflare:test';

export interface TestEnv extends Env {
  readonly TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

export const env: TestEnv = rawEnv as unknown as TestEnv;
