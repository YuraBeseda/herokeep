/**
 * `SqliteFileStreamStore` contract tests over a REAL temp `streams.sqlite` file (not `:memory:` —
 * the whole point is proving data survives a process-level reopen, task-7-brief step 1). Mirrors
 * `test/helpers/fake-stream-store.ts`'s contract coverage but against real storage.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Event } from '@hk/protocol';
import { openStreamsDb, SqliteFileStreamStore } from '../../../src/adapters/node/store.sqlite-file.ts';
import { uuidv7 } from '../../../src/core/ids.ts';

const STREAM_A = `char:${uuidv7()}`;
const STREAM_B = `char:${uuidv7()}`;

function makeEvent(streamId: string, overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    type: 'note.added',
    v: 1,
    payload: { id: uuidv7() },
    ...overrides,
  };
}

let dir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hk-streams-'));
  dbPath = join(dir, 'streams.sqlite');
  db = openStreamsDb(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteFileStreamStore', () => {
  it('append assigns contiguous seqs starting at 1 and read returns them in order', async () => {
    const store = new SqliteFileStreamStore(db, STREAM_A);
    const events = [makeEvent(STREAM_A), makeEvent(STREAM_A), makeEvent(STREAM_A)];

    const result = await store.append(events);
    expect(result).toEqual({ firstSeq: 1, lastSeq: 3 });

    const read = await store.read(1, 10);
    expect(read.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(read.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(await store.head()).toBe(3);
  });

  it('a second append continues the seq sequence', async () => {
    const store = new SqliteFileStreamStore(db, STREAM_A);
    await store.append([makeEvent(STREAM_A)]);
    const second = await store.append([makeEvent(STREAM_A), makeEvent(STREAM_A)]);
    expect(second).toEqual({ firstSeq: 2, lastSeq: 3 });
    expect(await store.head()).toBe(3);
  });

  it('read(fromSeq, limit) pages correctly', async () => {
    const store = new SqliteFileStreamStore(db, STREAM_A);
    const events = Array.from({ length: 5 }, () => makeEvent(STREAM_A));
    await store.append(events);

    const page = await store.read(2, 2);
    expect(page.map((e) => e.seq)).toEqual([2, 3]);
  });

  it('head() is 0 for an empty stream', async () => {
    const store = new SqliteFileStreamStore(db, STREAM_A);
    expect(await store.head()).toBe(0);
  });

  it('getMeta/setMeta round-trip and are scoped per stream', async () => {
    const storeA = new SqliteFileStreamStore(db, STREAM_A);
    const storeB = new SqliteFileStreamStore(db, STREAM_B);

    await storeA.setMeta('bytes_used', '123');
    expect(await storeA.getMeta('bytes_used')).toBe('123');
    expect(await storeB.getMeta('bytes_used')).toBeUndefined();

    await storeA.setMeta('bytes_used', '456');
    expect(await storeA.getMeta('bytes_used')).toBe('456');
  });

  it('findByIds returns only the matching, existing events scoped to this stream', async () => {
    const storeA = new SqliteFileStreamStore(db, STREAM_A);
    const storeB = new SqliteFileStreamStore(db, STREAM_B);
    const e1 = makeEvent(STREAM_A);
    const e2 = makeEvent(STREAM_A);
    const e3 = makeEvent(STREAM_B, { id: e1.id }); // same id, different stream — must not collide
    await storeA.append([e1, e2]);
    await storeB.append([e3]);

    const found = await storeA.findByIds([e1.id, e2.id, 'nonexistent-id']);
    expect(found.map((e) => e.id).sort()).toEqual([e1.id, e2.id].sort());

    const foundB = await storeB.findByIds([e1.id]);
    expect(foundB).toHaveLength(1);
    expect(foundB[0]?.stream).toBe(STREAM_B);
  });

  it('findByIds([]) returns [] without querying', async () => {
    const store = new SqliteFileStreamStore(db, STREAM_A);
    expect(await store.findByIds([])).toEqual([]);
  });

  it('putPack/getPack/listPacks round-trip, scoped per stream', async () => {
    const storeA = new SqliteFileStreamStore(db, STREAM_A);
    const storeB = new SqliteFileStreamStore(db, STREAM_B);

    await storeA.putPack('srd-5e-2024', '1.0.0', { entities: [] });
    expect(await storeA.getPack('srd-5e-2024')).toEqual({
      id: 'srd-5e-2024',
      version: '1.0.0',
      json: { entities: [] },
    });
    expect(await storeB.getPack('srd-5e-2024')).toBeUndefined();

    await storeA.putPack('srd-5e-2024', '1.1.0', { entities: ['a'] });
    expect(await storeA.getPack('srd-5e-2024')).toEqual({
      id: 'srd-5e-2024',
      version: '1.1.0',
      json: { entities: ['a'] },
    });

    await storeA.putPack('homebrew', '0.1.0', {});
    expect(await storeA.listPacks()).toHaveLength(2);
  });

  it('deleteAll wipes events, meta and packs for this stream only', async () => {
    const storeA = new SqliteFileStreamStore(db, STREAM_A);
    const storeB = new SqliteFileStreamStore(db, STREAM_B);
    await storeA.append([makeEvent(STREAM_A)]);
    await storeA.setMeta('bytes_used', '10');
    await storeA.putPack('p', '1.0.0', {});
    await storeB.append([makeEvent(STREAM_B)]);

    await storeA.deleteAll();

    expect(await storeA.head()).toBe(0);
    expect(await storeA.getMeta('bytes_used')).toBeUndefined();
    expect(await storeA.listPacks()).toEqual([]);
    // The other stream sharing the same file is untouched.
    expect(await storeB.head()).toBe(1);
  });

  it('data survives closing and reopening the same sqlite file (process-level reopen)', async () => {
    const store = new SqliteFileStreamStore(db, STREAM_A);
    const events = [makeEvent(STREAM_A), makeEvent(STREAM_A)];
    await store.append(events);
    await store.setMeta('bytes_used', '999');
    await store.putPack('srd-5e-2024', '1.0.0', { ok: true });
    db.close();
    expect(existsSync(dbPath)).toBe(true);

    // Reopen fresh — a NEW Database handle and a NEW store instance, exactly as a real process
    // restart would produce.
    const reopened = openStreamsDb(dbPath);
    const reopenedStore = new SqliteFileStreamStore(reopened, STREAM_A);

    expect(await reopenedStore.head()).toBe(2);
    const read = await reopenedStore.read(1, 10);
    expect(read.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(await reopenedStore.getMeta('bytes_used')).toBe('999');
    expect(await reopenedStore.getPack('srd-5e-2024')).toEqual({
      id: 'srd-5e-2024',
      version: '1.0.0',
      json: { ok: true },
    });

    reopened.close();
    db = openStreamsDb(dbPath); // afterEach's db.close() expects a live handle
  });
});
