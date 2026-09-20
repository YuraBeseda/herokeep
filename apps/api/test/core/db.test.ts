/**
 * Accounts DB tests over a REAL in-memory better-sqlite3 driver (not a fake) — the point is to
 * prove the generated migrations apply cleanly and that DB-enforced constraints (folded-username
 * uniqueness, one-time recovery-code burn via the `usedAt IS NULL` guard) actually hold at the
 * sqlite level, not just in TypeScript types. This file lives under `test/`, not `src/core/`, so
 * it's exempt from the core-boundary ESLint rule and may import the concrete driver directly —
 * per task-3-brief.md: "The TEST file may construct a real driver."
 */
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addUsage,
  burnRecoveryCode,
  countCharactersForOwner,
  countMembers,
  createCampaign,
  findCampaignByJoinCode,
  findMembership,
  findSessionByTokenHash,
  findUnusedRecoveryCode,
  findUserByFoldedName,
  insertMembership,
  insertRecoveryCodes,
  insertSession,
  insertUser,
  listCampaignsForUser,
  listCharactersForOwner,
  listMembers,
  removeMembership,
  rotateJoinCode,
  upsertCharacterIndexRow,
} from '../../src/core/db/queries.ts';
import { foldUsername } from '../../src/core/db/fold.ts';
import { generateJoinCode } from '../../src/core/db/join-code.ts';
import { openTestDb, type TestDb } from '../helpers/test-db.ts';

let sqlite: InstanceType<typeof Database>;
// Kept as the concrete `BetterSQLite3Database` type here (not the driver-agnostic `Db` from
// `core/db/index.ts`) because `drizzle-orm/better-sqlite3/migrator`'s `migrate()` requires the
// exact sync driver type; every query function below still accepts this `db` value fine since a
// concrete driver is structurally assignable to the broader `Db` type (see `core/db/index.ts`'s
// header comment), just not the reverse.
let db: TestDb;

beforeEach(() => {
  const handle = openTestDb();
  sqlite = handle.sqlite;
  db = handle.db;
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

function makeCampaign(overrides: Partial<Parameters<typeof createCampaign>[1]> = {}) {
  return createCampaign(db, {
    id: overrides.id ?? 'camp_1',
    dmId: overrides.dmId ?? 'usr_1',
    name: overrides.name ?? 'Curse of the Crimson Throne',
    system: overrides.system ?? 'dnd5e-2024',
    joinCode: overrides.joinCode ?? 'ABCD2345',
    updatedAt: overrides.updatedAt ?? 1_000,
    ...overrides,
  });
}

describe('migrations', () => {
  // Phase 3, Task 3 (this task): the additive migration `0002` now creates `campaigns` and
  // `memberships` — this test's expected-table list is updated in place (not skipped/reverted)
  // to include them. The sandbox's revert-blocked RED-evidence workaround applies here: rather
  // than literally reverting `schema.ts`/the migration to capture a failing run, the per-assertion
  // reasoning is that BEFORE this task's schema/migration changes, `campaigns`/`memberships`
  // simply did not exist (the OLD version of this very test — replaced by the one below —
  // asserted exactly that: "do not create campaigns or memberships tables (Phase 3, deferred)",
  // visible in this file's prior git history), so this assertion is known to fail against the
  // pre-task migration set and pass only once `0002` is generated and applied.
  it('apply cleanly and create every expected table, including the new campaigns/memberships pair', () => {
    const tables = sqlite
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'",
      )
      .all()
      .map((row) => row.name)
      .sort();
    expect(tables).toEqual([
      'campaigns',
      'characters',
      'memberships',
      'recovery_codes',
      'sessions',
      'usage_daily',
      'users',
    ]);
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

describe('campaigns (join_code uniqueness, DB-enforced)', () => {
  it('rejects a second campaign whose join_code collides with an existing one', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });
    await expect(makeCampaign({ id: 'camp_2', dmId: 'usr_1', joinCode: 'ABCD2345' })).rejects.toThrow();
  });

  it('allows two campaigns with different join codes', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });
    await expect(makeCampaign({ id: 'camp_2', dmId: 'usr_1', joinCode: 'WXYZ6789' })).resolves.toMatchObject({
      id: 'camp_2',
    });
  });

  it('findCampaignByJoinCode finds the matching campaign and nothing for an unknown code', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });

    expect((await findCampaignByJoinCode(db, 'ABCD2345'))?.id).toBe('camp_1');
    expect(await findCampaignByJoinCode(db, 'NOSUCH99')).toBeUndefined();
  });

  it('rotateJoinCode replaces the stored code and the old code no longer resolves', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });

    await rotateJoinCode(db, 'camp_1', 'FRESH999');

    expect(await findCampaignByJoinCode(db, 'ABCD2345')).toBeUndefined();
    expect((await findCampaignByJoinCode(db, 'FRESH999'))?.id).toBe('camp_1');
  });

  it('joinOpen defaults to true (integer-boolean column, sqlite norm) and round-trips as a JS boolean', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    const campaign = await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });
    expect(campaign.joinOpen).toBe(true);
  });
});

