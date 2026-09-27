import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { PackStore } from '@shared/stores/pack.store';
import { seedFighter } from '../../../views/characters/sheet/testing/character-fixtures';
import {
  ForeignCharacterSession,
  type ForeignCharacterSyncPort,
} from './foreign-character-session';

// Real built SRD pack (same "prefer the real pack" precedent `party-overview-publisher.service
// .spec.ts`/`character.store.spec.ts` already establish) — `seedFighter` derives a REAL persisted
// character (hp 12 / ac 19 / level 1 fighter), which is exactly what this session's `reduce`+
// `derive` calls need to be exercised honestly.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

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

function bareCharacterId(streamId: string): string {
  return streamId.slice('char:'.length);
}

/** Records every `registerForeignEventsConsumer`/`subscribeForeignStream`/`unsubscribeForeignStream`
 * call this session makes, and lets the test drive frames straight into whatever callback the
 * session registered for a given campaignId — mirrors the real `SyncService`'s own contract
 * (task-5-report.md: "cb fires for every events frame addressed to a different stream... arrived
 * before registration is lost, never queued") without needing a live socket at all. */
class FakeSyncPort implements ForeignCharacterSyncPort {
  private readonly consumers = new Map<string, (stream: string, events: Event[]) => void>();
  readonly subscribeCalls: { campaignId: string; stream: string; lastSeq?: number }[] = [];
  readonly unsubscribeCalls: { campaignId: string; stream: string }[] = [];
  unregisterCalls = 0;

  registerForeignEventsConsumer(
    campaignId: string,
    cb: (stream: string, events: Event[]) => void,
  ): () => void {
    this.consumers.set(campaignId, cb);
    return () => {
      this.unregisterCalls++;
      if (this.consumers.get(campaignId) === cb) this.consumers.delete(campaignId);
    };
  }

  subscribeForeignStream(campaignId: string, stream: string, lastSeq?: number): void {
    this.subscribeCalls.push(
      lastSeq !== undefined ? { campaignId, stream, lastSeq } : { campaignId, stream },
    );
  }

  unsubscribeForeignStream(campaignId: string, stream: string): void {
    this.unsubscribeCalls.push({ campaignId, stream });
  }

  /** Test-only helper: delivers `events` as if they arrived over the campaign's live socket,
   * exactly like `SyncService`'s real `onForeignEvents` fan-out. */
  emit(campaignId: string, stream: string, events: Event[]): void {
    this.consumers.get(campaignId)?.(stream, events);
  }
}

