import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { AuthService, type AuthUser } from '@shared/services/auth/auth.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { SyncService, type SyncStateValue } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { seedFighter } from '../../../views/characters/sheet/testing/character-fixtures';
import { bareCharacterId } from './campaign-link-sequence';
import {
  PARTY_OVERVIEW_PUBLISH_DEBOUNCE_MS,
  PartyOverviewPublisherService,
} from './party-overview-publisher.service';

// Real built SRD pack (same "prefer the real pack" fixture-loading approach as
// `character.store.spec.ts`/`create-wizard.component.spec.ts`) — `seedFighter` derives a REAL
// `Sheet` (hp 12 / ac 19 / level 1 / fighter class), which is exactly what this service's
// `deriveOverview` call needs to be exercised honestly, not a hand-rolled fixture.
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

const DEBOUNCE_MS = 15;
/** Comfortably past `DEBOUNCE_MS` for a real (non-fake) timer — same "small real duration, never
 * `vi.useFakeTimers()`" posture `campaign.store.spec.ts`'s own `CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS`
 * doc explains (fake timers starve real fake-indexeddb microtask scheduling). */
async function waitPastDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 60));
}

function configure(): {
  userState: WritableSignal<AuthUser | null>;
  syncStateFor: (streamId: string) => WritableSignal<SyncStateValue>;
} {
  const userState = signal<AuthUser | null>({ userId: 'u1', username: 'alice' });
  const syncStates = new Map<string, WritableSignal<SyncStateValue>>();
  const syncStateFor = (streamId: string): WritableSignal<SyncStateValue> => {
    let s = syncStates.get(streamId);
    if (!s) {
      s = signal<SyncStateValue>('offline');
      syncStates.set(streamId, s);
    }
    return s;
  };

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
      { provide: AuthService, useValue: { user: userState } },
      { provide: SyncService, useValue: { syncState: syncStateFor } },
      { provide: PARTY_OVERVIEW_PUBLISH_DEBOUNCE_MS, useFactory: () => DEBOUNCE_MS },
    ],
  });
  return { userState, syncStateFor };
}

