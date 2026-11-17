import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type Signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { parsePack, type Event, type MembersMsg, type Pack } from '@hk/protocol';
import { seedPacks } from '@shared/services/campaigns/campaign-projection';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import type { PackImportAsset } from '@shared/services/packs/pack-assets';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { HkDb, type CampaignRow, type CharacterRow } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { LeaderService } from '@shared/services/storage/leader.service';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import type { SyncStateValue } from '@shared/services/sync/sync.service';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { encodeBlobChunkFrame } from './blob-chunk-codec';
import {
  BLOB_IDLE_SCHEDULER,
  BLOB_LOCAL_APPEND_DEBOUNCE_MS,
  BLOB_REQUEST_TIMEOUT_MS,
  BlobTransferService,
  MAX_ANNOUNCE_HASHES,
  type BlobIdleScheduler,
} from './blob-transfer.service';
import { CACHE_CAP_MIN_BYTES, CacheManagerService } from './cache-manager.service';
import { iconItemAddedEvent, putBlob } from './testing/blob-cache-fixtures';

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

// --- fake CharacterStore — this task's own `onLocalAppend` re-announce hook (task-16 e2e fix)
// only needs a controllable `streamId`/`events` pair plus a callback registry; nothing here
// otherwise touches character-sheet state, so a full `CharacterStore` (with its own heavy
// `EngineFacade`/`LocaleService`/Transloco dependency chain) would be pure test-setup overhead. --

class FakeCharacterStore {
  private readonly streamIdState = signal<string | undefined>(undefined);
  readonly streamId: Signal<string | undefined> = this.streamIdState.asReadonly();
  private readonly eventsState = signal<Event[]>([]);
  readonly events: Signal<Event[]> = this.eventsState.asReadonly();
  private readonly listeners = new Set<(streamId: string, events: Event[]) => void>();

