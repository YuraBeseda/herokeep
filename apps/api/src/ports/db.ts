/**
 * The accounts database port (ADR-014's `Db` row): a Drizzle ORM database instance over the
 * sqlite dialect, backed by `drizzle-orm/d1` on Cloudflare and `drizzle-orm/better-sqlite3` on
 * Node — same schema, same generated query API, two drivers (docs/02-architecture/10-backend-
 * architecture.md §Accounts database).
 *
 * Re-exported from `src/core/db/index.ts` (Task 3), which parameterizes Drizzle's
 * `BaseSQLiteDatabase` over both result kinds (`'sync' | 'async'`) and the accounts schema —
 * see that file's header comment for why this single type is structurally assignable from both
 * `BetterSQLite3Database` and `DrizzleD1Database` without `src/core/**` importing either driver
 * package directly (the ESLint core-boundary rule). Every other port/`core` signature that
 * threads a `Db` through (auth queries, stream metadata joins) type-checks unchanged against
 * this real type — only this declaration changed from Task 2's opaque brand placeholder.
 */
export type { Db } from '../core/db/index.ts';
