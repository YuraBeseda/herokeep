import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ENGINE_VERSION } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { LeaderService } from '@shared/services/storage/leader.service';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';
import { PackStore } from '@shared/stores/pack.store';
import { CharacterStore, CharacterStoreNotLeaderError, SyncGapError } from './character.store';

// The `pretest` script (apps/web/package.json) runs `pnpm --filter @hk/content build:pack` first,
// so the real built pack is always on disk before this file runs — same fixture-loading approach
// as `engine.facade.spec.ts`; a real pack is preferred over a minimal fixture per task-2-brief.md.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

/**
 * `navigator.locks` is absent in jsdom — mirrors `leader.service.spec.ts`'s stub exactly (see
 * that file's header comment for why): a single-holder exclusive-lock queue, just enough for
 * `LeaderService`'s own usage.
 */
class StubLockManager {
  private held = false;
  private readonly queue: (() => void)[] = [];

  request(
    _name: string,
    _options: { mode?: string },
    callback: () => Promise<void>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const attempt = (): void => {
        if (this.held) {
          this.queue.push(attempt);
          return;
        }
        this.held = true;
        callback().then(
          () => {
            this.held = false;
            resolve();
            this.queue.shift()?.();
          },
          (err: unknown) => {
            this.held = false;
            reject(err instanceof Error ? err : new Error(String(err)));
            this.queue.shift()?.();
          },
        );
      };
      attempt();
    });
  }
}

function installStubLocks(): StubLockManager {
  const stub = new StubLockManager();
  (navigator as unknown as { locks?: StubLockManager }).locks = stub;
  return stub;
}

function removeLocks(): void {
  delete (navigator as unknown as { locks?: StubLockManager }).locks;
}

/** Configures the TestBed with the real core pack and a stubbed `StoragePersistService`. `ready`
 * is a real `WritableSignal` (default `true`) tests can flip to exercise `load()`'s readiness
 * gate — mutating it doesn't require reconfiguring the TestBed module, which MUST NOT happen
 * after any `TestBed.inject` call (including `beforeEach`'s `HkDb` inject) — Angular refuses to
 * reconfigure a TestBed module once it has been instantiated. */
function configure(): {
  requestPersist: ReturnType<typeof vi.fn>;
  readyState: WritableSignal<boolean>;
} {
  const requestPersist = vi.fn().mockResolvedValue(true);
  const readyState = signal(true);
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: readyState, corePack: signal(corePack) },
      },
      { provide: StoragePersistService, useValue: { requestPersist } },
    ],
  });
  return { requestPersist, readyState };
}