  onLocalAppend(cb: (streamId: string, events: Event[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Test-only driver: sets this "loaded character"'s stream/events, then fires `onLocalAppend`
   * exactly like `CharacterStore.appendTx` does once a write commits. */
  commitLocalAppend(streamId: string, events: Event[]): void {
    this.streamIdState.set(streamId);
    this.eventsState.set(events);
    for (const cb of this.listeners) cb(streamId, events);
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

// [final review wave, finding 3] A small, but comfortably-flush()-dominating REAL duration for
// `BLOB_LOCAL_APPEND_DEBOUNCE_MS` — same "small real duration, never `vi.useFakeTimers()`" posture
// `campaign.store.spec.ts`'s own `CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS` doc explains (fake timers starve
// real fake-indexeddb microtask scheduling). Deliberately larger than `flush()`'s own real-but-tiny
// wall-clock overhead (10 real ticks) so a test asserting "nothing fired yet, immediately after the
// burst" can never flake by accidentally outlasting the debounce window on a loaded machine.
const LOCAL_APPEND_DEBOUNCE_MS = 100;
async function waitPastLocalAppendDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, LOCAL_APPEND_DEBOUNCE_MS + 150));
}

// --- idle scheduler test double — a MANUALLY-DRAINED queue (never auto-runs synchronously) so a
// self-rearming loop (the DM super-peer tick) can never spin the test runner forever. -----------

function makeIdleScheduler(): {
  scheduler: BlobIdleScheduler;
  runNext: () => boolean;
  pending: () => number;
} {
  const queue: (() => void)[] = [];
  return {
    scheduler: (fn) => queue.push(fn),
    runNext: () => {
      const fn = queue.shift();
      if (!fn) return false;
      fn();
      return true;
    },
    pending: () => queue.length,
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

/** Joins `characterId` to the campaign roster (`campaign-projection.ts`'s `state.roster` — a
 * SEPARATE map from `state.overviews`, populated only by this event type) — the missing piece an
 * earlier draft of the P1 tests here didn't actually exercise (P1 requires BOTH a local
 * `CharacterRow.portraitThumbHash` AND roster membership; a `party.overview_updated` event alone
 * only ever lands in `state.overviews`, i.e. P2). */
function mkJoinedEvent(characterId: string, ownerId = 'usr_1'): Event {
  const id = `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream: CAMPAIGN_STREAM,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: ownerId, deviceId: 'dev_1', role: 'member' },
    type: 'campaign.character_joined',
    v: 1,
    payload: { characterId, ownerId, name: 'Own Character' },
  };
}

async function putBlobBytes(hash: string, bytes: Uint8Array): Promise<void> {
  await TestBed.inject(BlobsRepository).put(hash, 'image/webp', bytes);
}

// --- plan-16 Task 4: content pack fixtures (pack assets over the relay) -------------------------

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'testing',
  'fixtures',
  'packs',
);

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

/** Plan 15's sample content pack: one `icon` asset, whose bytes are `sample-icon.webp`. */
const SAMPLE_PACK = readPack(join(fixturesDir, 'sample-content.json'));
const [SAMPLE_ICON] = SAMPLE_PACK.assets;
const SAMPLE_ICON_BYTES = new Uint8Array(readFileSync(join(fixturesDir, 'sample-icon.webp')));
/** The icon as a `.hkpack` import hands it to `PackStore.installContent` (the DM's copy). */
const SAMPLE_ICON_ASSETS: ReadonlyMap<string, PackImportAsset> = new Map([
  [SAMPLE_ICON.hash, { bytes: SAMPLE_ICON_BYTES, kind: SAMPLE_ICON.kind, mime: SAMPLE_ICON.mime }],
]);

/** Only what `PackStore.init()`/`installContent` read from a core pack: neither validates anything
 * while no content pack is stored yet, and every test below installs AFTER `init()`. */
const CORE_STUB: Pack = {
  format: 1,
  id: 'srd-5e-2024',
  version: '0.1.0',
  kind: 'core',
  name: 'SRD core',
  authors: [],
  dependencies: [],
  locale: 'en',
  entities: [],
  overrides: [],
  assets: [],
  i18n: {},
};

/** `pack.enabled@1` on the campaign stream — what the DM appends and every member folds. */
function mkPackEnabledEvent(pack: Pack, version = pack.version): Event {
  const id = `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream: CAMPAIGN_STREAM,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'usr_dm', deviceId: 'dev_1', role: 'dm' },
    type: 'pack.enabled',
    v: 1,
    payload: { packId: pack.id, version, sha256: 'c'.repeat(64) },
  };
}

/** Installs `pack` on this device. With `assets`: the way the DM's `.hkpack` import holds it (asset
 * blobs stored `origin: 'pack'`). Without: the way a member's campaign auto-install holds it
 * (`CampaignPacksService` calls `installContent(pack, new Map())` — the assets are the relay's). */
async function installPack(
  pack: Pack,
  assets: ReadonlyMap<string, PackImportAsset> = new Map(),
): Promise<void> {
  const packStore = TestBed.inject(PackStore);
  if (!packStore.ready()) await packStore.init();
  await packStore.installContent(pack, assets);
}

/** The CHARACTER-stream half of a campaign link (`character.campaign_joined@1`) —
 * `campaignIdOfCharacter` (`character-campaign-link.ts`) reads exactly this shape off
 * `CharacterStore.events()`; task-16's own re-announce hook (`BlobTransferService`'s
 * `onCharacterLocalAppend`) resolves the just-linked campaign id from it. */
function mkCharCampaignJoinedEvent(characterId: string, campaignId: string): Event {
  const id = `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream: `char:${characterId}`,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'usr_1', deviceId: 'dev_1', role: 'owner' },
    type: 'character.campaign_joined',
    v: 1,
    payload: { campaignId },
  };
}

describe('BlobTransferService', () => {
  let fakeSync: FakeSyncService;
  let fakeCharacterStore: FakeCharacterStore;
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
    fakeCharacterStore = new FakeCharacterStore();
    idle = makeIdleScheduler();

    TestBed.configureTestingModule({
      providers: [
        { provide: SyncService, useValue: fakeSync },
        { provide: CharacterStore, useValue: fakeCharacterStore },
        { provide: BLOB_IDLE_SCHEDULER, useValue: idle.scheduler },
        { provide: BLOB_REQUEST_TIMEOUT_MS, useValue: requestTimeoutMs },
        { provide: BLOB_LOCAL_APPEND_DEBOUNCE_MS, useValue: LOCAL_APPEND_DEBOUNCE_MS },
        { provide: PackLoader, useValue: { loadCore: () => Promise.resolve(CORE_STUB) } },
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

  // Task-16 e2e fix: the ordinary flow is "join the campaign, THEN separately link a character"
  // (ruling 4) — the very first connect-time `runConnectSequence` almost always fires before that
  // second step ever commits (the campaign socket typically opens in well under the time it takes
  // a person to click through the link-character screen), so P1's own-portrait announce sees an
  // EMPTY roster on that first pass. Without a re-trigger, nothing ever re-announces it — found by
  // this plan's own real two-browser-context e2e (a member's portrait never relayed to the DM on
  // the first session). This test pins the fix: `BlobTransferService.onCharacterLocalAppend`
  // (wired to `CharacterStore.onLocalAppend`, the SAME hook `PartyOverviewPublisherService` uses
  // for its own analogous concern) re-runs the connect sequence once the roster entry lands.
  it("re-announces P1 once this device's own character link to an ALREADY-watched campaign commits — the roster entry lands AFTER the first connect, not before", async () => {
    const hash = 'sha256:' + 'c'.repeat(64);
    await TestBed.inject(CharactersRepository).put(mkCharacterRow({ portraitThumbHash: hash }));
    await putBlobBytes(hash, new Uint8Array([1]));

    // Connects with NO roster entry yet — mirrors the real ordering: the campaign socket is
    // already live before the character has been linked to it at all.
    await connectCampaign();
    expect(fakeSync.sendBlobHave).not.toHaveBeenCalled();

    // The character-side link now commits locally (`character.campaign_joined`) — the roster's
    // OWN campaign-side mirror event lands too (ruling 4's step (b)), then the fake
    // `CharacterStore` fires `onLocalAppend` exactly as the real store does once a write commits.
    await TestBed.inject(EventsRepository).append([mkJoinedEvent(CHARACTER_ID)]);
    fakeCharacterStore.commitLocalAppend(CHARACTER_STREAM, [
      mkCharCampaignJoinedEvent(CHARACTER_ID, CAMPAIGN_ID),
    ]);
    // [final review wave, finding 3] The hook-triggered re-run is now debounced — must wait past
    // the window, not just flush() microtasks, before the re-announce is expected.
    await waitPastLocalAppendDebounce();

    expect(fakeSync.sendBlobHave).toHaveBeenCalledWith(CAMPAIGN_ID, [hash]);
  });

  // [final review wave, finding 3] Undebounced, EVERY local commit on a campaign-linked character
  // re-ran the WHOLE connect sequence (a fresh campaign-wide re-projection, a roster-wide Dexie
  // read pass, and a `blob.have` frame) — a burst of rapid edits (e.g. several HP taps) fired it
  // once PER commit. This pins the fix: a per-campaignId trailing debounce collapses a rapid burst
  // into exactly ONE deferred re-run.
  it('collapses a rapid burst of onLocalAppend-triggered hook fires into exactly ONE deferred re-run, reflecting the LATEST state', async () => {
    const hash = 'sha256:' + 'e0'.repeat(32);
    await TestBed.inject(CharactersRepository).put(mkCharacterRow({ portraitThumbHash: hash }));
    await putBlobBytes(hash, new Uint8Array([1]));

    // Connects with no roster entry yet, same setup as the re-announce test above.
    await connectCampaign();
    expect(fakeSync.sendBlobHave).not.toHaveBeenCalled();

    await TestBed.inject(EventsRepository).append([mkJoinedEvent(CHARACTER_ID)]);
    const joinedEvent = mkCharCampaignJoinedEvent(CHARACTER_ID, CAMPAIGN_ID);

    // THREE rapid hook fires in a tight synchronous burst — each one would (pre-fix) call
    // `sendBlobHave` immediately and independently, once per fire.
    fakeCharacterStore.commitLocalAppend(CHARACTER_STREAM, [joinedEvent]);
    fakeCharacterStore.commitLocalAppend(CHARACTER_STREAM, [joinedEvent]);
    fakeCharacterStore.commitLocalAppend(CHARACTER_STREAM, [joinedEvent]);

    // Not asserting "hasn't fired yet" here — `flush()`'s own real (if small) wall-clock overhead
    // (10 real ticks) proved unreliable to bound against a fixed debounce window on a loaded
    // machine (`campaign.store.spec.ts`'s own `CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS` doc notes the same
    // class of flakiness). The COLLAPSE itself — exactly ONE call despite THREE rapid fires — is
    // what this test pins; waiting it out is enough to prove that on its own.
    await waitPastLocalAppendDebounce();

    expect(fakeSync.sendBlobHave).toHaveBeenCalledTimes(1);
    expect(fakeSync.sendBlobHave).toHaveBeenCalledWith(CAMPAIGN_ID, [hash]);
  });

  // The connect-path (`connectEffect`) call is a DIFFERENT trigger than the two `onLocalAppend`
  // hooks above (finding 3 debounces ONLY the hook-triggered re-runs) — this pins that it stays
  // immediate: with the roster already populated BEFORE `connectCampaign()` runs, the very first
  // connect sequence must announce without waiting out any debounce window at all (`connectCampaign`
  // itself only ever flush()es real microtasks/ticks, never a real-time wait).
  it('does not debounce the connect-path (connectEffect) call — sendBlobHave still fires immediately on connect', async () => {
    const hash = 'sha256:' + 'f0'.repeat(32);
    await TestBed.inject(CharactersRepository).put(mkCharacterRow({ portraitThumbHash: hash }));
    await putBlobBytes(hash, new Uint8Array([1]));
    await TestBed.inject(EventsRepository).append([mkJoinedEvent(CHARACTER_ID)]);

    await connectCampaign();

    expect(fakeSync.sendBlobHave).toHaveBeenCalledWith(CAMPAIGN_ID, [hash]);
  });

  it('does NOT re-run the connect sequence for a local append on a character linked to a DIFFERENT (or no) campaign', async () => {
    const hash = 'sha256:' + 'd'.repeat(64);
    await TestBed.inject(CharactersRepository).put(mkCharacterRow({ portraitThumbHash: hash }));
    await putBlobBytes(hash, new Uint8Array([1]));
    await connectCampaign();
    fakeSync.sendBlobHave.mockClear();

    // No campaign link at all (an ordinary, unrelated character edit).
    fakeCharacterStore.commitLocalAppend(CHARACTER_STREAM, []);
    await flush();
    expect(fakeSync.sendBlobHave).not.toHaveBeenCalled();

    // Linked to a campaign this service has no live watcher for.
    fakeCharacterStore.commitLocalAppend(CHARACTER_STREAM, [
      mkCharCampaignJoinedEvent(CHARACTER_ID, '00000000-0000-4000-8000-0000000000ff'),
    ]);
    await flush();
    expect(fakeSync.sendBlobHave).not.toHaveBeenCalled();
  });

  // Fix round 1, Minor: nothing enforced the server's own MAX_HASHES_PER_CONNECTION (512) client-
  // side before this fix — a large enough campaign's `blob.have` would rely entirely on the
  // server's own silent per-connection drop, losing an arbitrary tail instead of a prioritized one.
  it('caps announced blob.have hashes at 512, ordering OWN hashes (P1) before a large party roster (P2) so they always survive the cut', async () => {
    const OWN_COUNT = 5;
    const PARTY_COUNT = 515; // total 520 > the 512 cap
    const charactersRepository = TestBed.inject(CharactersRepository);
    const events: Event[] = [];
    const ownHashes: string[] = [];
    const partyHashes: string[] = [];

    for (let i = 0; i < OWN_COUNT; i++) {
      const characterId = `00000000-0000-4000-8000-0000${String(i).padStart(8, '0')}`;
      const hash = `sha256:own${i.toString(16).padStart(5, '0')}${'0'.repeat(56)}`;
      ownHashes.push(hash);
      await charactersRepository.put(
        mkCharacterRow({ id: `char:${characterId}`, portraitThumbHash: hash }),
      );
      events.push(mkJoinedEvent(characterId));
    }
    for (let i = 0; i < PARTY_COUNT; i++) {
      const characterId = `00000000-0000-4000-8000-0001${String(i).padStart(8, '0')}`;
      const hash = `sha256:party${i.toString(16).padStart(4, '0')}${'0'.repeat(55)}`;
      partyHashes.push(hash);
      events.push(mkOverviewEvent(characterId, hash));
    }
    await TestBed.inject(EventsRepository).append(events);
    await Promise.all(
      [...ownHashes, ...partyHashes].map((h) => putBlobBytes(h, new Uint8Array([1]))),
    );

    await connectCampaign();
    // `runConnectSequence` resolves 520 Dexie reads (parallelized, but still genuinely async
    // fake-indexeddb round trips) before `announceHave` ever runs — poll with real ticks instead
    // of a fixed flush count, which proved unreliable at this scale on a loaded machine.
    const deadline = Date.now() + 10_000;
    while (fakeSync.sendBlobHave.mock.calls.length === 0 && Date.now() < deadline) {
      await tick();
    }

    const announced = fakeSync.sendBlobHave.mock.calls.flatMap((c) => c[1]);
    expect(announced).toHaveLength(512);
    for (const h of ownHashes) expect(announced).toContain(h);
  }, 20_000);

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

  // Fix round 1 [Important]: a completed peer download was silently stamped `origin:'upload'`
  // (BlobsRepository.put had no way to receive an explicit origin at all) — doc-07/the plan's own
  // binding constraint says "store with origin:'peer'". No prior test asserted this.
  it('stores a completed download with origin:"peer" (doc-07: peer-received blobs are stamped origin:\'peer\')', async () => {
    const otherCharacterId = '00000000-0000-4000-8000-0000000000fa';
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = await sha256Hex(bytes);
    await TestBed.inject(EventsRepository).append([mkOverviewEvent(otherCharacterId, hash)]);

    await connectCampaign();
    fakeSync.emitBinary(CAMPAIGN_ID, encodeBlobChunkFrame(hash, 0, 1, 1, bytes));
    await flush();

    const row = await TestBed.inject(BlobsRepository).get(hash);
    expect(row?.origin).toBe('peer');
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

  // Fix round 1, Minor: the missing isolation test for `onBinaryFrame`'s own hashPrefix guard —
  // a foreign chunk (belonging to some OTHER hash entirely) arriving mid-transfer must be ignored
  // outright, not merged into the in-flight assembly.
  it('ignores a chunk frame whose hashPrefix belongs to a DIFFERENT hash, arriving mid-transfer', async () => {
    const otherCharacterId = '00000000-0000-4000-8000-0000000000fb';
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = await sha256Hex(bytes);
    const foreignHash = 'sha256:' + 'f'.repeat(64); // unrelated to `hash`, never requested
    await TestBed.inject(EventsRepository).append([mkOverviewEvent(otherCharacterId, hash)]);

    await connectCampaign();
    expect(fakeSync.sendBlobRequest).toHaveBeenCalledTimes(1);

    // First real chunk (index 0 of 2) — establishes the in-flight assembly.
    fakeSync.emitBinary(CAMPAIGN_ID, encodeBlobChunkFrame(hash, 0, 2, 1, bytes.subarray(0, 2)));
    await flush();
    expect(await TestBed.inject(BlobsRepository).get(hash)).toBeUndefined(); // still assembling

    // A FOREIGN frame — same shape, same `total`/`to`, but its header names a hash this device
    // never requested. Must be dropped silently: no store, no crash, no corruption of the
    // genuine in-flight assembly above.
    fakeSync.emitBinary(
      CAMPAIGN_ID,
      encodeBlobChunkFrame(foreignHash, 1, 2, 1, new Uint8Array([9, 9])),
    );
    await flush();
    expect(await TestBed.inject(BlobsRepository).get(hash)).toBeUndefined();
    expect(await TestBed.inject(BlobsRepository).get(foreignHash)).toBeUndefined();

    // The REAL second chunk still completes the assembly normally afterward.
    fakeSync.emitBinary(CAMPAIGN_ID, encodeBlobChunkFrame(hash, 1, 2, 1, bytes.subarray(2)));
    await flush();

    const row = await TestBed.inject(BlobsRepository).get(hash);
    expect(Array.from(row?.bytes ?? [])).toEqual(Array.from(bytes));
  });

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

  // --- P3 content pack assets (plan 16 Task 4, design ruling 5) -----------------------------------

  describe('P3 content pack assets', () => {
    /** Drains the connect sequence's idle callback — pack assets are P3 — and lets it settle. */
    async function runIdleP3(): Promise<void> {
      expect(idle.runNext()).toBe(true);
      await flush();
    }

    function requestedHashes(): string[] {
      return fakeSync.sendBlobRequest.mock.calls.map((c) => c[2]);
    }

    function announcedHashes(): string[] {
      return fakeSync.sendBlobHave.mock.calls.flatMap((c) => c[1]);
    }

    it("wants an enabled, locally installed pack's icon whose blob is absent — at P3 (idle), not on connect", async () => {
      await installPack(SAMPLE_PACK); // a member's auto-install: no asset bytes
      await TestBed.inject(EventsRepository).append([mkPackEnabledEvent(SAMPLE_PACK)]);

      await connectCampaign();
      expect(fakeSync.sendBlobRequest).not.toHaveBeenCalled();

      await runIdleP3();
      expect(requestedHashes()).toEqual([SAMPLE_ICON.hash]);
    });

    it("plan 18 Task 4 (Review Focus 4): wants an own hero's custom item icon blob it lacks at P3, and announces one it holds — read from events, no snapshot row", async () => {
      const missing = 'sha256:' + 'c1'.repeat(32);
      const held = 'sha256:' + 'c2'.repeat(32);
      await TestBed.inject(CharactersRepository).put(mkCharacterRow());
      await putBlobBytes(held, new Uint8Array([2]));
      await TestBed.inject(EventsRepository).append([
        iconItemAddedEvent(CHARACTER_STREAM, missing, 1),
        iconItemAddedEvent(CHARACTER_STREAM, held, 2),
        mkJoinedEvent(CHARACTER_ID),
      ]);

      await connectCampaign();
      expect(announcedHashes()).toContain(held);
      await runIdleP3();
      expect(requestedHashes()).toEqual([missing]);
    });

    it('does not want a pack icon this device already holds — it announces it, after the portraits', async () => {
      const thumb = 'sha256:' + 'a1'.repeat(32);
      await TestBed.inject(CharactersRepository).put(mkCharacterRow({ portraitThumbHash: thumb }));
      await putBlobBytes(thumb, new Uint8Array([1]));
      await installPack(SAMPLE_PACK, SAMPLE_ICON_ASSETS); // the DM's `.hkpack` copy
      await TestBed.inject(EventsRepository).append([
        mkJoinedEvent(CHARACTER_ID),
        mkPackEnabledEvent(SAMPLE_PACK),
      ]);

      await connectCampaign();
      await runIdleP3();

      expect(fakeSync.sendBlobHave).toHaveBeenCalledWith(CAMPAIGN_ID, [thumb, SAMPLE_ICON.hash]);
      expect(fakeSync.sendBlobRequest).not.toHaveBeenCalled();
    });

    it('ignores packs installed locally but NOT enabled for this campaign — never requested, never announced', async () => {
      const heldHash = 'sha256:' + 'b2'.repeat(32);
      const heldPack: Pack = {
        ...SAMPLE_PACK,
        id: 'held-pack',
        assets: [{ ...SAMPLE_ICON, hash: heldHash }],
      };
      await installPack(SAMPLE_PACK); // its icon absent
      await installPack(
        heldPack,
        new Map([[heldHash, { bytes: new Uint8Array([1]), kind: 'icon', mime: 'image/webp' }]]),
      );

      await connectCampaign();
      await runIdleP3();

      expect(fakeSync.sendBlobRequest).not.toHaveBeenCalled();
      expect(fakeSync.sendBlobHave).not.toHaveBeenCalled();
    });

    it('ignores a pack the campaign enables but this device has not installed', async () => {
      await TestBed.inject(EventsRepository).append([mkPackEnabledEvent(SAMPLE_PACK)]);

      await connectCampaign();
      await runIdleP3();

      expect(fakeSync.sendBlobRequest).not.toHaveBeenCalled();
    });

    it('ignores an installed pack whose version is not the enabled one', async () => {
      await installPack(SAMPLE_PACK);
      await TestBed.inject(EventsRepository).append([mkPackEnabledEvent(SAMPLE_PACK, '2.0.0')]);

      await connectCampaign();
      await runIdleP3();

      expect(fakeSync.sendBlobRequest).not.toHaveBeenCalled();
    });

    it("reads CampaignStore's enabled set — a welcome seed counts before any pack.enabled reaches the local log", async () => {
      await installPack(SAMPLE_PACK);
      await TestBed.inject(LeaderService).acquire();
      await TestBed.inject(CampaignStore).applyPackSeed(
        CAMPAIGN_STREAM,
        seedPacks({
          headSeq: 0,
          packs: [{ id: SAMPLE_PACK.id, version: SAMPLE_PACK.version, sha256: 'c'.repeat(64) }],
        }),
      );

      await connectCampaign();
      await runIdleP3();

      expect(requestedHashes()).toEqual([SAMPLE_ICON.hash]);
    });

    it(`caps blob.have at ${MAX_ANNOUNCE_HASHES}: every held portrait first, then the held pack assets that still fit`, async () => {
      const PARTY_COUNT = MAX_ANNOUNCE_HASHES - 2;
      const PACK_ASSET_COUNT = 5; // 3 of them past the cap
      const events: Event[] = [];
      const partyHashes: string[] = [];
      for (let i = 0; i < PARTY_COUNT; i++) {
        const characterId = `00000000-0000-4000-8000-0002${String(i).padStart(8, '0')}`;
        const hash = `sha256:party${i.toString(16).padStart(4, '0')}${'0'.repeat(55)}`;
        partyHashes.push(hash);
        events.push(mkOverviewEvent(characterId, hash));
      }
      const assetHashes = Array.from(
        { length: PACK_ASSET_COUNT },
        (_, i) => `sha256:asset${i}${'0'.repeat(58)}`,
      );
      const bigPack: Pack = {
        ...SAMPLE_PACK,
        id: 'big-pack',
        assets: assetHashes.map((hash) => ({ ...SAMPLE_ICON, hash })),
      };
      await installPack(
        bigPack,
        new Map<string, PackImportAsset>(
          assetHashes.map((hash) => [
            hash,
            { bytes: new Uint8Array([1]), kind: 'icon', mime: 'image/webp' },
          ]),
        ),
      );
      events.push(mkPackEnabledEvent(bigPack));
      await TestBed.inject(EventsRepository).append(events);
      await Promise.all(partyHashes.map((h) => putBlobBytes(h, new Uint8Array([1]))));

      await connectCampaign();
      // Same real-tick polling as the plan-10 cap test above: ~515 Dexie reads precede the announce.
      const deadline = Date.now() + 10_000;
      while (fakeSync.sendBlobHave.mock.calls.length === 0 && Date.now() < deadline) {
        await tick();
      }

      expect(announcedHashes()).toEqual([...partyHashes, ...assetHashes.slice(0, 2)]);
      // The rest of the sequence (~510 more reads) must finish before `afterEach` closes the
      // database: its last step queues the idle P3 callback.
      await vi.waitFor(() => expect(idle.pending()).toBe(1), { timeout: 10_000 });
    }, 20_000);

    // The ordinary member path: `CampaignPacksService` fetches and installs an enabled pack only
    // once `welcome`/the folded `pack.enabled` reveal it — after the campaign socket opened and the
    // connect sequence already ran without it (or mid-session, when the DM enables a pack).
    it('re-runs the connect sequence (debounced) when an enabled pack finishes installing after connect', async () => {
      await TestBed.inject(PackStore).init();
      await TestBed.inject(EventsRepository).append([mkPackEnabledEvent(SAMPLE_PACK)]);
      await connectCampaign();
      await runIdleP3();
      expect(fakeSync.sendBlobRequest).not.toHaveBeenCalled();

      await installPack(SAMPLE_PACK);
      await flush();
      await waitPastLocalAppendDebounce();
      await runIdleP3();

      expect(requestedHashes()).toEqual([SAMPLE_ICON.hash]);
    });

    // Review Focus 5 (plan 16): a member receives a pack's icon through the relay from the DM
    // holder within the connect sequence, the blob is stored `origin: 'peer'`, and neither cache
    // sweep ever evicts it. Two devices in turn over the fake socket: the DM's device serves the
    // icon's `blob.chunk` frames; the member's device (a fresh database) receives those frames.
    it('Review Focus 5: the DM holder serves the icon, the member verifies and stores it origin "peer", and neither sweep evicts it', async () => {
      expect(await sha256Hex(SAMPLE_ICON_BYTES)).toBe(SAMPLE_ICON.hash); // fixture sanity

      // The DM's device: imported the pack (its icon stored `origin: 'pack'`) and enabled it.
      await installPack(SAMPLE_PACK, SAMPLE_ICON_ASSETS);
      await TestBed.inject(EventsRepository).append([mkPackEnabledEvent(SAMPLE_PACK)]);
      await connectCampaign('dm');
      expect(announcedHashes()).toContain(SAMPLE_ICON.hash);

      fakeSync.emitBlobPull(CAMPAIGN_ID, SAMPLE_ICON.hash, '7');
      await flush();
      const frames = fakeSync.sendBlobChunk.mock.calls.map((c) => c[1]);
      expect(frames.length).toBeGreaterThan(0);

      // Switch devices once nothing of the DM's is still reading: its cache boot work settled, its
      // connect sequence ran to its end (the idle P3 callback is queued), nothing requested.
      await TestBed.inject(CacheManagerService).ready;
      await vi.waitFor(() => expect(idle.pending()).toBe(1));
      expect(fakeSync.sendBlobRequest).not.toHaveBeenCalled();
      TestBed.inject(HkDb).close();
      TestBed.resetTestingModule();
      await setup();

      // The member's device: the pack auto-installed without its assets.
      await installPack(SAMPLE_PACK);
      await TestBed.inject(EventsRepository).append([mkPackEnabledEvent(SAMPLE_PACK)]);
      await connectCampaign('player');
      await runIdleP3();
      expect(requestedHashes()).toEqual([SAMPLE_ICON.hash]);

      for (const frame of frames) fakeSync.emitBinary(CAMPAIGN_ID, frame);
      await flush();

      const blobs = TestBed.inject(BlobsRepository);
      const row = await blobs.get(SAMPLE_ICON.hash);
      expect(row?.origin).toBe('peer');
      expect(row?.kind).toBe('icon');
      expect(row?.mime).toBe('image/webp');
      expect(Array.from(row?.bytes ?? [])).toEqual(Array.from(SAMPLE_ICON_BYTES));
      expect(fakeSync.sendBlobHave).toHaveBeenLastCalledWith(CAMPAIGN_ID, [SAMPLE_ICON.hash]);

      // Neither sweep evicts it. Unpinned and the least recently used row, it would be the LRU's
      // first pick if the installed pack's listing did not protect it.
      const cache = TestBed.inject(CacheManagerService);
      await cache.ready;
      await TestBed.inject(HkDb).blobs.update(SAMPLE_ICON.hash, { pinned: false, lastUsedAt: 1 });
      const filler = 'sha256:' + 'f1'.repeat(32);
      await putBlob(filler, CACHE_CAP_MIN_BYTES + 1, false, 2); // over the cap on its own
      await cache.setCapBytes(CACHE_CAP_MIN_BYTES); // runs the LRU sweep
      expect(await blobs.get(filler)).toBeUndefined();
      expect(await blobs.get(SAMPLE_ICON.hash)).toBeDefined();

      const orphan = 'sha256:' + 'f2'.repeat(32);
      await putBlob(orphan, 10);
      await cache.runOrphanSweep();
      expect(await blobs.get(orphan)).toBeUndefined();
      expect((await blobs.get(SAMPLE_ICON.hash))?.origin).toBe('peer');
    });
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
