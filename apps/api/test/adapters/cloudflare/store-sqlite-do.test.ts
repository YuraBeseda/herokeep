/**
 * [plan-16 final fix wave, F1] `DoSqlStreamStore`'s pack bodies against REAL Durable Object SQLite
 * storage, whose 2 MB-per-value cap (`SQLITE_TOOBIG`) is why a body is stored in chunks. The
 * HTTP-level proof (a ~2.6 MB canonical body through the real Worker) is the conformance scenario
 * `campaignLargePackBodyScenario`; this file pins the store itself: exact reassembly across chunk
 * boundaries, replacement and deletion leaving no stale chunk, and the one-time rewrite of the
 * pre-chunking `packs(id, version, json)` table.
 */
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DoSqlStreamStore } from '../../../src/adapters/cloudflare/store.sqlite-do.ts';
import { env } from './typed-env.ts';

function freshStub(): { streamId: string; stub: ReturnType<typeof env.CAMPAIGN_STREAM.get> } {
  const streamId = `camp:${crypto.randomUUID()}`;
  return { streamId, stub: env.CAMPAIGN_STREAM.get(env.CAMPAIGN_STREAM.idFromName(streamId)) };
}

/** ~2.5 MB of mixed 1/2/4-byte UTF-8 (three 1 MiB chunks), with an odd-length prefix so the chunk
 * boundaries fall inside multi-byte characters. */
function largeText(): string {
  return `{"x":"${'ж🐉a'.repeat(360_000)}"}`;
}

function countRows(sql: SqlStorage, table: 'packs' | 'pack_chunks', id: string): number {
  return [...sql.exec(`SELECT 1 FROM ${table} WHERE id = ?`, id)].length;
}

describe('DoSqlStreamStore — chunked pack bodies', () => {
  it('stores a body above the 2 MB value cap and reassembles it exactly', async () => {
    const { streamId, stub } = freshStub();
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStreamStore(state.storage, streamId);
      const json = largeText();
      expect(new TextEncoder().encode(json).length).toBeGreaterThan(2 * 1024 * 1024);

      await store.putPack('big-pack', '1.0.0', json);
      expect(countRows(state.storage.sql, 'pack_chunks', 'big-pack')).toBe(3);
      const read = await store.getPack('big-pack');
      expect(read?.version).toBe('1.0.0');
      expect(read?.json === json, 'byte-identical text').toBe(true);
      expect((await store.listPacks()).map((p) => [p.id, p.json === json])).toEqual([['big-pack', true]]);
    });
  });

  it('replacing a large body with a small one leaves no stale chunk; deletePack removes every row', async () => {
    const { streamId, stub } = freshStub();
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStreamStore(state.storage, streamId);
      await store.putPack('big-pack', '1.0.0', largeText());
      await store.putPack('big-pack', '2.0.0', '{"small":true}');

      expect(countRows(state.storage.sql, 'pack_chunks', 'big-pack')).toBe(1);
      expect(await store.getPack('big-pack')).toEqual({ id: 'big-pack', version: '2.0.0', json: '{"small":true}' });

      await store.deletePack('big-pack');
      expect(await store.getPack('big-pack')).toBeUndefined();
      expect(countRows(state.storage.sql, 'packs', 'big-pack')).toBe(0);
      expect(countRows(state.storage.sql, 'pack_chunks', 'big-pack')).toBe(0);
    });
  });

  it('keeps an empty body and a leading U+FEFF exactly as received', async () => {
    const { streamId, stub } = freshStub();
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new DoSqlStreamStore(state.storage, streamId);
      await store.putPack('empty', '1.0.0', '');
      await store.putPack('bom', '1.0.0', '﻿{}');
      expect((await store.getPack('empty'))?.json).toBe('');
      expect((await store.getPack('bom'))?.json).toBe('﻿{}');
    });
  });

  it('rewrites a pre-chunking packs(id, version, json) table once, keeping its bodies', async () => {
    const { streamId, stub } = freshStub();
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(`
        CREATE TABLE packs (id TEXT PRIMARY KEY, version TEXT NOT NULL, json TEXT NOT NULL);
        INSERT INTO packs (id, version, json) VALUES ('legacy-pack', '1.0.0', '{"legacy":"Пакет"}');
      `);

      const store = new DoSqlStreamStore(state.storage, streamId);
      expect(await store.getPack('legacy-pack')).toEqual({
        id: 'legacy-pack',
        version: '1.0.0',
        json: '{"legacy":"Пакет"}',
      });
      const columns = [...state.storage.sql.exec<{ name: string }>('PRAGMA table_info(packs)')].map((c) => c.name);
      expect(columns).toEqual(['id', 'version', 'bytes', 'chunks']);

      // A second construction (every DO wake-up builds a new store) finds nothing to migrate.
      const again = new DoSqlStreamStore(state.storage, streamId);
      expect((await again.listPacks()).map((p) => p.id)).toEqual(['legacy-pack']);
    });
  });
});
