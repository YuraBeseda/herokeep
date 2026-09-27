import { signal, type Signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Event, MembersMsg } from '@hk/protocol';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { HkDb, type CampaignRow, type CharacterRow } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import type { SyncStateValue } from '@shared/services/sync/sync.service';
import { SyncService } from '@shared/services/sync/sync.service';
import { encodeBlobChunkFrame } from './blob-chunk-codec';
import {
  BLOB_IDLE_SCHEDULER,
  BLOB_REQUEST_TIMEOUT_MS,
  BlobTransferService,
  type BlobIdleScheduler,
} from './blob-transfer.service';

// --- fake SyncService — the real one needs a full socket harness (sync.service.spec.ts); this
// task only needs to verify BlobTransferService calls the RIGHT methods with the RIGHT arguments
// and reacts correctly to what those seams deliver back. ---------------------------------------

class FakeSyncService {
  private readonly liveIdsState = signal<ReadonlySet<string>>(new Set());
  readonly liveCampaignIds: Signal<ReadonlySet<string>> = this.liveIdsState.asReadonly();

  private readonly binaryConsumers = new Map<string, Set<(bytes: Uint8Array) => void>>();
  private readonly blobPullConsumers = new Map<string, Set<(hash: string, to: string) => void>>();
  private readonly blobUnavailableConsumers = new Map<string, Set<(hash: string) => void>>();
  private readonly membersSignals = new Map<string, WritableSignal<MembersMsg['members'] | null>>();
  private readonly syncStateSignals = new Map<string, WritableSignal<SyncStateValue>>();

  readonly sendBlobHave = vi.fn<SyncService['sendBlobHave']>();
  readonly sendBlobRequest = vi.fn<SyncService['sendBlobRequest']>();
  readonly sendBlobCancel = vi.fn<SyncService['sendBlobCancel']>();
  readonly sendBlobChunk = vi.fn<SyncService['sendBlobChunk']>();

  setLive(ids: readonly string[]): void {
    this.liveIdsState.set(new Set(ids));
  }

  registerBinaryFrameConsumer(campaignId: string, cb: (bytes: Uint8Array) => void): () => void {
    return register(this.binaryConsumers, campaignId, cb);
  }

  registerBlobPullConsumer(campaignId: string, cb: (hash: string, to: string) => void): () => void {
    return register(this.blobPullConsumers, campaignId, cb);
  }

  registerBlobUnavailableConsumer(campaignId: string, cb: (hash: string) => void): () => void {
    return register(this.blobUnavailableConsumers, campaignId, cb);
  }

  membersFor(campaignId: string): Signal<MembersMsg['members'] | null> {
    return this.membersSignal(campaignId).asReadonly();
  }

  setMembers(campaignId: string, members: MembersMsg['members']): void {
    this.membersSignal(campaignId).set(members);
  }

  syncState(streamId: string): Signal<SyncStateValue> {
    return this.syncStateSignal(streamId).asReadonly();
  }

  setSyncState(streamId: string, value: SyncStateValue): void {
    this.syncStateSignal(streamId).set(value);
  }

  emitBinary(campaignId: string, bytes: Uint8Array): void {
    for (const cb of this.binaryConsumers.get(campaignId) ?? []) cb(bytes);
  }

  emitBlobPull(campaignId: string, hash: string, to: string): void {
    for (const cb of this.blobPullConsumers.get(campaignId) ?? []) cb(hash, to);
  }

  emitBlobUnavailable(campaignId: string, hash: string): void {
    for (const cb of this.blobUnavailableConsumers.get(campaignId) ?? []) cb(hash);
  }

  private membersSignal(campaignId: string): WritableSignal<MembersMsg['members'] | null> {
    let sig = this.membersSignals.get(campaignId);
    if (!sig) {
      sig = signal<MembersMsg['members'] | null>(null);
      this.membersSignals.set(campaignId, sig);
    }
    return sig;
  }

  private syncStateSignal(streamId: string): WritableSignal<SyncStateValue> {
    let sig = this.syncStateSignals.get(streamId);
    if (!sig) {
      sig = signal<SyncStateValue>('offline');
      this.syncStateSignals.set(streamId, sig);
    }
    return sig;
  }
}

function register<T>(registry: Map<string, Set<T>>, key: string, cb: T): () => void {
  let set = registry.get(key);
  if (!set) {
    set = new Set();
    registry.set(key, set);
  }
  set.add(cb);
  return () => set.delete(cb);
}

async function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    TestBed.tick();
    await tick();
  }
}

// --- idle scheduler test double — a MANUALLY-DRAINED queue (never auto-runs synchronously) so a
// self-rearming loop (the DM super-peer tick) can never spin the test runner forever. -----------

