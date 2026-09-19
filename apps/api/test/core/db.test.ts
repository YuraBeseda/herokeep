/**
 * Accounts DB tests over a REAL in-memory better-sqlite3 driver (not a fake) — the point is to
 * prove the generated migrations apply cleanly and that DB-enforced constraints (folded-username
 * uniqueness, one-time recovery-code burn via the `usedAt IS NULL` guard) actually hold at the
 * sqlite level, not just in TypeScript types. This file lives under `test/`, not `src/core/`, so
 * it's exempt from the core-boundary ESLint rule and may import the concrete driver directly —
 * per task-3-brief.md: "The TEST file may construct a real driver."
 */
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addUsage,
  burnRecoveryCode,
  countCharactersForOwner,
  findSessionByTokenHash,
  findUnusedRecoveryCode,
  findUserByFoldedName,
  insertRecoveryCodes,
  insertSession,
  insertUser,
  listCharactersForOwner,
  upsertCharacterIndexRow,
} from '../../src/core/db/queries.ts';
import { schema } from '../../src/core/db/schema.ts';
import { foldUsername } from '../../src/core/db/fold.ts';

const migrationsFolder = fileURLToPath(new URL('../../src/core/db/migrations', import.meta.url));

let sqlite: InstanceType<typeof Database>;
// Kept as the concrete `BetterSQLite3Database` type here (not the driver-agnostic `Db` from
// `core/db/index.ts`) because `drizzle-orm/better-sqlite3/migrator`'s `migrate()` requires the
// exact sync driver type; every query function below still accepts this `db` value fine since a
// concrete driver is structurally assignable to the broader `Db` type (see `core/db/index.ts`'s
// header comment), just not the reverse.
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
});

afterEach(() => {
  sqlite.close();
});

function makeUser(overrides: Partial<Parameters<typeof insertUser>[1]> = {}) {
  return insertUser(db, {
    id: overrides.id ?? 'usr_1',
    username: overrides.username ?? 'Alice',
    usernameFolded: overrides.usernameFolded ?? foldUsername(overrides.username ?? 'Alice'),
    salt: overrides.salt ?? 'salt-hex',
    verifierHash: overrides.verifierHash ?? 'verifier-hash-hex',
    createdAt: overrides.createdAt ?? 1_000,
    ...overrides,
  });
}

describe('migrations', () => {
  it('apply cleanly and create every expected table', () => {
    const tables = sqlite
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'",
      )
      .all()
      .map((row) => row.name)
      .sort();
    expect(tables).toEqual(['characters', 'recovery_codes', 'sessions', 'usage_daily', 'users']);
  });

  it('do not create campaigns or memberships tables (Phase 3, deferred)', () => {
    const tables = sqlite
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables).not.toContain('campaigns');
    expect(tables).not.toContain('memberships');
  });
});

describe('username folded uniqueness (DB-enforced)', () => {
  it('rejects a second user whose folded username collides, even with different display casing', async () => {
    await makeUser({ id: 'usr_1', username: 'Alice' });
    await expect(makeUser({ id: 'usr_2', username: 'alice' })).rejects.toThrow();
  });

  it('rejects a full-width spelling that folds to the same value as an existing ASCII username', async () => {
    await makeUser({ id: 'usr_1', username: 'Alice' });
    await expect(makeUser({ id: 'usr_2', username: 'ＡＬＩＣＥ' })).rejects.toThrow();
  });

  it('allows two usernames that fold to different values', async () => {
    await makeUser({ id: 'usr_1', username: 'Alice' });
    await expect(makeUser({ id: 'usr_2', username: 'Bob' })).resolves.toMatchObject({ id: 'usr_2' });
  });

  it('findUserByFoldedName finds a user regardless of the display casing used to look it up', async () => {
    await makeUser({ id: 'usr_1', username: 'Alice' });
    const found = await findUserByFoldedName(db, foldUsername('ALICE'));
    expect(found?.id).toBe('usr_1');
  });

  it('findUserByFoldedName returns undefined for an unknown folded name', async () => {
    expect(await findUserByFoldedName(db, foldUsername('nobody'))).toBeUndefined();
  });
});

describe('session expiry filtering', () => {
  it('findSessionByTokenHash returns a session that has not expired yet', async () => {
    await makeUser();
    await insertSession(db, {
      tokenHash: 'hash-1',
      userId: 'usr_1',
      deviceLabel: 'Test device',
      createdAt: 1_000,
      lastSeenAt: 1_000,
      expiresAt: 2_000,
    });
    const found = await findSessionByTokenHash(db, 'hash-1', 1_500);
    expect(found?.tokenHash).toBe('hash-1');
  });

  it('findSessionByTokenHash ignores an expired session', async () => {
    await makeUser();
    await insertSession(db, {
      tokenHash: 'hash-1',
      userId: 'usr_1',
      deviceLabel: 'Test device',
      createdAt: 1_000,
      lastSeenAt: 1_000,
      expiresAt: 2_000,
    });
    const found = await findSessionByTokenHash(db, 'hash-1', 2_500);
    expect(found).toBeUndefined();
  });
});

