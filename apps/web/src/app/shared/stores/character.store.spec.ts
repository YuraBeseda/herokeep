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
import { CharacterStore, CharacterStoreNotLeaderError } from './character.store';

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
});
