/**
 * `src/cli/admin.ts` tests (task-10-brief step 1): export -> import round-trip on the Node
 * adapter reproduces streams byte-equal (event ids/seqs/payloads) and users sans sessions;
 * import refuses a non-empty target; `reset-recovery` burns old codes and prints 6 new ones
 * once. Drives the exported `main(argv)` directly against real temp data dirs (real
 * better-sqlite3 files, not fakes) -- no child_process spawning except one cheap smoke test.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@hk/protocol';
import { main } from '../../src/cli/admin.ts';
import { openAccountsDb, type AccountsDbHandle } from '../../src/adapters/node/db.sqlite.ts';
import { openStreamsDb, SqliteFileStreamStore } from '../../src/adapters/node/store.sqlite-file.ts';
import { sha256Hex } from '../../src/core/crypto.ts';
import { foldUsername } from '../../src/core/auth/username.ts';
import { normalizeRecoveryCode } from '../../src/core/auth/recovery-codes.ts';
import { uuidv7 } from '../../src/core/ids.ts';
import {
  findUnusedRecoveryCode,
  insertRecoveryCodes,
  insertUser,
  listAllCharacters,
  listAllRecoveryCodes,
  listAllUsers,
  upsertCharacterIndexRow,
} from '../../src/core/db/queries.ts';

let root: string;
let srcDir: string;
let exportDir: string;
let freshDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hk-admin-cli-'));
  srcDir = join(root, 'src-data');
  exportDir = join(root, 'export');
  freshDir = join(root, 'fresh-data');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeEvent(streamId: string, overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    type: 'note.added',
    v: 1,
    payload: { note: uuidv7() },
    ...overrides,
  };
}

interface SeededData {
  readonly userId: string;
  readonly usernameFolded: string;
  readonly characterIdA: string;
  readonly characterIdB: string;
}

/** Seeds `srcDir` directly against real adapter storage: one user with 6 recovery codes, two
 * characters, and two streams -- one with a plain sequence of events, one with a tx-group
 * (shared `txId`) committed in a single append so seq contiguity across the whole batch is
 * exercised, matching how `StreamActor.append` really commits a tx group. */
async function seedSourceData(): Promise<SeededData> {
  mkdirSync(srcDir, { recursive: true });
  const accounts: AccountsDbHandle = openAccountsDb(join(srcDir, 'accounts.sqlite'));
  const streamsSqlite = openStreamsDb(join(srcDir, 'streams.sqlite'));
  try {
    const userId = uuidv7();
    const usernameFolded = foldUsername('AdminCliUser');
    const now = Date.now();
    await insertUser(accounts.db, {
      id: userId,
      username: 'AdminCliUser',
      usernameFolded,
      salt: 'a'.repeat(32),
      verifierHash: 'b'.repeat(64),
      createdAt: now,
      quotaBytesUsed: 0,
    });
    const codes = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => ({
        userId,
        codeHash: await sha256Hex(`seed-code-${i}`),
        usedAt: null,
      })),
    );
    await insertRecoveryCodes(accounts.db, codes);

    const characterIdA = uuidv7();
    const characterIdB = uuidv7();
    await upsertCharacterIndexRow(accounts.db, {
      id: characterIdA,
      ownerId: userId,
      name: 'Wisp',
      system: 'srd-5e-2024',
      campaignId: null,
      archivedAt: null,
      bytesUsed: 0,
      eventCount: 0,
      updatedAt: now,
    });
    await upsertCharacterIndexRow(accounts.db, {
      id: characterIdB,
      ownerId: userId,
      name: 'Gale',
      system: 'srd-5e-2024',
      campaignId: null,
      archivedAt: null,
      bytesUsed: 0,
      eventCount: 0,
      updatedAt: now,
    });

    const streamA = `char:${characterIdA}`;
    const storeA = new SqliteFileStreamStore(streamsSqlite, streamA);
    await storeA.append([makeEvent(streamA), makeEvent(streamA), makeEvent(streamA)]);

    const streamB = `char:${characterIdB}`;
    const storeB = new SqliteFileStreamStore(streamsSqlite, streamB);
    const txId = uuidv7();
    await storeB.append([
      makeEvent(streamB, { txId, type: 'note.added' }),
      makeEvent(streamB, { txId, type: 'note.removed' }),
    ]);
    await storeB.append([makeEvent(streamB)]);

    return { userId, usernameFolded, characterIdA, characterIdB };
  } finally {
    accounts.sqlite.close();
    streamsSqlite.close();
  }
}

