import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import type { RebasePlan } from '@hk/engine';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import {
  RebaseReportDialogComponent,
  type RebaseReportDialogData,
} from '@shared/components/rebase-report-dialog/rebase-report-dialog.component';
import {
  CampaignEditLockService,
  type CampaignEditLockState,
} from '@shared/services/campaigns/campaign-edit-lock';
import {
  CampaignPacksService,
  type CampaignPackInstallStatus,
} from '@shared/services/campaigns/campaign-packs.service';
import type { EnabledPack } from '@shared/services/campaigns/campaign-projection';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { LeaderService } from '@shared/services/storage/leader.service';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../assets/i18n/characters/uk.json';
import sampleJson from '../../../../testing/fixtures/packs/sample-content.json';
import { CampaignPacksBannerComponent } from './campaign-packs-banner.component';
import { seedFighter } from './testing/character-fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const parsedSample = parsePack(sampleJson);
if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
const sample = parsedSample.pack;

/** A content pack whose override takes Defense out of the fighting styles (the choice queries
 * feats tagged `fighting-style`): pinning it breaks the seeded fighter's `fighting-style`
 * decision, so the plan has an invalid entry. */
const strict: Pack = {
  ...sample,
  id: 'strict-styles',
  name: 'Strict styles',
  entities: [],
  assets: [],
  overrides: [
    {
      target: 'srd-5e-2024:feat/defense',
      patch: [{ op: 'replace', path: '/tags', value: [] }],
    },
  ],
};

/** Plan 16 Task 6 fix round 1 (ruling 7 on the banner path): a pack whose 2.0.0 deprecates the
 * item its 1.0.0 shipped, naming a replacement. A character still holding the old item (pinned
 * 1.0.0 once, then unpinned it) has it migrated when the campaign's 2.0.0 is pinned. */
const OLD_RELIC = 'relics:item/old-relic';
const NEW_RELIC = 'relics:item/new-relic';
const RELIC_INSTANCE = '00000000-0000-4000-8000-0000000000c1';
const relicItem = (
  id: string,
  name: string,
  deprecated?: { replacedBy: string; since: string },
): Pack['entities'][number] => ({
  type: 'item',
  id,
  name,
  tags: [],
  prerequisites: [],
  effects: [],
  grants: [],
  choices: [],
  category: 'gear',
  weight: 1,
  ...(deprecated ? { deprecated } : {}),
});
const relicsV1: Pack = {
  ...sample,
  id: 'relics',
  name: 'Relics',
  version: '1.0.0',
  entities: [relicItem(OLD_RELIC, 'Old Relic')],
  assets: [],
  overrides: [],
};
const relicsV2: Pack = {
  ...relicsV1,
  version: '2.0.0',
  entities: [
    relicItem(OLD_RELIC, 'Old Relic', { replacedBy: NEW_RELIC, since: '2.0.0' }),
    relicItem(NEW_RELIC, 'New Relic'),
  ],
};

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000ab';
const FIGHTING_STYLE = 'srd-5e-2024:class/fighter@1/fighting-style';
const SHA = 'a'.repeat(64);

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'characters/en' ? charactersEn : {});
  }
}

interface Harness {
  readonly live: WritableSignal<ReadonlySet<string>>;
  readonly enabled: WritableSignal<ReadonlyMap<string, ReadonlyMap<string, EnabledPack>>>;
  readonly status: WritableSignal<ReadonlyMap<string, CampaignPackInstallStatus>>;
  readonly lock: WritableSignal<CampaignEditLockState>;
  readonly open: ReturnType<typeof vi.fn>;
}

function enabledSet(...packs: Pack[]): ReadonlyMap<string, ReadonlyMap<string, EnabledPack>> {
  return new Map([
    [CAMPAIGN_ID, new Map(packs.map((p) => [p.id, { version: p.version, sha256: SHA }]))],
  ]);
}

function installed(...packs: Pack[]): ReadonlyMap<string, CampaignPackInstallStatus> {
  return new Map(packs.map((p) => [p.id, { state: 'installed' }]));
}

