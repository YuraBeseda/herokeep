/**
 * In-memory `StreamStore` double for Task 5's stream-actor tests (implements the FULL port
 * contract, including the `findByIds` dedupe extension — ports/stream.ts's doc comment). One
 * instance models exactly one stream: `append` assigns contiguous `seq` starting at
 * `1 + (events already held)`, matching the real adapters' "one stream per store instance"
 * scoping (ports/stream.ts's class doc comment).
 */
import type { StoredEvent } from '../../src/ports/stream.ts';
import type { AppendResult, StoredPack, StreamStore } from '../../src/ports/stream.ts';

export class FakeStreamStore implements StreamStore {
  private readonly events: StoredEvent[] = [];
  private readonly meta = new Map<string, string>();
  private readonly packs = new Map<string, StoredPack>();

  append(events: StoredEvent[]): Promise<AppendResult> {
    const firstSeq = this.events.length + 1;
    let seq = firstSeq;
    for (const event of events) {
      this.events.push({ ...event, seq });
      seq += 1;
    }
    return Promise.resolve({ firstSeq, lastSeq: seq - 1 });
  }

  read(fromSeq: number, limit: number): Promise<StoredEvent[]> {
    return Promise.resolve(this.events.filter((e) => (e.seq ?? 0) >= fromSeq).slice(0, limit));
  }

  head(): Promise<number> {
    return Promise.resolve(this.events.at(-1)?.seq ?? 0);
  }

  getMeta(key: string): Promise<string | undefined> {
    return Promise.resolve(this.meta.get(key));
  }

  setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
    return Promise.resolve();
  }

  findByIds(ids: string[]): Promise<StoredEvent[]> {
    const wanted = new Set(ids);
    return Promise.resolve(this.events.filter((e) => wanted.has(e.id)));
  }

  /** `ports/stream.ts`'s revert-target `txId` resolution extension (final whole-branch review,
   * second wave) — "ANY one" matching event, mirroring both real stores' `LIMIT 1` shape. */
  findAnyByTxId(txId: string): Promise<StoredEvent | undefined> {
    return Promise.resolve(this.events.find((e) => e.txId === txId));
  }

  putPack(id: string, version: string, json: unknown): Promise<void> {
    this.packs.set(id, { id, version, json });
    return Promise.resolve();
  }

  getPack(id: string): Promise<StoredPack | undefined> {
    return Promise.resolve(this.packs.get(id));
  }

  listPacks(): Promise<StoredPack[]> {
    return Promise.resolve([...this.packs.values()]);
  }

  /** Task 6's hard-delete surface (`ports/stream.ts`'s `StreamStore.deleteAll` doc comment) —
   * clears every in-memory collection this fake holds, matching the real contract: events, meta,
   * AND packs, all gone, no partial form. */
  deleteAll(): Promise<void> {
    this.events.length = 0;
    this.meta.clear();
    this.packs.clear();
    return Promise.resolve();
  }

  /** Test-only inspection hook — the count of events actually committed so far. */
  get length(): number {
    return this.events.length;
  }
}
