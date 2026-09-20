import { inject, Injectable } from '@angular/core';
import Dexie from 'dexie';
import type { Event } from '@hk/protocol';
import { HkDb, type EventRow } from './dexie.db';

/**
 * Event log storage. Solo/logged-out contract (Task 16): `append` commits events locally by
 * assigning each one's `seq` via `nextSeq` inside a single Dexie transaction — no "pending, then
 * confirm" round trip. Phase 2 Task 6 (`CharacterStore`'s sync seam) is the first real use of the
 * pending lane this repository's shape was laid down for back then: `appendPending`/
 * `nextPendingOrder`/`removePending` write and manage seq-less rows at a monotonic `pendingOrder`;
 * `assignSeqs` (now with an optional partial-prefix `count`) and `appendCommittedAt` move
 * (respectively: reassign in place, or write fresh already-server-seq'd rows) events into the
 * committed lane. `byStream`'s ordering contract — committed by `seq` asc, then any seq-less row
 * by `pendingOrder` asc — holds across every one of these writers.
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
   * `pendingOrder`. `count`, when given, limits the assignment to that many rows starting at
   * `fromId` — a PARTIAL-prefix ack (`CharacterStore.commitPending`, Phase 2 Task 6: the server
   * may only have processed a prefix of what this device sent, leaving the rest pending for a
   * later ack); omitted, it assigns every pending row from `fromId` to the end, as before (Phase
   * 2's own full-ack case, and every pre-Phase-2 caller/spec). A `fromId` not found among the
   * stream's pending rows is a no-op.
   */
  async assignSeqs(
    stream: string,
    fromId: string,
    startSeq: number,
    count?: number,
  ): Promise<void> {
    await this.db.transaction('rw', this.db.events, async () => {
      const pending = await this.db.events
        .where('stream')
        .equals(stream)
        .filter((row) => row.seq === undefined)
        .sortBy('pendingOrder');
      const fromIndex = pending.findIndex((row) => row.id === fromId);
      if (fromIndex === -1) return;
      const slice =
        count === undefined
          ? pending.slice(fromIndex)
          : pending.slice(fromIndex, fromIndex + count);
      const updates = slice.map((row, i) => {
        const seq = startSeq + i;
        return { ...row, seq, json: { ...row.json, seq } };
      });
      await this.db.events.bulkPut(updates);
    });
  }

  /**
   * Appends `events` as PENDING rows (no `seq`) at contiguous `pendingOrder` values starting at
   * `startOrder` — the sync-mode counterpart to `append` (`CharacterStore.appendTx`'s pending
   * branch, Phase 2 Task 6, task-6-brief.md). One `'rw'` transaction; rejects — and applies
   * nothing, the whole transaction aborts — if any `id` already exists, exactly like `append`.
   */
  async appendPending(events: readonly Event[], startOrder: number): Promise<void> {
    if (events.length === 0) return;
    await this.db.transaction('rw', this.db.events, async () => {
      const rows: EventRow[] = events.map((event, i) => ({
        id: event.id,
        stream: event.stream,
        pendingOrder: startOrder + i,
        json: event,
      }));
      await this.db.events.bulkAdd(rows);
    });
  }

  /** Max `pendingOrder` among `stream`'s pending (seq-less) rows, plus 1 — 0 when there are none
   * yet. The append-side counterpart to `nextSeq`, for the pending lane. */
  async nextPendingOrder(stream: string): Promise<number> {
    const pending = await this.db.events
      .where('stream')
      .equals(stream)
      .filter((row) => row.seq === undefined)
      .toArray();
    return pending.reduce((max, row) => Math.max(max, (row.pendingOrder ?? -1) + 1), 0);
  }

  /**
   * Deletes `ids` from `stream`'s PENDING rows only — a row sharing one of `ids` that already has
   * a `seq` (e.g. raced by a concurrent `assignSeqs`/`commitPending`) is left untouched, never
   * dropped. `CharacterStore.dropPending`'s reject-drop path (Phase 2 Task 6).
   */
  async removePending(stream: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    await this.db.events
      .where('stream')
      .equals(stream)
      .filter((row) => row.seq === undefined && idSet.has(row.id))
      .delete();
  }

  /**
   * Appends `events` as COMMITTED rows AT THEIR OWN `seq` — never reassigned via `nextSeq`, unlike
   * `append` — for events that already carry a server-authoritative seq
   * (`CharacterStore.applyServerCommit`, Phase 2 Task 6). One `'rw'` transaction; rejects — and
   * applies nothing — if any `id` already exists (like `append`), or if any event lacks a `seq`.
   */
  async appendCommittedAt(events: readonly Event[]): Promise<void> {
    if (events.length === 0) return;
    await this.db.transaction('rw', this.db.events, async () => {
      const rows: EventRow[] = events.map((event) => {
        if (event.seq === undefined) {
          throw new Error('EventsRepository.appendCommittedAt: event.seq is required');
        }
        return { id: event.id, stream: event.stream, seq: event.seq, json: event };
      });
      await this.db.events.bulkAdd(rows);
    });
  }
}