function configure(packs: Pack[], dialogResult: unknown): Harness {
  const harness: Harness = {
    live: signal<ReadonlySet<string>>(new Set([CAMPAIGN_ID])),
    enabled: signal(enabledSet(sample)),
    status: signal(installed(sample)),
    lock: signal<CampaignEditLockState>({ locked: false }),
    open: vi.fn().mockReturnValue({ closed: Promise.resolve(dialogResult), close: vi.fn() }),
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
      provideTranslocoMessageformat(),
      {
        provide: PackStore,
        useValue: {
          packs: signal(packs),
          installedContent: signal(packs.filter((p) => p.kind === 'content')),
          ready: signal(true),
          corePack: signal(corePack),
        },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
      { provide: SyncService, useValue: { liveCampaignIds: harness.live } },
      { provide: CampaignStore, useValue: { enabledPacks: harness.enabled } },
      {
        provide: CampaignPacksService,
        useValue: {
          installStatus: (campaignId: string) =>
            computed(() => (campaignId === CAMPAIGN_ID ? harness.status() : new Map())),
        },
      },
      {
        provide: CampaignEditLockService,
        useValue: { editLockFor: () => harness.lock, campaignStateFor: () => signal(null) },
      },
      { provide: DialogService, useValue: { open: harness.open } },
    ],
  });
  return harness;
}

async function events(): Promise<Event[]> {
  const streamId = TestBed.inject(CharacterStore).streamId()!;
  return TestBed.inject(EventsRepository).byStream(streamId);
}

async function joinCampaign(campaignId = CAMPAIGN_ID): Promise<void> {
  await TestBed.inject(CharacterStore).appendTx([
    { type: 'character.campaign_joined', v: 1, payload: { campaignId } },
  ]);
}

/** Polls real macrotask turns until `predicate()` holds (the store writes to fake-indexeddb). */
async function settle(fixture: ComponentFixture<unknown>, predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
  expect(predicate()).toBe(true);
}

function banner(fixture: ComponentFixture<unknown>): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector('.campaign-packs-banner');
}

function pinButton(fixture: ComponentFixture<unknown>): HTMLButtonElement {
  const button = banner(fixture)?.querySelector<HTMLButtonElement>('.campaign-packs-banner__pin');
  if (!button) throw new Error('no Pin campaign packs button');
  return button;
}