describe('ForeignCharacterSession', () => {
  const campaignId = '00000000-0000-4000-8000-0000000000c1';
  let sync: FakeSyncPort;
  let packStore: { corePack: () => Pack | undefined };
  let engineFacade: EngineFacade;

  beforeEach(async () => {
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
          useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
        },
        {
          provide: StoragePersistService,
          useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
        },
      ],
    });
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.campaigns.clear(),
      db.blobs.clear(),
    ]);

    sync = new FakeSyncPort();
    packStore = { corePack: () => corePack };
    engineFacade = TestBed.inject(EngineFacade);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  function makeSession(
    characterId: string,
    opts: { timeoutMs?: number; packStoreOverride?: { corePack: () => Pack | undefined } } = {},
  ): ForeignCharacterSession {
    return new ForeignCharacterSession({
      campaignId,
      characterId,
      sync,
      packStore: opts.packStoreOverride ?? packStore,
      engineFacade,
      timeoutMs: opts.timeoutMs,
    });
  }

  it('start(): registers the foreign-events consumer and sends an initial subscribe with no lastSeq (full catch-up)', async () => {
    const streamId = await seedFighter('Ivan');
    const session = makeSession(bareCharacterId(streamId));

    session.start();

    expect(sync.subscribeCalls).toEqual([{ campaignId, stream: streamId }]);
    expect(session.status()).toBe('loading');
    expect(session.sheet()).toBeUndefined();
  });

  it('subscribe/catch-up assembly: a full real catch-up frame builds facts -> derives a real Sheet -> status "ready"', async () => {
    const streamId = await seedFighter('Ivan');
    const events = await TestBed.inject(EventsRepository).byStream(streamId);
    const session = makeSession(bareCharacterId(streamId));
    session.start();

    sync.emit(campaignId, streamId, events);

    expect(session.status()).toBe('ready');
    const sheet = session.sheet();
    expect(sheet?.hp.max.value).toBe(12);
    expect(sheet?.ac.value).toBe(19);
    expect(sheet?.level).toBe(1);
    expect(sheet?.classes).toEqual([{ classId: 'srd-5e-2024:class/fighter', level: 1 }]);
  });

  it('gap -> re-subscribe: a frame skipping ahead is discarded and this session re-subscribes from its own last known-good seq', async () => {
    const streamId = await seedFighter('Ivan');
    const allEvents = await TestBed.inject(EventsRepository).byStream(streamId);
    expect(allEvents.length).toBeGreaterThan(2); // fixture sanity — enough events to split a gap in

    const session = makeSession(bareCharacterId(streamId));
    session.start();

    const firstTwo = allEvents.slice(0, 2);
    sync.emit(campaignId, streamId, firstTwo);
    expect(session.status()).toBe('ready');
    const sheetAfterFirstTwo = session.sheet();

    // Skip event index 2 (seq 3) entirely — the next frame starts at seq 4, a genuine gap.
    const gappedFrame = allEvents.slice(3);
    sync.emit(campaignId, streamId, gappedFrame);

    expect(sync.subscribeCalls).toContainEqual({ campaignId, stream: streamId, lastSeq: 2 });
    // The gapped frame was entirely discarded — status/sheet stay exactly what they were.
    expect(session.status()).toBe('ready');
    expect(session.sheet()).toBe(sheetAfterFirstTwo);
  });

  it('duplicate-id tolerance: a frame re-delivering an already-applied id alongside a new contiguous one applies only the new one', async () => {
    const streamId = await seedFighter('Ivan');
    const allEvents = await TestBed.inject(EventsRepository).byStream(streamId);
    expect(allEvents.length).toBeGreaterThan(3);

    const session = makeSession(bareCharacterId(streamId));
    session.start();

    const firstThree = allEvents.slice(0, 3);
    sync.emit(campaignId, streamId, firstThree);
    expect(session.status()).toBe('ready');

    // Re-deliver event #3 (already applied — an overlapping catch-up/notify redelivery) alongside
    // the genuinely new event #4.
    const overlapping = [allEvents[2], allEvents[3]];
    sync.emit(campaignId, streamId, overlapping);

    // No spurious gap re-subscribe — the duplicate was silently skipped, not misread as a gap.
    expect(sync.subscribeCalls).toEqual([{ campaignId, stream: streamId }]);
    expect(session.status()).toBe('ready');
    expect(session.sheet()?.issues).toEqual([]); // reduce() never choked on the duplicate id
  });

  it('unauthorized-silent timeout: no frame ever arrives before timeoutMs -> status becomes "unauthorized"', async () => {
    const streamId = await seedFighter('Ivan');
    const session = makeSession(bareCharacterId(streamId), { timeoutMs: 15 });
    session.start();

    expect(session.status()).toBe('loading');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(session.status()).toBe('unauthorized');
    expect(session.sheet()).toBeUndefined();
  });

  it('a frame arriving before the timeout cancels it — status never regresses to "unauthorized" afterwards', async () => {
    const streamId = await seedFighter('Ivan');
    const events = await TestBed.inject(EventsRepository).byStream(streamId);
    const session = makeSession(bareCharacterId(streamId), { timeoutMs: 15 });
    session.start();

    sync.emit(campaignId, streamId, events);
    expect(session.status()).toBe('ready');

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(session.status()).toBe('ready'); // the (cleared) timeout never fired
  });

  it('unsubscribe cleanup: close() sends unsubscribe, unregisters the consumer, and further deliveries are ignored', async () => {
    const streamId = await seedFighter('Ivan');
    const events = await TestBed.inject(EventsRepository).byStream(streamId);
    const session = makeSession(bareCharacterId(streamId));
    session.start();
    sync.emit(campaignId, streamId, events.slice(0, 1));
    const sheetBeforeClose = session.sheet();

    session.close();

    expect(sync.unsubscribeCalls).toEqual([{ campaignId, stream: streamId }]);
    expect(sync.unregisterCalls).toBe(1);

    // A race — a frame delivered after close() (the real registry entry would already be gone;
    // this fake's own `emit` still has the reference) — must be a harmless no-op.
    sync.emit(campaignId, streamId, events);
    expect(session.sheet()).toBe(sheetBeforeClose);
  });

  it('close() before start() is a harmless no-op — nothing was ever subscribed, so nothing to unsubscribe', async () => {
    const streamId = await seedFighter('Ivan');
    const session = makeSession(bareCharacterId(streamId));

    expect(() => session.close()).not.toThrow();
    expect(sync.unsubscribeCalls).toEqual([]);
  });

  it('close() is idempotent — a second call after start()+close() sends unsubscribe exactly once', async () => {
    const streamId = await seedFighter('Ivan');
    const session = makeSession(bareCharacterId(streamId));

    session.start();
    session.close();
    session.close();
    expect(sync.unsubscribeCalls).toHaveLength(1);
  });

  it('pack mismatch: a locally-loaded core pack whose version disagrees with the character\'s pinned version -> status "error", no crash', async () => {
    const streamId = await seedFighter('Ivan');
    const events = await TestBed.inject(EventsRepository).byStream(streamId);
    const mismatchedCore = { ...corePack, version: '999.0.0' };
    const session = makeSession(bareCharacterId(streamId), {
      packStoreOverride: { corePack: () => mismatchedCore },
    });
    session.start();

    expect(() => sync.emit(campaignId, streamId, events)).not.toThrow();
    expect(session.status()).toBe('error');
    expect(session.sheet()).toBeUndefined();
  });

  it('pack mismatch: no core pack loaded at all -> status "error", no crash', async () => {
    const streamId = await seedFighter('Ivan');
    const events = await TestBed.inject(EventsRepository).byStream(streamId);
    const session = makeSession(bareCharacterId(streamId), {
      packStoreOverride: { corePack: () => undefined },
    });
    session.start();

    expect(() => sync.emit(campaignId, streamId, events)).not.toThrow();
    expect(session.status()).toBe('error');
  });

  it("ignores an events frame addressed to a DIFFERENT stream than this session's own", async () => {
    const streamId = await seedFighter('Ivan');
    const otherStreamId = 'char:11111111-1111-4111-8111-111111111111';
    const session = makeSession(bareCharacterId(streamId));
    session.start();

    sync.emit(campaignId, otherStreamId, [
      {
        id: '22222222-2222-7222-8222-222222222222',
        stream: otherStreamId,
        seq: 1,
        ts: new Date().toISOString(),
        actor: { userId: 'local', deviceId: 'd1', role: 'owner' },
        type: 'character.created',
        v: 1,
        payload: {
          name: 'Someone Else',
          system: 'srd-5e-2024',
          corePack: { id: corePack.id, version: corePack.version },
          engineVersion: '0.1.0',
          grammaticalGender: 'neuter',
        },
      },
    ]);

    expect(session.status()).toBe('loading');
    expect(session.sheet()).toBeUndefined();
  });
});
