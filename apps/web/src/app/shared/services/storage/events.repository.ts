import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import type { Event } from '@hk/protocol';
import { HkDb, type EventRow } from './dexie.db';

/**
 * Event log storage. Solo-phase contract (Task 16): this device is the only writer, so `append`
 * commits events locally by assigning each one's `seq` via `nextSeq` inside a single Dexie
 * transaction — no separate "pending, then confirm" round trip is needed until Phase 2 sync
 * exists. `assignSeqs` and the `pendingOrder` row field are that future sync hook's storage
 * shape, laid down now so `byStream`'s ordering contract (committed by `seq` asc, then any
 * seq-less row by `pendingOrder` asc) already holds for rows a sync layer writes directly.
 */
@Injectable({ providedIn: 'root' })
export class EventsRepository {
  private readonly db = inject(HkDb);

  /**
   * Appends `events` in one `'rw'` transaction, assigning each a contiguous per-stream `seq` via
   * `nextSeq` (so two interleaved streams in one call each still get 1..n, gap-free); rejects —
   * and applies nothing, the whole transaction aborts — if any `id` already exists.
   */
  async append(events: readonly Event[]): Promise<void> {
    if (events.length === 0) return;
    await this.db.transaction('rw', this.db.events, async () => {
      const nextByStream = new Map<string, number>();
      const rows: EventRow[] = [];
      for (const event of events) {
        const prev = nextByStream.get(event.stream);
        const seq = prev === undefined ? await this.nextSeq(event.stream) : prev + 1;
        nextByStream.set(event.stream, seq);
        rows.push({ id: event.id, stream: event.stream, seq, json: { ...event, seq } });
      }
      await this.db.events.bulkAdd(rows);
    });
  }

  /** Committed events for `stream` by `seq` asc, then any seq-less (pending) row by `pendingOrder` asc. */
  async byStream(stream: string): Promise<Event[]> {
    const rows = await this.db.events.where('stream').equals(stream).toArray();
    const committed = rows
      .filter((row): row is EventRow & { seq: number } => row.seq !== undefined)
      .sort((a, b) => a.seq - b.seq);
    const pending = rows
      .filter((row) => row.seq === undefined)
      .sort((a, b) => (a.pendingOrder ?? 0) - (b.pendingOrder ?? 0));
    return [...committed, ...pending].map((row) => row.json);
  }

  /** Max committed `seq` for `stream`, plus 1 — an index-only lookup on `[stream+seq]`, never a table scan. */
  async nextSeq(stream: string): Promise<number> {
    const last = await this.db.events
      .where('[stream+seq]')
      .between([stream, Dexie.minKey], [stream, Dexie.maxKey])
      .last();
    return (last?.seq ?? 0) + 1;
  }

  /** Deletes every row of `stream` — the character-list delete flow (plan-5 Task 3,
   * `CharacterStore.deleteCharacter`). Other streams' rows are untouched. */
  async removeStream(stream: string): Promise<void> {
    await this.db.events.where('stream').equals(stream).delete();
  }

  /**
   * Atomically replaces every row of `stream` with `events`, IN THE GIVEN ORDER — one Dexie `'rw'`
   * transaction, so a reader never observes a half-deleted/half-written stream. Each event's `seq`
   * is rewritten to a fresh, gap-free `1..n` from its position in `events` (the caller — Task 10's
   * `HeroReaderService` — has already decided that order: verbatim source order for a brand-new
   * stream, or a merge-by-id re-sort for an existing one); any `seq` the event itself already
   * carried (e.g. `.hero` import events, which keep their ORIGINAL source seq until this call) is
   * discarded in favor of the position-based one. Event `id`s are preserved untouched. An empty
   * `events` array still deletes the stream's existing rows, leaving it empty (never called with
   * an empty array today, but a correct no-op either way).
   */
  async replaceStream(stream: string, events: readonly Event[]): Promise<void> {
    await this.db.transaction('rw', this.db.events, async () => {
      await this.db.events.where('stream').equals(stream).delete();
      const rows: EventRow[] = events.map((event, index) => {
        const seq = index + 1;
        return { id: event.id, stream, seq, json: { ...event, stream, seq } };
      });
      if (rows.length > 0) {
        await this.db.events.bulkAdd(rows);
      }
    });
  }

  /**
   * Future sync hook: once a server has ordered this stream's pending (seq-less) events, it
   * assigns their authoritative seqs starting at `startSeq` from `fromId` (inclusive) onward, in
   * `pendingOrder`. Not exercised by this device's own solo-phase `append`; a `fromId` not found
   * among the stream's pending rows is a no-op.
   */
  async assignSeqs(stream: string, fromId: string, startSeq: number): Promise<void> {
    await this.db.transaction('rw', this.db.events, async () => {
      const pending = await this.db.events
        .where('stream')
        .equals(stream)
        .filter((row) => row.seq === undefined)
        .sortBy('pendingOrder');
      const fromIndex = pending.findIndex((row) => row.id === fromId);
      if (fromIndex === -1) return;
      const updates = pending.slice(fromIndex).map((row, i) => {
        const seq = startSeq + i;
        return { ...row, seq, json: { ...row.json, seq } };
      });
      await this.db.events.bulkPut(updates);
    });
  }
}