function makeIdleScheduler(): { scheduler: BlobIdleScheduler; runNext: () => boolean } {
  const queue: (() => void)[] = [];
  return {
    scheduler: (fn) => queue.push(fn),
    runNext: () => {
      const fn = queue.shift();
      if (!fn) return false;
      fn();
      return true;
    },
  };
}

const CAMPAIGN_ID = '00000000-0000-4000-8000-000000000001';
const CAMPAIGN_STREAM = `camp:${CAMPAIGN_ID}`;
const CHARACTER_ID = '00000000-0000-4000-8000-0000000000aa';
const CHARACTER_STREAM = `char:${CHARACTER_ID}`;

function mkCharacterRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: CHARACTER_STREAM,
    name: 'Aria',
    system: 'srd-5e-2024',
    archived: false,
    updatedAt: 1000,
    ...overrides,
  };
}

function mkCampaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: CAMPAIGN_ID,
    name: 'Curse of Strahd',
    system: 'srd-5e-2024',
    role: 'player',
    lastSeq: 0,
    updatedAt: 1000,
    ...overrides,
  };
}

let nextEventId = 1;

function mkOverviewEvent(characterId: string, portraitThumb: string): Event {
  const id = `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream: CAMPAIGN_STREAM,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'usr_dm', deviceId: 'dev_1', role: 'dm' },
    type: 'party.overview_updated',
    v: 1,
    payload: {
      characterId,
      overview: {
        hp: 10,
        hpMax: 10,
        temp: 0,
        ac: 15,
        level: 1,
        classes: [],
        conditions: [],
        concentration: false,
        portraitThumb,
        passivePerception: 10,
      },
    },
  };
}

async function putBlobBytes(hash: string, bytes: Uint8Array): Promise<void> {
  await TestBed.inject(BlobsRepository).put(hash, 'image/webp', bytes);
}

describe('BlobTransferService', () => {
  let fakeSync: FakeSyncService;
  let idle: ReturnType<typeof makeIdleScheduler>;

  // `requestTimeoutMs` defaults generously high (5s) — real enough that NONE of the ordinary
  // (non-timeout-focused) tests below ever race it against `flush()`'s own real (if small)
  // wall-clock overhead; the ONE test that actually exercises the timeout path reconfigures the
  // TestBed with a small value BEFORE anything in this module is injected (`TestBed.inject(HkDb)`
  // below is what actually instantiates the module, so a later `configureTestingModule` call
  // would throw "already instantiated" — this helper is called EITHER from `beforeEach` with the
  // default, or once, standalone, from that one test, never both for the same test).
  async function setup(requestTimeoutMs = 5_000): Promise<void> {
    fakeSync = new FakeSyncService();
    idle = makeIdleScheduler();

    TestBed.configureTestingModule({
      providers: [
        { provide: SyncService, useValue: fakeSync },
        { provide: BLOB_IDLE_SCHEDULER, useValue: idle.scheduler },
        { provide: BLOB_REQUEST_TIMEOUT_MS, useValue: requestTimeoutMs },
      ],
    });

    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.settings.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
      db.campaigns.clear(),
    ]);
  }

  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    // Tears down every watcher this test started (cancels any pending retry/request-timeout
    // timer) BEFORE closing the database — otherwise a timer from one test can fire after a LATER
    // test's `HkDb` connection has already replaced it, throwing an unhandled `DatabaseClosedError`.
    fakeSync?.setLive([]);
    await flush();
    TestBed.inject(HkDb).close();
  });

  async function connectCampaign(role: CampaignRow['role'] = 'player'): Promise<void> {
    await TestBed.inject(CampaignsRepository).put(mkCampaignRow({ role }));
    TestBed.inject(BlobTransferService); // instantiate — its constructor effect starts watching
    fakeSync.setLive([CAMPAIGN_ID]);
    await flush();
    fakeSync.setSyncState(CAMPAIGN_STREAM, 'synced');
    await flush();
  }

  // --- P1/P2/P3 tier computation + announce -----------------------------------------------------

  it('on connect: announces every relevant hash already held, and requests the first missing one', async () => {
    await TestBed.inject(CharactersRepository).put(
      mkCharacterRow({ portraitThumbHash: 'sha256:' + 'a'.repeat(64) }),
    );
    await TestBed.inject(EventsRepository).append([
      mkOverviewEvent(CHARACTER_ID, 'sha256:' + 'a'.repeat(64)), // own char — joins the roster
    ]);
    // A held hash (already local) — should be ANNOUNCED, never requested.
    await putBlobBytes('sha256:' + 'a'.repeat(64), new Uint8Array([1]));

    await connectCampaign();

    expect(fakeSync.sendBlobHave).toHaveBeenCalledWith(CAMPAIGN_ID, ['sha256:' + 'a'.repeat(64)]);
    expect(fakeSync.sendBlobRequest).not.toHaveBeenCalled();
  });

  it("requests a party member's overview thumb (P2) after this device's own P1 hash is already held", async () => {
    const otherCharacterId = '00000000-0000-4000-8000-0000000000bb';
    await TestBed.inject(EventsRepository).append([
      mkOverviewEvent(otherCharacterId, 'sha256:' + 'b'.repeat(64)), // NOT a local character — P2
    ]);

    await connectCampaign();

    expect(fakeSync.sendBlobRequest).toHaveBeenCalledTimes(1);
    expect(fakeSync.sendBlobRequest).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      expect.any(String),
      'sha256:' + 'b'.repeat(64),
    );
  });

  // --- flow control: single in-flight per campaign ------------------------------------------------

  it('never has more than one blob.request in flight at a time for the same campaign', async () => {
    const charA = '00000000-0000-4000-8000-0000000000a1';
    const charB = '00000000-0000-4000-8000-0000000000a2';
    await TestBed.inject(EventsRepository).append([
      mkOverviewEvent(charA, 'sha256:' + 'a'.repeat(64)),
      mkOverviewEvent(charB, 'sha256:' + 'b'.repeat(64)),
    ]);

    await connectCampaign();

    // Both are missing (P2, same tier) — only the FIRST is requested; the second must wait.
    expect(fakeSync.sendBlobRequest).toHaveBeenCalledTimes(1);
  });

  // --- assembly + hash-mismatch discard/retry -----------------------------------------------------

  it('assembles chunks in order and stores the blob once the SHA-256 matches', async () => {
    const otherCharacterId = '00000000-0000-4000-8000-0000000000cc';
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const hash = await sha256Hex(bytes);
    await TestBed.inject(EventsRepository).append([mkOverviewEvent(otherCharacterId, hash)]);

    await connectCampaign();
    expect(fakeSync.sendBlobRequest).toHaveBeenCalledTimes(1);

    // Two chunks, deliberately delivered OUT OF ORDER — assembly must still reorder by index.
    fakeSync.emitBinary(CAMPAIGN_ID, encodeBlobChunkFrame(hash, 1, 2, 1, bytes.subarray(2)));
    fakeSync.emitBinary(CAMPAIGN_ID, encodeBlobChunkFrame(hash, 0, 2, 1, bytes.subarray(0, 2)));
    await flush();

    const row = await TestBed.inject(BlobsRepository).get(hash);
    expect(row).toBeDefined();
    expect(Array.from(row?.bytes ?? [])).toEqual(Array.from(bytes));
    // The queue is now free — nothing else was wanted, so no further request was sent.
    expect(fakeSync.sendBlobRequest).toHaveBeenCalledTimes(1);
  });

  it('discards a mismatched assembly (never stores it) and retries — a REJECT never lands in BlobsRepository', async () => {
    const otherCharacterId = '00000000-0000-4000-8000-0000000000dd';
    const realBytes = new Uint8Array([1, 2, 3]);
    const claimedHash = await sha256Hex(realBytes);
    const wrongBytes = new Uint8Array([9, 9, 9, 9, 9]); // will NOT hash to claimedHash
    await TestBed.inject(EventsRepository).append([mkOverviewEvent(otherCharacterId, claimedHash)]);

    await connectCampaign();
    const firstRid = fakeSync.sendBlobRequest.mock.calls[0]?.[1];
    expect(firstRid).toBeDefined();

    fakeSync.emitBinary(CAMPAIGN_ID, encodeBlobChunkFrame(claimedHash, 0, 1, 1, wrongBytes));
    await flush();

    expect(await TestBed.inject(BlobsRepository).get(claimedHash)).toBeUndefined();
    // A retry is SCHEDULED (backoff), not necessarily fired yet within these flushes — but it must
    // eventually re-request the SAME hash. Real backoff base is 500ms; poll briefly for it.
    await new Promise((resolve) => setTimeout(resolve, 700));
    await flush();
    expect(fakeSync.sendBlobRequest.mock.calls.length).toBeGreaterThan(1);
    expect(fakeSync.sendBlobRequest.mock.calls.at(-1)?.[2]).toBe(claimedHash);
  }, 10_000);

  // --- serve queue one-at-a-time -----------------------------------------------------------------

  it('serves blob.pull requests strictly one at a time, completing the first transfer before starting the second', async () => {
    const hashA = 'sha256:' + 'a'.repeat(64);
    const hashB = 'sha256:' + 'b'.repeat(64);
    await putBlobBytes(hashA, new Uint8Array(70_000)); // > 64 KB — forces 2 chunks
    await putBlobBytes(hashB, new Uint8Array([1, 2, 3]));
    // `pinned` is ALWAYS derived (never a standalone flag — `CacheManagerService.refreshPins()`'s
    // own "full recompute" design), so a direct `setPinned` here would just be overwritten by the
    // NEXT `refreshPins()` pass since neither hash is referenced by any character/campaign event
    // in this test. Suppress the constructor's boot-time weekly orphan sweep instead (this test is
    // about serve-queue ORDERING, not sweep timing) by marking it as having "just run".
    await TestBed.inject(SettingsRepository).set('blobOrphanSweepLastRunAt', Date.now());

    await connectCampaign();

    fakeSync.emitBlobPull(CAMPAIGN_ID, hashA, '10');
    fakeSync.emitBlobPull(CAMPAIGN_ID, hashB, '20'); // arrives before A's async serve() resolves
    await flush();

    const sentFrames = fakeSync.sendBlobChunk.mock.calls.map((c) => c[1]);
    // Every hashA frame must come before every hashB frame — never interleaved.
    const prefixes = sentFrames.map((f) => Array.from(f.subarray(12, 16)));
    const aPrefix = Array.from(require_hashPrefix(hashA));
    const bPrefix = Array.from(require_hashPrefix(hashB));
    const lastAIndex = prefixes
      .map((p, i) => (eq(p, aPrefix) ? i : -1))
      .filter((i) => i >= 0)
      .at(-1)!;
    const firstBIndex = prefixes.map((p, i) => (eq(p, bPrefix) ? i : -1)).find((i) => i >= 0);
    expect(firstBIndex).toBeDefined();
    expect(lastAIndex).toBeLessThan(firstBIndex!);
  });

  // --- timeout -> cancel -> backoff -> retry-on-members-change ------------------------------------

  it('on request timeout: sends blob.cancel, then retries early once a members update arrives (rather than waiting out the full backoff)', async () => {
    // A small, dedicated timeout — reconfigures the TestBed BEFORE anything injects it (see
    // `setup`'s own doc comment for why this can't just override the shared `beforeEach`'s token).
    TestBed.resetTestingModule();
    await setup(30);

    const otherCharacterId = '00000000-0000-4000-8000-0000000000ee';
    const hash = 'sha256:' + 'e'.repeat(64);
    await TestBed.inject(EventsRepository).append([mkOverviewEvent(otherCharacterId, hash)]);

    await connectCampaign();
    expect(fakeSync.sendBlobRequest).toHaveBeenCalledTimes(1);

    // Nothing ever arrives — wait past BLOB_REQUEST_TIMEOUT_MS (30ms, injected above).
    await new Promise((resolve) => setTimeout(resolve, 60));
    await flush();

    expect(fakeSync.sendBlobCancel).toHaveBeenCalledWith(CAMPAIGN_ID, hash);
    const requestCountAfterTimeout = fakeSync.sendBlobRequest.mock.calls.length;
    expect(requestCountAfterTimeout).toBe(1); // no immediate re-request — backoff is pending

    // A `members` update names a (possibly new) peer — retry NOW, not after the full backoff.
    fakeSync.setMembers(CAMPAIGN_ID, [
      { userId: 'usr_2', displayName: 'Nadia', role: 'member', online: true },
    ]);
    await flush();

    expect(fakeSync.sendBlobRequest.mock.calls.length).toBeGreaterThan(requestCountAfterTimeout);
    expect(fakeSync.sendBlobRequest.mock.calls.at(-1)?.[2]).toBe(hash);
  });

  // --- DM super-peer continuous idle loop ---------------------------------------------------------

  it('DM role: starts a continuous idle re-scan loop that re-arms itself after each tick', async () => {
    await connectCampaign('dm');
    // P1/P2 run immediately; P3 (idle) is queued once — draining it starts the DM loop.
    expect(idle.runNext()).toBe(true); // the P3/DM-loop-start idle callback
    await flush();
    expect(idle.runNext()).toBe(true); // the loop's own first tick
    await flush();

    // The loop must have re-scheduled ANOTHER idle callback for its next tick.
    expect(idle.runNext()).toBe(true);
  });

  it('a non-DM device never starts the continuous super-peer loop', async () => {
    await connectCampaign('player');
    expect(idle.runNext()).toBe(true); // the P3 idle callback
    await flush();
    expect(idle.runNext()).toBe(false); // nothing else was ever scheduled
  });
});

// Small local test-only re-derivation of hashPrefixBytes (kept independent of the production
// module so this test doesn't just check the codec against itself).
function require_hashPrefix(hash: string): Uint8Array {
  const hex = hash.slice('sha256:'.length);
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function eq(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
