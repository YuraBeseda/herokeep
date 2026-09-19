/**
 * The driver-agnostic `Db` type (ADR-014's `Db` port row): `BaseSQLiteDatabase` parameterized
 * over BOTH result kinds (`'sync' | 'async'`) and this schema. This is Drizzle 0.45's own
 * documented shape for code that must run unchanged over `drizzle-orm/better-sqlite3` (a sync
 * driver: `BetterSQLite3Database extends BaseSQLiteDatabase<'sync', ...>`) and `drizzle-orm/d1`
 * (an async driver: `DrizzleD1Database extends BaseSQLiteDatabase<'async', ...>`) — verified
 * against the installed `drizzle-orm@0.45.2` `.d.ts` files (`sqlite-core/db.d.ts`,
 * `better-sqlite3/driver.d.ts`, `d1/driver.d.ts`): both concrete database classes are
 * structurally assignable to `BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>`,
 * and every query builder result is safely `await`-able either way (`await` on a plain
 * synchronous value just resolves immediately — it does not require a real Promise). `queries.ts`
 * therefore `await`s every call, even against the sync better-sqlite3 driver, so one query
 * function body works against both adapters.
 *
 * `src/core/**` may only import `drizzle-orm` + `drizzle-orm/sqlite-core` (never a concrete
 * driver package) — the ESLint core-boundary rule enforces this; adapters
 * (`src/adapters/{node,cloudflare}/db.*.ts`) construct the real driver and hand back a `Db`.
 */
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { type schema } from './schema.ts';

export type Db = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;

export * from './schema.ts';