describe('CampaignPacksBannerComponent (plan 16 Task 5, ruling 4)', () => {
  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  async function setup(
    packs: Pack[] = [corePack, sample],
    dialogResult: unknown = true,
  ): Promise<Harness> {
    const harness = configure(packs, dialogResult);
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
    await seedFighter('Ivan');
    return harness;
  }

  async function render(): Promise<ComponentFixture<CampaignPacksBannerComponent>> {
    const fixture = TestBed.createComponent(CampaignPacksBannerComponent);
    await fixture.whenStable();
    return fixture;
  }

  it('lists an enabled, installed pack the linked character does not pin, with one "Pin campaign packs" action', async () => {
    await setup();
    await joinCampaign();
    const fixture = await render();

    const el = banner(fixture);
    expect(el).not.toBeNull();
    expect(el?.querySelector('[role="status"]')).not.toBeNull();
    expect(el?.textContent).toContain(
      "Your campaign uses a content pack this character doesn't use yet:",
    );
    const entries = Array.from(el?.querySelectorAll('li') ?? []).map((li) =>
      li.textContent?.trim(),
    );
    expect(entries).toEqual([`Sample content v${sample.version}`]);
    expect(pinButton(fixture).textContent?.trim()).toBe('Pin campaign packs');
    expect(pinButton(fixture).disabled).toBe(false);
  });

  it('"Pin campaign packs" commits pack.pinned through the pin path (no report when nothing breaks) and the banner goes away', async () => {
    const { open } = await setup();
    await joinCampaign();
    const fixture = await render();
    const before = (await events()).length;

    pinButton(fixture).click();
    const store = TestBed.inject(CharacterStore);
    await settle(fixture, () => store.facts()?.pins[sample.id] !== undefined);

    const appended = (await events()).slice(before);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      type: 'pack.pinned',
      payload: { packId: sample.id, version: sample.version },
    });
    expect(open).not.toHaveBeenCalled();
    expect(store.index()?.has('sample-content:species/moonkin')).toBe(true);
    await settle(fixture, () => banner(fixture) === null);
  });

  it('the no-report pin path commits plan.events: a held item the pinned version deprecates is migrated to its replacement (ruling 7)', async () => {
    const { open, enabled, status } = await setup([corePack, sample, relicsV1, relicsV2]);
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: 'relics', version: '1.0.0' } },
    ]);
    await store.appendTx([
      {
        type: 'item.added',
        v: 1,
        payload: { instanceId: RELIC_INSTANCE, itemId: OLD_RELIC, qty: 1 },
      },
    ]);
    await store.appendTx([{ type: 'pack.unpinned', v: 1, payload: { packId: 'relics' } }]);
    await joinCampaign();
    enabled.set(enabledSet(relicsV2));
    status.set(installed(relicsV2));
    const fixture = await render();
    const before = (await events()).length;

    pinButton(fixture).click();
    await settle(fixture, () => store.facts()?.pins['relics'] === '2.0.0');

    // No decision breaks and no decision moves, so no report opens — yet the plan's events (not a
    // bare pack.pinned) are what lands, in one transaction.
    expect(open).not.toHaveBeenCalled();
    const appended = (await events()).slice(before);
    expect(appended.map((e) => e.type)).toEqual(['pack.pinned', 'item.updated']);
    expect(appended[0]?.payload).toEqual({ packId: 'relics', version: '2.0.0' });
    expect(appended[1]?.payload).toEqual({ instanceId: RELIC_INSTANCE, itemId: NEW_RELIC });
    expect(appended[1]?.txId).toBe(appended[0]?.txId);
    expect(store.facts()?.inventory.find((e) => e.instanceId === RELIC_INSTANCE)?.itemId).toBe(
      NEW_RELIC,
    );
  });

  it('shows no banner when the character is not linked to a campaign', async () => {
    await setup();
    const fixture = await render();

    expect(banner(fixture)).toBeNull();
  });

  it('shows no banner when the linked campaign has no live session on this device', async () => {
    const { live } = await setup();
    await joinCampaign();
    live.set(new Set());
    const fixture = await render();

    expect(banner(fixture)).toBeNull();
  });

  it('shows no banner once the character left the campaign', async () => {
    await setup();
    await joinCampaign();
    await TestBed.inject(CharacterStore).appendTx([
      { type: 'character.campaign_left', v: 1, payload: { campaignId: CAMPAIGN_ID } },
    ]);
    const fixture = await render();

    expect(banner(fixture)).toBeNull();
  });

  it('shows no banner when every enabled pack is already pinned (at any version — updates belong to the Build tab)', async () => {
    const { enabled, status } = await setup([corePack, sample, strict]);
    await joinCampaign();
    await TestBed.inject(CharacterStore).appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: sample.id, version: sample.version } },
      { type: 'pack.pinned', v: 1, payload: { packId: strict.id, version: '0.9.0' } },
    ]);
    enabled.set(enabledSet(sample, strict));
    status.set(installed(sample, strict));
    const fixture = await render();

    expect(banner(fixture)).toBeNull();
  });

  it('shows a pack that is still being installed as "installing…" and does not offer it for pinning', async () => {
    const { enabled, status } = await setup([corePack, sample]);
    await joinCampaign();
    enabled.set(enabledSet(sample, strict));
    status.set(
      new Map([
        [sample.id, { state: 'installed' }],
        [strict.id, { state: 'installing' }],
      ]),
    );
    const fixture = await render();
    const before = (await events()).length;

    const el = banner(fixture);
    expect(el?.textContent).toContain(
      "Your campaign uses 2 content packs this character doesn't use yet:",
    );
    const entries = Array.from(el?.querySelectorAll('li') ?? []).map((li) =>
      li.textContent?.trim(),
    );
    expect(entries).toEqual([`Sample content v${sample.version}`, `${strict.id} (installing…)`]);

    pinButton(fixture).click();
    const store = TestBed.inject(CharacterStore);
    await settle(fixture, () => store.facts()?.pins[sample.id] !== undefined);
    const appended = (await events()).slice(before);
    expect(appended.map((e) => e.payload)).toEqual([
      { packId: sample.id, version: sample.version },
    ]);
    expect(store.facts()?.pins[strict.id]).toBeUndefined();
  });

  it('disables the action while every unpinned pack is still installing', async () => {
    const { status } = await setup();
    await joinCampaign();
    status.set(new Map([[sample.id, { state: 'installing' }]]));
    const fixture = await render();

    expect(banner(fixture)?.textContent).toContain(`${sample.id} (installing…)`);
    expect(pinButton(fixture).disabled).toBe(true);
  });

  it('does not offer a pack whose install was refused (the campaign settings show the error)', async () => {
    const { status } = await setup();
    await joinCampaign();
    status.set(new Map([[sample.id, { state: 'error', code: 'packs.import-failed-conflict' }]]));
    const fixture = await render();

    expect(banner(fixture)).toBeNull();
  });

  it('disables the action while the campaign edit lock is on', async () => {
    const { lock } = await setup();
    await joinCampaign();
    lock.set({ locked: true, mode: 'locked' });
    const fixture = await render();

    expect(pinButton(fixture).disabled).toBe(true);
  });

  it('opens the rebase report when pinning breaks a decision; Confirm commits plan.events in one transaction', async () => {
    const { open, enabled, status } = await setup([corePack, sample, strict], true);
    await joinCampaign();
    enabled.set(enabledSet(strict));
    status.set(installed(strict));
    const fixture = await render();
    const before = (await events()).length;

    pinButton(fixture).click();
    const store = TestBed.inject(CharacterStore);
    await settle(fixture, () => store.facts()?.pins[strict.id] !== undefined);

    expect(open).toHaveBeenCalledTimes(1);
    const [component, opts] = open.mock.calls[0] as [unknown, { data: RebaseReportDialogData }];
    expect(component).toBe(RebaseReportDialogComponent);
    expect(opts.data.title).toBe('Pin campaign packs?');
    const plan: RebasePlan = opts.data.plan;
    expect(plan.invalid).toEqual([
      {
        choiceId: FIGHTING_STYLE,
        selection: ['srd-5e-2024:feat/defense'],
        reason: 'selection-missing',
      },
    ]);

    const appended = (await events()).slice(before);
    expect(appended.map((e) => e.type)).toEqual(['pack.pinned', 'decision.cleared']);
    expect(appended[0]?.payload).toEqual({ packId: strict.id, version: strict.version });
    expect(appended[1]?.txId).toBe(appended[0]?.txId);
    expect(store.facts()?.decisions[FIGHTING_STYLE]).toBeUndefined();
  });

  it('Cancel in the rebase report commits nothing', async () => {
    const { open, enabled, status } = await setup([corePack, sample, strict], false);
    await joinCampaign();
    enabled.set(enabledSet(strict));
    status.set(installed(strict));
    const fixture = await render();
    const before = (await events()).length;

    pinButton(fixture).click();
    await settle(fixture, () => open.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(await events()).toHaveLength(before);
    expect(TestBed.inject(CharacterStore).facts()?.pins[strict.id]).toBeUndefined();
    expect(banner(fixture)).not.toBeNull();
  });

  // [final fix wave, F9] Only the leader tab may write character events (`CharacterStore.appendTx`
  // throws `CharacterStoreNotLeaderError` elsewhere): the action is disabled there, with the reason.
  it('disables the action on a tab that is not the writer and says why', async () => {
    await setup();
    await joinCampaign();
    TestBed.inject(LeaderService).release();
    const fixture = await render();

    expect(pinButton(fixture).disabled).toBe(true);
    expect(
      banner(fixture)?.querySelector('.campaign-packs-banner__notice')?.textContent?.trim(),
    ).toBe(charactersEn['not-leader']);
  });

  it('a failed pin shows a toast (not-leader text for a lost leadership, a generic one otherwise) and re-enables the action', async () => {
    await setup();
    await joinCampaign();
    const fixture = await render();
    const store = TestBed.inject(CharacterStore);
    const show = vi.spyOn(TestBed.inject(ToastService), 'show').mockImplementation(() => undefined);
    const append = vi.spyOn(store, 'appendTx');

    append.mockRejectedValueOnce(new CharacterStoreNotLeaderError());
    pinButton(fixture).click();
    await settle(fixture, () => show.mock.calls.length === 1);
    expect(show).toHaveBeenLastCalledWith('characters.not-leader');

    append.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await settle(fixture, () => !pinButton(fixture).disabled);
    pinButton(fixture).click();
    await settle(fixture, () => show.mock.calls.length === 2);
    expect(show).toHaveBeenLastCalledWith('characters.sheet.banner.campaign-packs.pin-failed');

    await settle(fixture, () => !pinButton(fixture).disabled);
    expect(store.facts()?.pins[sample.id]).toBeUndefined();
  });

  it('the banner strings exist in en, ru and uk (ICU plural)', () => {
    for (const locale of [charactersEn, charactersRu, charactersUk]) {
      const strings = (
        locale.sheet as unknown as { banner?: Record<string, Record<string, string>> }
      ).banner?.['campaign-packs'];
      expect(Object.keys(strings ?? {}).sort()).toEqual([
        'entry',
        'installing',
        'message',
        'pin',
        'pin-failed',
        'report-title',
      ]);
      expect(strings?.['message']).toMatch(/\{count, plural,/);
    }
  });
});
