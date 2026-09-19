/**
 * In-memory `StreamHost` double for Task 6's character-route tests. One `FakeStreamStore` per
 * stream id, created lazily on first `.get()` (matching the real port's doc comment: "returning
 * (creating, on first access) its single-writer handle"). The returned `StreamHandle` only needs
 * `deleteAll` for these tests to be meaningful; `append`/`read`/`head`/`notify` are thin pass-
 * throughs to the backing store kept ONLY so this satisfies the real `StreamHandle` type (the
 * same "implement the full port contract" convention `fake-stream-store.ts` follows) — no test
 * in `characters.test.ts` exercises them through this handle (event-pipeline behavior is
 * `stream-actor.test.ts`'s job; this fake exists for delete/quota-freeing tests, not append
 * semantics).
 */
import type { Actor, Event } from '@hk/protocol';
import type { AppendResult, StreamHandle, StreamHost } from '../../src/ports/stream.ts';
import { FakeStreamStore } from './fake-stream-store.ts';

export class FakeStreamHost implements StreamHost {
  private readonly stores = new Map<string, FakeStreamStore>();

  get(streamId: string): StreamHandle {
    const store = this.storeFor(streamId, true);
    return {
      append: (events: Event[], _actor: Actor): Promise<AppendResult> => store.append(events),
      read: (fromSeq: number, limit: number): Promise<Event[]> => store.read(fromSeq, limit),
      head: (): Promise<number> => store.head(),
      notify: (): Promise<void> => Promise.resolve(),
      deleteAll: (): Promise<void> => store.deleteAll(),
    };
  }

  /** Test-only inspection: the `FakeStreamStore` backing `streamId`. Creates it (matching
   * `.get()`'s own lazy-creation semantics) unless `createIfMissing` is `false`, so a test can
   * seed events into a stream BEFORE the route under test ever calls `.get()` itself. */
  storeFor(streamId: string, createIfMissing = false): FakeStreamStore {
    let store = this.stores.get(streamId);
    if (!store && createIfMissing) {
      store = new FakeStreamStore();
      this.stores.set(streamId, store);
    }
    if (!store) throw new Error(`fake stream host: no store for ${streamId} yet`);
    return store;
  }

  /** Test-only inspection: whether `.get()` has ever been called for `streamId`. */
  has(streamId: string): boolean {
    return this.stores.has(streamId);
  }
}
