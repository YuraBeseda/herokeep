/**
 * `Db` over `drizzle-orm/d1` (ADR-014's Cloudflare `Db` row): same schema, same generated query
 * API as Node's `drizzle-orm/better-sqlite3` driver (`adapters/node/db.sqlite.ts`) — only the
 * driver differs (doc-10 §Accounts database). Unlike Node, migrations are NOT applied here at
 * request time: doc-10 is explicit that D1 migrations are "applied by `wrangler d1 migrations
 * apply`" (a deploy-time/CLI step against the `d1_databases[].migrations_dir` this repo's
 * `wrangler.jsonc` points at `src/core/db/migrations` — the SAME committed migrations Node applies
 * at startup), never programmatically from inside the Worker. `@cloudflare/vitest-pool-workers`
 * mirrors that CLI step for tests via `applyD1Migrations` in `test/adapters/cloudflare`'s setup,
 * rather than this file doing it.
 */
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import { schema } from '../../core/db/schema.ts';
import type { Db } from '../../ports/db.ts';

export function openAccountsDb(d1: D1Database): Db {
  // `drizzle-orm/d1`'s own `D1Database` type (from the `d1` npm package it depends on) is
  // structurally identical to `@cloudflare/workers-types`' — both describe the same Workers
  // runtime binding — but are nominally distinct packages, so `drizzle`'s parameter type doesn't
  // accept ours by declaration. Safe: this cast crosses two structurally-equivalent descriptions
  // of the exact same runtime object, not an actual type change.
  return drizzle(d1 as never, { schema });
}