describe('recovery codes', () => {
  it('burnRecoveryCode is one-time: the second attempt on the same code fails', async () => {
    await makeUser();
    await insertRecoveryCodes(db, [{ userId: 'usr_1', codeHash: 'code-hash-1', usedAt: null }]);

    const firstBurn = await burnRecoveryCode(db, 'usr_1', 'code-hash-1', 5_000);
    expect(firstBurn).toBe(true);

    const secondBurn = await burnRecoveryCode(db, 'usr_1', 'code-hash-1', 6_000);
    expect(secondBurn).toBe(false);
  });

  it('findUnusedRecoveryCode stops finding a code once it has been burned', async () => {
    await makeUser();
    await insertRecoveryCodes(db, [{ userId: 'usr_1', codeHash: 'code-hash-1', usedAt: null }]);

    expect(await findUnusedRecoveryCode(db, 'usr_1', 'code-hash-1')).toBeDefined();
    await burnRecoveryCode(db, 'usr_1', 'code-hash-1', 5_000);
    expect(await findUnusedRecoveryCode(db, 'usr_1', 'code-hash-1')).toBeUndefined();
  });
});

describe('characters', () => {
  it('countCharactersForOwner counts only the given owner’s characters', async () => {
    await makeUser({ id: 'usr_1', username: 'Alice' });
    await makeUser({ id: 'usr_2', username: 'Bob' });
    await upsertCharacterIndexRow(db, {
      id: 'char_1',
      ownerId: 'usr_1',
      name: 'Aria',
      system: 'dnd5e-2024',
      updatedAt: 1_000,
    });
    await upsertCharacterIndexRow(db, {
      id: 'char_2',
      ownerId: 'usr_1',
      name: 'Bram',
      system: 'dnd5e-2024',
      updatedAt: 1_000,
    });
    await upsertCharacterIndexRow(db, {
      id: 'char_3',
      ownerId: 'usr_2',
      name: 'Cato',
      system: 'dnd5e-2024',
      updatedAt: 1_000,
    });

    expect(await countCharactersForOwner(db, 'usr_1')).toBe(2);
    expect(await countCharactersForOwner(db, 'usr_2')).toBe(1);
  });

  it('countCharactersForOwner is 0 for a user with no characters', async () => {
    await makeUser();
    expect(await countCharactersForOwner(db, 'usr_1')).toBe(0);
  });

  it('upsertCharacterIndexRow updates an existing row instead of duplicating it', async () => {
    await makeUser();
    await upsertCharacterIndexRow(db, {
      id: 'char_1',
      ownerId: 'usr_1',
      name: 'Aria',
      system: 'dnd5e-2024',
      bytesUsed: 100,
      eventCount: 5,
      updatedAt: 1_000,
    });
    await upsertCharacterIndexRow(db, {
      id: 'char_1',
      ownerId: 'usr_1',
      name: 'Aria',
      system: 'dnd5e-2024',
      bytesUsed: 250,
      eventCount: 12,
      updatedAt: 2_000,
    });

    const rows = await listCharactersForOwner(db, 'usr_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bytesUsed: 250, eventCount: 12, updatedAt: 2_000 });
  });
});

describe('usage_daily', () => {
  it('addUsage creates the row on first use', async () => {
    await addUsage(db, '2026-09-19', 'events_appended', 3);
    const rows = sqlite.prepare('SELECT day, metric, value FROM usage_daily').all();
    expect(rows).toEqual([{ day: '2026-09-19', metric: 'events_appended', value: 3 }]);
  });

  it('addUsage accumulates on repeated calls for the same (day, metric)', async () => {
    await addUsage(db, '2026-09-19', 'events_appended', 3);
    await addUsage(db, '2026-09-19', 'events_appended', 4);
    const rows = sqlite.prepare('SELECT value FROM usage_daily').all();
    expect(rows).toEqual([{ value: 7 }]);
  });

  it('addUsage keeps distinct metrics on the same day separate', async () => {
    await addUsage(db, '2026-09-19', 'events_appended', 3);
    await addUsage(db, '2026-09-19', 'bytes_written', 10);
    const rows = sqlite.prepare('SELECT metric, value FROM usage_daily ORDER BY metric').all();
    expect(rows).toEqual([
      { metric: 'bytes_written', value: 10 },
      { metric: 'events_appended', value: 3 },
    ]);
  });
});