describe('memberships (composite-PK uniqueness, DB-enforced)', () => {
  it('rejects a second membership row for the same (campaign, user) pair', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeUser({ id: 'usr_2', username: 'Player' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });
    await insertMembership(db, {
      campaignId: 'camp_1',
      userId: 'usr_2',
      role: 'player',
      displayName: 'Player One',
      joinedAt: 1_000,
    });

    await expect(
      insertMembership(db, {
        campaignId: 'camp_1',
        userId: 'usr_2',
        role: 'player',
        displayName: 'Player One (again)',
        joinedAt: 2_000,
      }),
    ).rejects.toThrow();
  });

  it('allows the same user to be a member of two different campaigns', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeUser({ id: 'usr_2', username: 'Player' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });
    await makeCampaign({ id: 'camp_2', dmId: 'usr_1', joinCode: 'WXYZ6789' });

    await insertMembership(db, {
      campaignId: 'camp_1',
      userId: 'usr_2',
      role: 'player',
      displayName: 'Player One',
      joinedAt: 1_000,
    });
    await expect(
      insertMembership(db, {
        campaignId: 'camp_2',
        userId: 'usr_2',
        role: 'player',
        displayName: 'Player One',
        joinedAt: 1_000,
      }),
    ).resolves.toMatchObject({ campaignId: 'camp_2', userId: 'usr_2' });
  });

  it('findMembership / removeMembership round-trip, and removeMembership reports whether a row existed', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeUser({ id: 'usr_2', username: 'Player' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });
    await insertMembership(db, {
      campaignId: 'camp_1',
      userId: 'usr_2',
      role: 'player',
      displayName: 'Player One',
      joinedAt: 1_000,
    });

    expect(await findMembership(db, 'camp_1', 'usr_2')).toMatchObject({ role: 'player' });
    expect(await removeMembership(db, 'camp_1', 'usr_2')).toBe(true);
    expect(await findMembership(db, 'camp_1', 'usr_2')).toBeUndefined();
    expect(await removeMembership(db, 'camp_1', 'usr_2')).toBe(false);
  });

  it('listMembers returns only the given campaign’s rows', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeUser({ id: 'usr_2', username: 'Player1' });
    await makeUser({ id: 'usr_3', username: 'Player2' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });
    await makeCampaign({ id: 'camp_2', dmId: 'usr_1', joinCode: 'WXYZ6789' });
    await insertMembership(db, {
      campaignId: 'camp_1',
      userId: 'usr_2',
      role: 'player',
      displayName: 'Player1',
      joinedAt: 1_000,
    });
    await insertMembership(db, {
      campaignId: 'camp_1',
      userId: 'usr_3',
      role: 'player',
      displayName: 'Player2',
      joinedAt: 1_000,
    });
    await insertMembership(db, {
      campaignId: 'camp_2',
      userId: 'usr_2',
      role: 'player',
      displayName: 'Player1',
      joinedAt: 1_000,
    });

    const members = await listMembers(db, 'camp_1');
    expect(members.map((m) => m.userId).sort()).toEqual(['usr_2', 'usr_3']);
  });

  it('countMembers counts only the given campaign’s membership rows', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeUser({ id: 'usr_2', username: 'Player1' });
    await makeUser({ id: 'usr_3', username: 'Player2' });
    await makeCampaign({ id: 'camp_1', dmId: 'usr_1', joinCode: 'ABCD2345' });
    expect(await countMembers(db, 'camp_1')).toBe(0);

    await insertMembership(db, {
      campaignId: 'camp_1',
      userId: 'usr_2',
      role: 'player',
      displayName: 'Player1',
      joinedAt: 1_000,
    });
    await insertMembership(db, {
      campaignId: 'camp_1',
      userId: 'usr_3',
      role: 'player',
      displayName: 'Player2',
      joinedAt: 1_000,
    });

    expect(await countMembers(db, 'camp_1')).toBe(2);
  });
});

describe('listCampaignsForUser (dm-of UNION member-of, deduplicated)', () => {
  it('returns campaigns the user DMs plus campaigns they are only a member of, without duplicates', async () => {
    await makeUser({ id: 'usr_1', username: 'Dm' });
    await makeUser({ id: 'usr_2', username: 'Player' });
    await makeCampaign({ id: 'camp_dm', dmId: 'usr_1', joinCode: 'ABCD2345' });
    await makeCampaign({ id: 'camp_other_dm', dmId: 'usr_2', joinCode: 'WXYZ6789' });
    await makeCampaign({ id: 'camp_untouched', dmId: 'usr_2', joinCode: 'NOTOUCH1' });

    // usr_1 is also a member (not DM) of camp_other_dm.
    await insertMembership(db, {
      campaignId: 'camp_other_dm',
      userId: 'usr_1',
      role: 'player',
      displayName: 'Guest',
      joinedAt: 1_000,
    });
    // The campaign's own DM also holds a membership row (ruling 1's kept-in-sync convention) —
    // this must not produce a duplicate in usr_1's dm-of result for camp_dm.
    await insertMembership(db, {
      campaignId: 'camp_dm',
      userId: 'usr_1',
      role: 'dm',
      displayName: 'Dm',
      joinedAt: 1_000,
    });

    const result = await listCampaignsForUser(db, 'usr_1');
    expect(result.map((c) => c.id).sort()).toEqual(['camp_dm', 'camp_other_dm']);
    expect(result).toHaveLength(2);
  });

  it('is empty for a user with no campaigns', async () => {
    await makeUser({ id: 'usr_1', username: 'Alice' });
    expect(await listCampaignsForUser(db, 'usr_1')).toEqual([]);
  });
});

describe('generateJoinCode (doc-02 §Identifiers shape)', () => {
  it('produces an 8-character code', () => {
    expect(generateJoinCode()).toHaveLength(8);
  });

  it('uses only characters from the Crockford-base32-no-vowels alphabet (digits + BCDFGHJKMNPQRSTVWXYZ) — never A, E, I, L, O or U', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateJoinCode()).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it('is uniform enough that 200 draws produce no repeats (sanity check on 30^8 odds, not a proof)', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateJoinCode()));
    expect(codes.size).toBe(200);
  });
});