describe('herokeep-admin export -> import round-trip (Node adapter)', () => {
  it('reproduces streams byte-equal (ids/seqs/payloads) and users sans sessions', async () => {
    const seeded = await seedSourceData();

    const exportResult = await main(['export', '--data-dir', srcDir, '--out', exportDir]);
    expect(exportResult.exitCode).toBe(0);

    const importResult = await main(['import', '--data-dir', freshDir, '--in', exportDir]);
    expect(importResult.exitCode).toBe(0);

    // --- users sans sessions -------------------------------------------------------------
    const srcAccounts = openAccountsDb(join(srcDir, 'accounts.sqlite'));
    const freshAccounts = openAccountsDb(join(freshDir, 'accounts.sqlite'));
    try {
      const srcUsers = await listAllUsers(srcAccounts.db);
      const freshUsers = await listAllUsers(freshAccounts.db);
      expect(freshUsers).toEqual(srcUsers);
      expect(freshUsers).toHaveLength(1);
      expect(freshUsers[0]?.id).toBe(seeded.userId);

      // sessions were never exported/imported at all -- the fresh accounts db has none, even
      // though nothing here ever seeded any in the source either (sessions are simply outside
      // this CLI's scope by construction, not filtered out post-hoc).
      const freshSessionsCount = freshAccounts.sqlite.prepare('SELECT COUNT(*) AS c FROM sessions').get() as {
        c: number;
      };
      expect(freshSessionsCount.c).toBe(0);

      const srcCodes = await listAllRecoveryCodes(srcAccounts.db);
      const freshCodes = await listAllRecoveryCodes(freshAccounts.db);
      expect(freshCodes).toEqual(srcCodes);
      expect(freshCodes).toHaveLength(6);

      const srcCharacters = await listAllCharacters(srcAccounts.db);
      const freshCharacters = await listAllCharacters(freshAccounts.db);
      expect(freshCharacters).toEqual(srcCharacters);
      expect(freshCharacters).toHaveLength(2);
    } finally {
      srcAccounts.sqlite.close();
      freshAccounts.sqlite.close();
    }

    // --- streams byte-equal (ids, seqs, payloads) -----------------------------------------
    const srcStreamsDb = openStreamsDb(join(srcDir, 'streams.sqlite'));
    const freshStreamsDb = openStreamsDb(join(freshDir, 'streams.sqlite'));
    try {
      for (const characterId of [seeded.characterIdA, seeded.characterIdB]) {
        const streamId = `char:${characterId}`;
        const srcStore = new SqliteFileStreamStore(srcStreamsDb, streamId);
        const freshStore = new SqliteFileStreamStore(freshStreamsDb, streamId);
        const srcHead = await srcStore.head();
        const freshHead = await freshStore.head();
        expect(freshHead).toBe(srcHead);

        const srcEvents = await srcStore.read(1, 1000);
        const freshEvents = await freshStore.read(1, 1000);
        expect(freshEvents).toEqual(srcEvents);
        expect(freshEvents.map((e) => e.seq)).toEqual(srcEvents.map((e) => e.seq));
        expect(freshEvents.map((e) => e.id)).toEqual(srcEvents.map((e) => e.id));
        expect(freshEvents.map((e) => e.payload)).toEqual(srcEvents.map((e) => e.payload));
      }
    } finally {
      srcStreamsDb.close();
      freshStreamsDb.close();
    }
  });

  it('refuses to import into a non-empty target ("merge-empty-only"), writing nothing', async () => {
    await seedSourceData();
    await main(['export', '--data-dir', srcDir, '--out', exportDir]);

    // Populate the "fresh" dir first, so it's no longer empty.
    mkdirSync(freshDir, { recursive: true });
    const prePopulated = openAccountsDb(join(freshDir, 'accounts.sqlite'));
    await insertUser(prePopulated.db, {
      id: 'already-here',
      username: 'AlreadyHere',
      usernameFolded: foldUsername('AlreadyHere'),
      salt: 'c'.repeat(32),
      verifierHash: 'd'.repeat(64),
      createdAt: Date.now(),
      quotaBytesUsed: 0,
    });
    prePopulated.sqlite.close();

    const importResult = await main(['import', '--data-dir', freshDir, '--in', exportDir]);
    expect(importResult.exitCode).toBe(3);

    const reopened = openAccountsDb(join(freshDir, 'accounts.sqlite'));
    try {
      const usersAfter = await listAllUsers(reopened.db);
      // Only the pre-populated user -- the import must not have written anything.
      expect(usersAfter.map((u) => u.id)).toEqual(['already-here']);
    } finally {
      reopened.sqlite.close();
    }
  });
});

describe('herokeep-admin reset-recovery', () => {
  it('burns old codes and prints 6 new ones once', async () => {
    const seeded = await seedSourceData();

    const result = await main(['reset-recovery', '--data-dir', srcDir, '--username', 'AdminCliUser']);
    expect(result.exitCode).toBe(0);

    const printedCodes = result.lines.slice(1); // line 0 is the "burned, shown once" message
    expect(printedCodes).toHaveLength(6);
    for (const line of printedCodes) expect(line).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

    const accounts = openAccountsDb(join(srcDir, 'accounts.sqlite'));
    try {
      const codes = await listAllRecoveryCodes(accounts.db);
      expect(codes).toHaveLength(6);

      // Old seed codes are gone entirely (burned, not merely marked used).
      const oldHash = await sha256Hex('seed-code-0');
      expect(codes.some((c) => c.codeHash === oldHash)).toBe(false);

      // Every freshly printed code hashes to a row that is present and still unused.
      for (const printed of printedCodes) {
        const normalized = normalizeRecoveryCode(printed);
        const hash = await sha256Hex(normalized);
        const found = await findUnusedRecoveryCode(accounts.db, seeded.userId, hash);
        expect(found).toBeDefined();
      }
    } finally {
      accounts.sqlite.close();
    }
  });

  it('reports exitCode 4 for an unknown username', async () => {
    await seedSourceData();
    const result = await main(['reset-recovery', '--data-dir', srcDir, '--username', 'NobodyHome']);
    expect(result.exitCode).toBe(4);
  });
});

describe('herokeep-admin CLI smoke (real node subprocess)', () => {
  it('--help exits 0 via a real `node src/cli/admin.ts --help` invocation', () => {
    const adminPath = fileURLToPath(new URL('../../src/cli/admin.ts', import.meta.url));
    const output = execFileSync(process.execPath, [adminPath, '--help'], { encoding: 'utf8' });
    expect(output).toMatch(/herokeep-admin <command>/);
  });
});
