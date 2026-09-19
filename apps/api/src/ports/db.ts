/**
 * The accounts database port (ADR-014's `Db` row): a Drizzle ORM database instance over the
 * sqlite dialect, backed by `drizzle-orm/d1` on Cloudflare and `drizzle-orm/better-sqlite3` on
 * Node — same schema, same generated query API, two drivers (docs/02-architecture/10-backend-
 * architecture.md §Accounts database).
 *
 * Drizzle itself isn't installed until Task 3 (`src/core/db/schema.ts`), and `src/core/**`
 * may not import `drizzle-orm/d1` or `drizzle-orm/better-sqlite3` directly (the ESLint
 * core-boundary rule) — only the adapters may name a driver. So this port can't yet spell the
 * real type (`DrizzleD1Database<typeof schema> | BetterSQLite3Database<typeof schema>`) without
 * pulling a driver into `core`. Until Task 3, `Db` is a nominal (branded) placeholder: an opaque
 * type nothing outside this file can construct or inspect, which still lets every other port
 * and `core` signature that threads a `Db` through (auth queries, stream metadata joins) type-
 * check today. Task 3 replaces the brand below with the real Drizzle type, parameterized over
 * the schema module it adds — every call site here just takes/returns `Db` by name, so nothing
 * downstream needs to change shape, only this declaration.
 */
declare const dbBrand: unique symbol;
export interface Db {
  readonly [dbBrand]: 'Db';
}