describe('CharacterStore', () => {
  let requestPersist: ReturnType<typeof vi.fn>;
  let readyState: WritableSignal<boolean>;

  beforeEach(async () => {
    ({ requestPersist, readyState } = configure());
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.settings.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
    ]);
  });

  afterEach(() => {
    removeLocks();
    TestBed.inject(HkDb).close();
  });

  it('create appends one character.created event at seq 1, upserts the character row, and requests persistence once', async () => {
    const store = TestBed.inject(CharacterStore);

    const streamId = await store.create('Aria', 'feminine');

    expect(streamId).toMatch(
      /^char:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(store.streamId()).toBe(streamId);
    expect(store.loaded()).toBe(true);

    const events = await TestBed.inject(EventsRepository).byStream(streamId);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('character.created');
    expect(events[0]?.seq).toBe(1);
    expect(events[0]?.actor.userId).toBe('local');
    expect(events[0]?.actor.role).toBe('owner');
    expect(typeof events[0]?.actor.deviceId).toBe('string');

    const row = await TestBed.inject(CharactersRepository).get(streamId);
    expect(row?.name).toBe('Aria');

    expect(requestPersist).toHaveBeenCalledTimes(1);

    // A second character must not request persistence again — only the FIRST successful create.
    await store.create('Second', 'masculine');
    expect(requestPersist).toHaveBeenCalledTimes(1);
  });

  it('sheet/outstanding reflect the real engine over the freshly created character', async () => {
    const store = TestBed.inject(CharacterStore);

    await store.create('Aria', 'feminine');

    expect(store.facts()?.name).toBe('Aria');
    expect(store.sheet()?.name).toBe('Aria');
    expect(store.sheet()?.level).toBe(0);
    // No class/abilities chosen yet: creation-time choices are outstanding.
    expect(store.outstanding().length).toBeGreaterThan(0);
    expect(store.advancements()).toEqual([]); // level 0 — nothing to advance yet
  });

  it('load of an existing stream reduces to the same facts as the incrementally-built store', async () => {
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Renamed' } }]);

    const freshStore = TestBed.runInInjectionContext(() => new CharacterStore());
    await freshStore.load(streamId);

    expect(freshStore.streamId()).toBe(streamId);
    expect(freshStore.loaded()).toBe(true);
    expect(freshStore.facts()).toEqual(store.facts());
    expect(freshStore.sheet()?.name).toBe('Renamed');
  });

  it('appendTx of 3 drafts shares one txId, persists all of them, and updates facts/events', async () => {
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');

    await store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'One' } },
      { type: 'character.renamed', v: 1, payload: { name: 'Two' } },
      { type: 'character.renamed', v: 1, payload: { name: 'Three' } },
    ]);

    expect(store.facts()?.name).toBe('Three');
    expect(store.events()).toHaveLength(4); // created + 3 renames

    const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
    const renames = persisted.filter((e) => e.type === 'character.renamed');
    expect(renames).toHaveLength(3);
    const txIds = new Set(renames.map((e) => e.txId));
    expect(txIds.size).toBe(1);
    expect([...txIds][0]).toBeDefined();
    expect(renames.map((e) => e.seq)).toEqual([2, 3, 4]);
  });

  it('appendTx of a single draft assigns no txId', async () => {
    const store = TestBed.inject(CharacterStore);
    await store.create('Aria', 'feminine');

    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Solo' } }]);

    const last = store.events().at(-1);
    expect(last?.txId).toBeUndefined();
  });

  it('revert by txId removes the snapshot and the sheet reflects the pre-tx state', async () => {
    const store = TestBed.inject(CharacterStore);
    await store.create('Aria', 'feminine');
    const nameBeforeTx = store.facts()?.name;

    await store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Interim' } },
      { type: 'character.renamed', v: 1, payload: { name: 'Final' } },
    ]);
    expect(store.facts()?.name).toBe('Final');
    const txId = store.events().at(-1)?.txId;
    expect(txId).toBeDefined();

    const snapshotsRepository = TestBed.inject(SnapshotsRepository);
    const removeSpy = vi.spyOn(snapshotsRepository, 'remove');

    await store.revert({ txId }, 'test revert');

    expect(removeSpy).toHaveBeenCalledWith(store.streamId());
    expect(store.facts()?.name).toBe(nameBeforeTx);
    expect(store.sheet()?.name).toBe(nameBeforeTx);

    const persisted = await TestBed.inject(EventsRepository).byStream(store.streamId()!);
    expect(persisted.at(-1)?.type).toBe('event.reverted');
  });

  it('skippedIds reflects facts().skipped for a reverted event, and only that event', async () => {
    const store = TestBed.inject(CharacterStore);
    await store.create('Aria', 'feminine');
    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Interim' } }]);
    const targetId = store.events().at(-1)!.id;
    expect(store.skippedIds().has(targetId)).toBe(false);

    await store.revert({ eventId: targetId }, 'test revert');

    expect(store.skippedIds()).toEqual(new Set([targetId]));
    expect(store.facts()?.skipped).toEqual([{ eventId: targetId, reason: 'reverted' }]);
    // The `event.reverted` event itself is never skipped (reducer.ts: "always applies as a
    // no-op") — it must not show up in `skippedIds` alongside its target.
    const revertEventId = store.events().at(-1)!.id;
    expect(store.skippedIds().has(revertEventId)).toBe(false);
  });

  it('rejects create/appendTx/revert when this tab is not the leader', async () => {
    installStubLocks();
    // Another tab grabs the writer lock first and never releases it, so this test's own
    // CharacterStore (constructed below) queues behind it and never becomes leader.
    const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
    await otherTab.acquire();

    const store = TestBed.inject(CharacterStore);

    await expect(store.create('Aria', 'feminine')).rejects.toThrow(CharacterStoreNotLeaderError);
    await expect(
      store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'X' } }]),
    ).rejects.toThrow(CharacterStoreNotLeaderError);
    await expect(store.revert({ eventId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(
      CharacterStoreNotLeaderError,
    );
  });

  it('writes a snapshot once more than 100 events have accumulated since the last one', async () => {
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');
    const snapshotsRepository = TestBed.inject(SnapshotsRepository);
    const putSpy = vi.spyOn(snapshotsRepository, 'put');

    const drafts = Array.from({ length: 101 }, (_, i) => ({
      type: 'character.renamed',
      v: 1,
      payload: { name: `Name ${i}` },
    }));
    await store.appendTx(drafts);

    expect(putSpy).toHaveBeenCalledTimes(1);
    const [putStreamId, snapshot] = putSpy.mock.calls[0];
    expect(putStreamId).toBe(streamId);
    expect(snapshot.seq).toBe(102); // 1 (created) + 101 renames
  });

  it('serializes two overlapping appendTx calls: contiguous seqs, signals match a fresh replay', async () => {
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');

    // Neither call is awaited before the other fires — this is exactly the double-fired-UI-action
    // race the in-store queue (`enqueue`) exists to serialize.
    const first = store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'First' } }]);
    const second = store.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Second' } },
    ]);
    await Promise.all([first, second]);

    const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
    expect(persisted.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(new Set(persisted.map((e) => e.seq)).size).toBe(3); // no clobbered/duplicate seq

    // Call order is preserved (synchronous `enqueue` in call order): "First" lands at seq 2,
    // "Second" at seq 3, so the final name is "Second".
    expect(store.facts()?.name).toBe('Second');

    const freshStore = TestBed.runInInjectionContext(() => new CharacterStore());
    await freshStore.load(streamId);
    expect(store.facts()).toEqual(freshStore.facts());
    expect(store.events().map((e) => e.id)).toEqual(freshStore.events().map((e) => e.id));
  });

  it('a rejected queued call does not poison the queue for the next one', async () => {
    const store = TestBed.inject(CharacterStore);
    await store.create('Aria', 'feminine');

    await expect(
      store.appendTx([{ type: 'not.a.real.event', v: 1, payload: {} }]),
    ).rejects.toThrow();

    await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Recovered' } }]);
    expect(store.facts()?.name).toBe('Recovered');
  });

  it('appendTx rejects an "event.reverted" draft — it must go through revert()', async () => {
    const store = TestBed.inject(CharacterStore);
    await store.create('Aria', 'feminine');

    await expect(
      store.appendTx([
        {
          type: 'event.reverted',
          v: 1,
          payload: { targetId: '00000000-0000-4000-8000-000000000000' },
        },
      ]),
    ).rejects.toThrow(/revert/);
  });

  it('deleteCharacter removes the character row, its snapshot, and every event row for the stream', async () => {
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');
    const snapshotsRepository = TestBed.inject(SnapshotsRepository);
    await snapshotsRepository.put(streamId, {
      seq: 1,
      facts: store.facts()!,
      engineVersion: ENGINE_VERSION,
    });

    await store.deleteCharacter(streamId);

    expect(await TestBed.inject(CharactersRepository).get(streamId)).toBeUndefined();
    expect(await snapshotsRepository.get(streamId)).toBeUndefined();
    expect(await TestBed.inject(EventsRepository).byStream(streamId)).toEqual([]);
  });

  it('deleteCharacter of the currently loaded stream clears this store back to unloaded', async () => {
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');

    await store.deleteCharacter(streamId);

    expect(store.streamId()).toBeUndefined();
    expect(store.loaded()).toBe(false);
    expect(store.facts()).toBeUndefined();
    expect(store.events()).toEqual([]);
  });

  it('deleteCharacter leaves another loaded stream untouched', async () => {
    const store = TestBed.inject(CharacterStore);
    const keptStreamId = await store.create('Kept', 'feminine');
    const otherStore = TestBed.runInInjectionContext(() => new CharacterStore());
    const deletedStreamId = await otherStore.create('Gone', 'masculine');

    await store.deleteCharacter(deletedStreamId);

    expect(store.streamId()).toBe(keptStreamId);
    expect(store.loaded()).toBe(true);
    expect(store.facts()?.name).toBe('Kept');
  });

  it('rejects deleteCharacter when this tab is not the leader', async () => {
    installStubLocks();
    const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
    await otherTab.acquire();

    const store = TestBed.inject(CharacterStore);

    await expect(
      store.deleteCharacter('char:00000000-0000-4000-8000-000000000099'),
    ).rejects.toThrow(CharacterStoreNotLeaderError);
  });

  it('load awaits PackStore readiness before resolving; the sheet is defined once it does', async () => {
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine'); // packs are ready for this part

    readyState.set(false);
    const freshStore = TestBed.runInInjectionContext(() => new CharacterStore());
    let resolved = false;
    const loadPromise = freshStore.load(streamId).then(() => {
      resolved = true;
    });

    // Real (unfaked) timers: give the readiness poll a few turns while still not ready.
    await new Promise((r) => setTimeout(r, 30));
    expect(resolved).toBe(false);
    expect(freshStore.loaded()).toBe(false);

    readyState.set(true);
    await loadPromise;

    expect(resolved).toBe(true);
    expect(freshStore.loaded()).toBe(true);
    expect(freshStore.sheet()).toBeDefined();
    expect(freshStore.sheet()?.name).toBe('Aria');
  });

  // --- dev-mode perf log (plan-6 Task 13, Global Constraints' perf-acceptance bullet) ----------

  it('load logs a dev-mode [perf] reduce+derive line with a numeric ms argument', async () => {
    const store = TestBed.inject(CharacterStore);
    const streamId = await store.create('Aria', 'feminine');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const freshStore = TestBed.runInInjectionContext(() => new CharacterStore());
    await freshStore.load(streamId);

    const perfCall = infoSpy.mock.calls.find(([label]) => label === '[perf] reduce+derive');
    expect(perfCall).toBeDefined();
    expect(typeof perfCall?.[1]).toBe('number');

    infoSpy.mockRestore();
  });

  // --- runExclusive / reloadIfCurrent (fix-round 1, Critical finding: serialize `.hero` import
  // against this store's own mutation queue) --------------------------------------------------

  it('runExclusive chains onto the SAME queue as create/appendTx/revert/load — its callback cannot start until an already-in-flight mutation has fully settled', async () => {
    const store = TestBed.inject(CharacterStore);
    const eventsRepository = TestBed.inject(EventsRepository);

    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let gateHit = false;
    const originalAppend = eventsRepository.append.bind(eventsRepository);
    vi.spyOn(eventsRepository, 'append').mockImplementationOnce(async (events) => {
      gateHit = true;
      await gate;
      return originalAppend(events);
    });

    const createPromise = store.create('Parked', 'masculine');
    // `create()` reaches the gated `append` call only after a real fake-indexeddb round trip
    // (`buildAndValidate`'s own `nextSeq` read) — that needs actual macrotask ticks, not just
    // flushed microtasks, hence `setTimeout` rather than `Promise.resolve()` here.
    for (let i = 0; i < 50 && !gateHit; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(gateHit).toBe(true); // create() is now parked mid-flight, inside the queue

    let exclusiveRan = false;
    const exclusivePromise = store.runExclusive(() => {
      exclusiveRan = true;
      return Promise.resolve();
    });

    // create()'s gated `append` call hasn't resolved yet — no matter how many turns we give it,
    // runExclusive's callback must NOT have run, because it is queued strictly behind create()'s
    // own still-in-flight operation.
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(exclusiveRan).toBe(false);

    releaseGate();
    await createPromise;
    await exclusivePromise;

    expect(exclusiveRan).toBe(true);
  });

  it('reloadIfCurrent re-runs a full replay when the id matches the currently loaded stream, and no-ops otherwise', async () => {
    const store = TestBed.inject(CharacterStore);
    const eventsRepository = TestBed.inject(EventsRepository);
    const streamId = await store.create('Aria', 'feminine');
    expect(store.events()).toHaveLength(1);

    // Appended directly via the repository, bypassing the store — its in-memory state goes stale
    // (still shows just the 1 event above) until `reloadIfCurrent` forces a fresh replay.
    await eventsRepository.append([
      {
        id: '11111111-1111-4111-8111-111111111111',
        stream: streamId,
        ts: new Date().toISOString(),
        actor: { userId: 'u', deviceId: 'd', role: 'owner' },
        type: 'character.renamed',
        v: 1,
        payload: { name: 'Renamed Directly' },
      },
    ]);
    expect(store.events()).toHaveLength(1); // still stale

    await store.reloadIfCurrent(streamId);

    expect(store.events()).toHaveLength(2);
    expect(store.facts()?.name).toBe('Renamed Directly');

    // A non-matching id is a pure no-op — same facts object, not even re-derived.
    const before = store.facts();
    await store.reloadIfCurrent('char:00000000-0000-4000-8000-000000000000');
    expect(store.facts()).toBe(before);
  });

  // --- Phase 2 Task 6: sync seam (pending rows + server-apply surface) -----------------------

  describe('sync seam', () => {
    it('appendTx writes seq-less pending rows once enterSyncMode is on, and the sheet reflects them immediately', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      store.enterSyncMode(streamId);

      await store.appendTx([
        { type: 'character.renamed', v: 1, payload: { name: 'Pending Name' } },
      ]);

      expect(store.facts()?.name).toBe('Pending Name');
      expect(store.sheet()?.name).toBe('Pending Name');
      const last = store.events().at(-1);
      expect(last?.type).toBe('character.renamed');
      expect(last?.seq).toBeUndefined();

      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.at(-1)?.seq).toBeUndefined();
    });

    it('onLocalAppend fires with the pending events after the write has committed, and not for non-syncing streams', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');

      const calls: { streamId: string; events: unknown[] }[] = [];
      const unsubscribe = store.onLocalAppend((sid, events) =>
        calls.push({ streamId: sid, events }),
      );

      // Not syncing yet — appendTx must NOT notify.
      await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Not synced' } }]);
      expect(calls).toHaveLength(0);

      store.enterSyncMode(streamId);
      await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Synced' } }]);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.streamId).toBe(streamId);
      expect(calls[0]?.events).toHaveLength(1);

      // The row must already be durably written by the time the listener fires.
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.at(-1)?.seq).toBeUndefined();

      unsubscribe();
      await store.appendTx([
        { type: 'character.renamed', v: 1, payload: { name: 'After unsubscribe' } },
      ]);
      expect(calls).toHaveLength(1); // still 1 — unsubscribed
    });

    it('leaveSyncMode returns appendTx to local-committed writes, byte-identical to logged-out mode', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      store.enterSyncMode(streamId);
      await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Pending' } }]);
      expect(store.events().at(-1)?.seq).toBeUndefined();

      store.leaveSyncMode(streamId);
      await store.appendTx([
        { type: 'character.renamed', v: 1, payload: { name: 'Committed Again' } },
      ]);

      const last = store.events().at(-1);
      expect(last?.type).toBe('character.renamed');
      expect(last?.seq).toBeDefined();
      expect(store.facts()?.name).toBe('Committed Again');

      // The earlier "Pending" row is still pending (leaveSyncMode never touches it — see its own
      // doc), so `byStream`'s committed-then-pending ordering puts it AFTER this newly-committed
      // row; look it up by id rather than assuming array position.
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.find((e) => e.id === last!.id)?.seq).toBeDefined();
      expect(persisted.filter((e) => e.seq === undefined)).toHaveLength(1); // the earlier "Pending" row
    });

    it('revert() goes through the pending path when syncing: the reverted event itself is seq-less, and onLocalAppend fires for it', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      const nameBeforeRename = store.facts()?.name;
      store.enterSyncMode(streamId);
      await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Interim' } }]);
      const targetId = store.events().at(-1)!.id;

      const calls: unknown[] = [];
      store.onLocalAppend((_sid, events) => calls.push(...events));

      await store.revert({ eventId: targetId }, 'test revert while syncing');

      expect(store.facts()?.name).toBe(nameBeforeRename);
      const revertEvent = store.events().at(-1);
      expect(revertEvent?.type).toBe('event.reverted');
      expect(revertEvent?.seq).toBeUndefined();
      expect(calls).toHaveLength(1);
    });

    it('commitPending: a full ack commits the pending rows at their server seqs; sheet/domain facts are unchanged', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      store.enterSyncMode(streamId);
      await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Synced Name' } }]);
      const pendingEvent = store.events().at(-1)!;
      const sheetBefore = store.sheet();

      await store.commitPending(streamId, [{ id: pendingEvent.id, seq: 2 }]);

      expect(store.sheet()).toEqual(sheetBefore);
      expect(store.facts()?.name).toBe('Synced Name');
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      const committed = persisted.find((e) => e.id === pendingEvent.id);
      expect(committed?.seq).toBe(2);
    });

    it('commitPending: a PARTIAL prefix ack commits only the acked rows, leaving the rest pending', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      store.enterSyncMode(streamId);
      await store.appendTx([
        { type: 'character.renamed', v: 1, payload: { name: 'One' } },
        { type: 'character.renamed', v: 1, payload: { name: 'Two' } },
        { type: 'character.renamed', v: 1, payload: { name: 'Three' } },
      ]);
      const persistedBefore = await TestBed.inject(EventsRepository).byStream(streamId);
      const pending = persistedBefore.filter((e) => e.seq === undefined);
      expect(pending).toHaveLength(3);

      await store.commitPending(streamId, [{ id: pending[0].id, seq: 2 }]);

      const persistedAfter = await TestBed.inject(EventsRepository).byStream(streamId);
      const stillPending = persistedAfter.filter((e) => e.seq === undefined);
      expect(stillPending.map((e) => e.id)).toEqual([pending[1].id, pending[2].id]);
      const nowCommitted = persistedAfter.find((e) => e.id === pending[0].id);
      expect(nowCommitted?.seq).toBe(2);
      // Facts still reflect ALL three renames (two of them still pending) — the ack didn't lose data.
      expect(store.facts()?.name).toBe('Three');
    });

    it('commitPending throws SyncGapError on an ack-seq mismatch, and writes nothing', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      store.enterSyncMode(streamId);
      await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Pending' } }]);
      const pendingEvent = store.events().at(-1)!;

      // Local committed head is 1 (character.created); expected next seq is 2 — 99 is wrong.
      await expect(
        store.commitPending(streamId, [{ id: pendingEvent.id, seq: 99 }]),
      ).rejects.toThrow(SyncGapError);

      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.find((e) => e.id === pendingEvent.id)?.seq).toBeUndefined();
    });

    it('dropPending removes the named pending rows, drops the snapshot, and replays without them', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      const nameBeforePending = store.facts()?.name;
      store.enterSyncMode(streamId);
      await store.appendTx([
        { type: 'character.renamed', v: 1, payload: { name: 'Rejected Name' } },
      ]);
      const rejectedId = store.events().at(-1)!.id;

      const snapshotsRepository = TestBed.inject(SnapshotsRepository);
      const removeSpy = vi.spyOn(snapshotsRepository, 'remove');

      await store.dropPending(streamId, [rejectedId]);

      expect(removeSpy).toHaveBeenCalledWith(streamId);
      expect(store.facts()?.name).toBe(nameBeforePending);
      expect(store.events().some((e) => e.id === rejectedId)).toBe(false);
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.some((e) => e.id === rejectedId)).toBe(false);
    });

    it('applyServerCommit appends events at their given server seqs and updates the sheet', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      const actor = store.events()[0].actor;

      const serverEvent = {
        id: '22222222-2222-4222-8222-222222222222',
        stream: streamId,
        seq: 2,
        ts: new Date().toISOString(),
        actor,
        type: 'character.renamed',
        v: 1,
        payload: { name: 'From Server' },
      };

      await store.applyServerCommit(streamId, [serverEvent]);

      expect(store.facts()?.name).toBe('From Server');
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.find((e) => e.id === serverEvent.id)?.seq).toBe(2);
    });

    it('applyServerCommit dedupes an echo of an already-committed event silently', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      const actor = store.events()[0].actor;

      const serverEvent = {
        id: '33333333-3333-4333-8333-333333333333',
        stream: streamId,
        seq: 2,
        ts: new Date().toISOString(),
        actor,
        type: 'character.renamed',
        v: 1,
        payload: { name: 'Echoed' },
      };
      await store.applyServerCommit(streamId, [serverEvent]);
      expect(store.facts()?.name).toBe('Echoed');

      // The exact same event arrives again (a genuine echo) — must be a silent no-op, no crash.
      await expect(store.applyServerCommit(streamId, [serverEvent])).resolves.toBeUndefined();

      expect(store.facts()?.name).toBe('Echoed');
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.filter((e) => e.id === serverEvent.id)).toHaveLength(1);
    });

    it('applyServerCommit throws SyncGapError without writing when the incoming seq skips ahead of the local head', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      const actor = store.events()[0].actor;

      const gappy = {
        id: '44444444-4444-4444-8444-444444444444',
        stream: streamId,
        seq: 5, // local head is 1 (character.created); expected next is 2
        ts: new Date().toISOString(),
        actor,
        type: 'character.renamed',
        v: 1,
        payload: { name: 'Too Far' },
      };

      await expect(store.applyServerCommit(streamId, [gappy])).rejects.toThrow(SyncGapError);

      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.some((e) => e.id === gappy.id)).toBe(false);
      expect(store.facts()?.name).toBe('Aria');
    });

    it('resetStreamFromServer rebuilds the stream from a fresh server event array', async () => {
      const store = TestBed.inject(CharacterStore);
      const streamId = await store.create('Aria', 'feminine');
      await store.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Local Only' } }]);
      const actor = store.events()[0].actor;

      const restored = [
        {
          id: '55555555-5555-4555-8555-555555555555',
          stream: streamId,
          seq: 1,
          ts: new Date().toISOString(),
          actor,
          type: 'character.created',
          v: 1,
          payload: {
            name: 'Restored',
            system: store.facts()?.system,
            corePack: { id: corePack.id, version: corePack.version },
            engineVersion: ENGINE_VERSION,
            grammaticalGender: 'feminine',
          },
        },
      ];

      await store.resetStreamFromServer(streamId, restored);

      expect(store.facts()?.name).toBe('Restored');
      expect(store.events()).toHaveLength(1);
      const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
      expect(persisted.map((e) => e.id)).toEqual([restored[0].id]);
    });

    it('rejects the four server-apply methods and enterSyncMode-gated appends when this tab is not the leader', async () => {
      installStubLocks();
      const otherTab = TestBed.runInInjectionContext(() => new LeaderService());
      await otherTab.acquire();

      const store = TestBed.inject(CharacterStore);
      const streamId = 'char:00000000-0000-4000-8000-000000000099';

      await expect(store.applyServerCommit(streamId, [])).rejects.toThrow(
        CharacterStoreNotLeaderError,
      );
      await expect(store.commitPending(streamId, [])).rejects.toThrow(CharacterStoreNotLeaderError);
      await expect(store.dropPending(streamId, [])).rejects.toThrow(CharacterStoreNotLeaderError);
      await expect(store.resetStreamFromServer(streamId, [])).rejects.toThrow(
        CharacterStoreNotLeaderError,
      );
    });
  });
});
