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
import { DialogService } from '@shared/components/dialog/dialog.service';
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
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore } from '@shared/stores/character.store';
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
        useValue: { editLockFor: () => harness.lock, overridesFor: () => signal({}) },
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
    expect(el?.getAttribute('role')).toBe('status');
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
        'report-title',
      ]);
      expect(strings?.['message']).toMatch(/\{count, plural,/);
    }
  });
});
