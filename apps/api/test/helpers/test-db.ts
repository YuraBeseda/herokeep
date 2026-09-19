/**
 * Shared in-memory accounts-DB test fixture — a REAL better-sqlite3 driver with every generated
 * migration applied (not a fake), so tests exercise actual SQLite constraints (folded-username
 * uniqueness, the recovery-code one-time burn guard, the `sessions.id` unique index). Extracted
 * from Task 3's `test/core/db.test.ts` inline setup so Task 4's auth tests (and any later task)
 * share one implementation instead of re-deriving the migrations path. Lives under `test/`, so
 * it's exempt from the `apps/api/src/core/**` core-boundary ESLint rule and may import the
 * concrete driver directly (per task-3-brief.md: "The TEST file may construct a real driver").
 */
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { schema } from '../../src/core/db/schema.ts';

const migrationsFolder = fileURLToPath(new URL('../../src/core/db/migrations', import.meta.url));

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDbHandle {
  readonly sqlite: InstanceType<typeof Database>;
  readonly db: TestDb;
  close(): void;
}

/** Opens a fresh `:memory:` accounts database with every migration applied. Callers close it
 * (e.g. in `afterEach`) via the returned `close()`. */
export function openTestDb(): TestDbHandle {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { sqlite, db, close: () => sqlite.close() };
}