describe('PartyOverviewPublisherService', () => {
  let syncStateFor: (streamId: string) => WritableSignal<SyncStateValue>;

  beforeEach(async () => {
    ({ syncStateFor } = configure());
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.campaigns.clear(),
      db.blobs.clear(),
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  async function linkToOpenCampaign(characterId: string, campaignId: string): Promise<void> {
    const characterStore = TestBed.inject(CharacterStore);
    characterStore.enterSyncMode(characterId);
    syncStateFor(`camp:${campaignId}`).set('synced');
    await characterStore.appendTx([
      { type: 'character.campaign_joined', v: 1, payload: { campaignId } },
    ]);
  }

  it('publishes a party.overview_updated event derived from the real Sheet, after the debounce window, once a campaign-linked character commits a local append', async () => {
    TestBed.inject(PartyOverviewPublisherService); // instantiate — registers the onLocalAppend hook
    const characterId = await seedFighter('Ivan');
    const campaignId = '11111111-1111-1111-1111-111111111111';

    await linkToOpenCampaign(characterId, campaignId);
    await waitPastDebounce();

    const campaignEvents = await TestBed.inject(EventsRepository).byStream(`camp:${campaignId}`);
    const published = campaignEvents.filter((e) => e.type === 'party.overview_updated');
    expect(published).toHaveLength(1);
    expect(published[0]?.payload).toEqual({
      characterId: bareCharacterId(characterId),
      overview: {
        hp: 12,
        hpMax: 12,
        temp: 0,
        ac: 19,
        level: 1,
        classes: [{ classId: 'srd-5e-2024:class/fighter', level: 1 }],
        conditions: [],
        concentration: false,
        // 10 base + wis mod (+1, wis 12) + proficiency (+2, `perception` chosen as a skill) — same
        // fighter-1 fixture arithmetic `character-fixtures.ts`'s own doc comment pins for hp/ac/prof.
        passivePerception: 13,
      },
    });
    expect(published[0]?.seq).toBeUndefined(); // ordinary member event, PENDING like everything else
  });

  it('collapses multiple commits inside the debounce window into exactly one publish reflecting the LATEST state', async () => {
    TestBed.inject(PartyOverviewPublisherService);
    const characterId = await seedFighter('Ivan');
    const campaignId = '22222222-2222-2222-2222-222222222222';
    const characterStore = TestBed.inject(CharacterStore);

    await linkToOpenCampaign(characterId, campaignId);
    await characterStore.appendTx([
      { type: 'condition.added', v: 1, payload: { conditionId: 'srd-5e-2024:condition/blinded' } },
    ]);
    await waitPastDebounce();

    const campaignEvents = await TestBed.inject(EventsRepository).byStream(`camp:${campaignId}`);
    const published = campaignEvents.filter((e) => e.type === 'party.overview_updated');
    // Both the campaign_joined commit AND the condition.added commit fall inside ONE debounce
    // window (neither `await`s past it) — a single trailing publish, reflecting the FINAL state.
    expect(published).toHaveLength(1);
    expect(published[0]?.payload).toMatchObject({
      overview: { conditions: ['srd-5e-2024:condition/blinded'] },
    });
  });

  it('skips publishing when the derived overview is unchanged (deep-equal) from what is already on the campaign stream', async () => {
    TestBed.inject(PartyOverviewPublisherService);
    const characterId = await seedFighter('Ivan');
    const campaignId = '33333333-3333-3333-3333-333333333333';
    const characterStore = TestBed.inject(CharacterStore);

    await linkToOpenCampaign(characterId, campaignId);
    await waitPastDebounce();
    let published = (await TestBed.inject(EventsRepository).byStream(`camp:${campaignId}`)).filter(
      (e) => e.type === 'party.overview_updated',
    );
    expect(published).toHaveLength(1);

    // A rename touches NEITHER hp/ac/level/classes/conditions/concentration/passivePerception.
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Renamed' } },
    ]);
    await waitPastDebounce();

    published = (await TestBed.inject(EventsRepository).byStream(`camp:${campaignId}`)).filter(
      (e) => e.type === 'party.overview_updated',
    );
    expect(published).toHaveLength(1); // still just the one — the no-op rename was skipped
  });

  it('publishes a second, updated overview once a stat actually changes', async () => {
    TestBed.inject(PartyOverviewPublisherService);
    const characterId = await seedFighter('Ivan');
    const campaignId = '44444444-4444-4444-4444-444444444444';
    const characterStore = TestBed.inject(CharacterStore);

    await linkToOpenCampaign(characterId, campaignId);
    await waitPastDebounce();

    await characterStore.appendTx([
      { type: 'condition.added', v: 1, payload: { conditionId: 'srd-5e-2024:condition/blinded' } },
    ]);
    await waitPastDebounce();

    const published = (
      await TestBed.inject(EventsRepository).byStream(`camp:${campaignId}`)
    ).filter((e) => e.type === 'party.overview_updated');
    expect(published).toHaveLength(2);
    expect(published[1]?.payload).toMatchObject({
      overview: { conditions: ['srd-5e-2024:condition/blinded'] },
    });
  });

  it('never publishes for a solo character (no campaign link at all)', async () => {
    TestBed.inject(PartyOverviewPublisherService);
    const characterId = await seedFighter('Solo');
    const characterStore = TestBed.inject(CharacterStore);
    characterStore.enterSyncMode(characterId);

    const campaignStore = TestBed.inject(CampaignStore);
    const appendSpy = vi.spyOn(campaignStore, 'appendToStream');

    await characterStore.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'X' } }]);
    await waitPastDebounce();

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('does not publish while the linked campaign has no live session (syncState stays "offline")', async () => {
    TestBed.inject(PartyOverviewPublisherService);
    const characterId = await seedFighter('Ivan');
    const campaignId = '55555555-5555-5555-5555-555555555555';
    const characterStore = TestBed.inject(CharacterStore);
    characterStore.enterSyncMode(characterId);
    // Deliberately do NOT flip syncStateFor(...) away from its 'offline' default.
    await characterStore.appendTx([
      { type: 'character.campaign_joined', v: 1, payload: { campaignId } },
    ]);
    await waitPastDebounce();

    const published = (
      await TestBed.inject(EventsRepository).byStream(`camp:${campaignId}`)
    ).filter((e) => e.type === 'party.overview_updated');
    expect(published).toHaveLength(0);
  });

  it('does not publish for a character with no class chosen yet (level 0 — PartyOverviewUpdatedV1.level requires 1..20)', async () => {
    TestBed.inject(PartyOverviewPublisherService);
    const characterStore = TestBed.inject(CharacterStore);
    const characterId = await characterStore.create('Fresh', 'feminine');
    characterStore.enterSyncMode(characterId);
    const campaignId = '66666666-6666-6666-6666-666666666666';
    syncStateFor(`camp:${campaignId}`).set('synced');

    await characterStore.appendTx([
      { type: 'character.campaign_joined', v: 1, payload: { campaignId } },
    ]);
    await waitPastDebounce();

    const published = (
      await TestBed.inject(EventsRepository).byStream(`camp:${campaignId}`)
    ).filter((e) => e.type === 'party.overview_updated');
    expect(published).toHaveLength(0);
  });

  it('does not publish once the store has moved on to a DIFFERENT character before the debounce window elapses', async () => {
    TestBed.inject(PartyOverviewPublisherService);
    const characterStore = TestBed.inject(CharacterStore);
    const characterAId = await seedFighter('A');
    const campaignId = '77777777-7777-7777-7777-777777777777';
    await linkToOpenCampaign(characterAId, campaignId);

    // Before A's debounce timer fires, this tab navigates to a DIFFERENT character.
    const characterBId = await seedFighter('B');
    characterStore.enterSyncMode(characterBId);
    void characterBId;
    await waitPastDebounce();

    const published = (
      await TestBed.inject(EventsRepository).byStream(`camp:${campaignId}`)
    ).filter((e) => e.type === 'party.overview_updated');
    expect(published).toHaveLength(0);
  });
});
