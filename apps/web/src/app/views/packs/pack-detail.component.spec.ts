import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DIALOG_DATA, DialogRef, DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { CampaignPacksService } from '@shared/services/campaigns/campaign-packs.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CampaignStore } from '@shared/stores/campaign.store';
import { PackRemoveDependentsError, PackStore } from '@shared/stores/pack.store';
import packsEn from '../../../assets/i18n/packs/en.json';
import sampleJson from '../../../testing/fixtures/packs/sample-content.json';
import { HkpackDelivery } from '@shared/services/packs/hkpack-delivery';
import {
  HkpackAssetsMissingError,
  HkpackWriter,
} from '@shared/services/packs/hkpack-writer.service';
import { HeroSummaryService } from '../characters/hero-summary.service';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';

const deliver = vi.fn().mockResolvedValue('saved');
import { PackDetailComponent, PackRemoveConfirmComponent } from './pack-detail.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'packs/en') return of(packsEn);
    return of({});
  }
}

const SAMPLE_KEY = 'sample-content@1.0.0';

function samplePack(): Pack {
  const parsed = parsePack(sampleJson);
  if (!parsed.ok) throw new Error('sample-content.json fixture no longer parses');
  return parsed.pack;
}

const CORE = {
  ...samplePack(),
  id: 'srd-5e-2024',
  version: '0.1.0',
  name: 'SRD 5.2.1',
  dependencies: [],
  assets: [],
  entities: [],
} as Pack;

let nextEventId = 1;
function mkEvent(stream: string, type: string, payload: unknown): Event {
  const id = `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream,
    ts: '2026-10-18T00:00:00.000Z',
    actor: { userId: 'local', deviceId: 'dev_1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
}

/** Seeds a stored character whose event log creates it (core pinned) and then appends `extra`. */
async function seedCharacter(name: string, extra: (stream: string) => Event[]): Promise<void> {
  const stream = `char:00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  await TestBed.inject(CharactersRepository).put({
    id: stream,
    name,
    system: 'srd-5e-2024',
    archived: false,
    updatedAt: 1000,
  });
  await TestBed.inject(EventsRepository).append([
    mkEvent(stream, 'character.created', {
      name,
      system: 'srd-5e-2024',
      engineVersion: '0.0.0',
      corePack: { id: 'srd-5e-2024', version: '0.1.0' },
    }),
    ...extra(stream),
  ]);
}

const pinSample = (stream: string) => [
  mkEvent(stream, 'pack.pinned', { packId: 'sample-content', version: '1.0.0' }),
];

async function setup(
  key: string,
  options: {
    confirm?: unknown;
    dependents?: Pack[];
    removeError?: unknown;
    installed?: Pack[];
    campaigns?: { id: string; name: string; version: string; state: string }[];
    writer?: unknown;
    summaries?: unknown;
  } = {},
) {
  const removeContent =
    options.removeError === undefined
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(options.removeError);
  const dependentsOf = vi.fn(() => options.dependents ?? []);
  const open = vi.fn(() => ({ closed: Promise.resolve(options.confirm), close: vi.fn() }));
  const show = vi.fn();
  const paramMap = convertToParamMap({ key });

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
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
      { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
      {
        provide: PackStore,
        useValue: {
          corePack: signal<Pack | undefined>(CORE),
          installedContent: signal<Pack[]>(options.installed ?? [samplePack()]),
          removeContent,
          dependentsOf,
        },
      },
      { provide: DialogService, useValue: { open } },
      { provide: HkpackDelivery, useValue: { deliver } },
      ...(options.writer ? [{ provide: HkpackWriter, useValue: options.writer }] : []),
      ...(options.summaries ? [{ provide: HeroSummaryService, useValue: options.summaries }] : []),
      {
        provide: CampaignsRepository,
        useValue: {
          list: () =>
            Promise.resolve((options.campaigns ?? []).map(({ id, name }) => ({ id, name }))),
        },
      },
      {
        provide: CampaignStore,
        useValue: {
          enabledPacks: signal(
            new Map(
              (options.campaigns ?? []).map((c) => [
                c.id,
                new Map([['sample-content', { version: c.version, sha256: 'ab' }]]),
              ]),
            ),
          ),
        },
      },
      {
        provide: CampaignPacksService,
        useValue: {
          installStatus: (campaignId: string) =>
            signal(
              new Map([
                [
                  'sample-content',
                  {
                    state:
                      options.campaigns?.find((c) => c.id === campaignId)?.state ?? 'installed',
                  },
                ],
              ]),
            ),
        },
      },
      {
        provide: EngineFacade,
        useValue: { localizer: () => ({ name: (id: string) => id.split('/').pop() ?? id }) },
      },
      { provide: ToastService, useValue: { show } },
      {
        provide: MarkdownService,
        useValue: { render: (markdown: string) => Promise.resolve(markdown) },
      },
      { provide: LocaleService, useValue: { locale: signal('en') } },
    ],
  });

  const db = TestBed.inject(HkDb);
  await Promise.all([db.characters.clear(), db.events.clear(), db.snapshots.clear()]);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { removeContent, open, show, navigate };
}

async function render() {
  const fixture = TestBed.createComponent(PackDetailComponent);
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('PackDetailComponent', () => {
  it('shows the pack information and how many stored characters pin it', async () => {
    await setup(SAMPLE_KEY);
    await seedCharacter('Aria', pinSample);
    await seedCharacter('Brann', pinSample);
    // Pinned, then opted out — not counted.
    await seedCharacter('Cora', (stream) => [
      ...pinSample(stream),
      mkEvent(stream, 'pack.unpinned', { packId: 'sample-content' }),
    ]);
    // A different version of the same pack — not counted.
    await seedCharacter('Dain', (stream) => [
      mkEvent(stream, 'pack.pinned', { packId: 'sample-content', version: '0.9.0' }),
    ]);
    await seedCharacter('Edda', () => []);

    const { root } = await render();

    expect(root.querySelector('.pack-detail__title')?.textContent).toContain('Sample content');
    expect(root.querySelector('.pack-info__license')?.textContent).toContain('CC-BY-4.0');
    expect(root.querySelector('.pack-detail__used-by')?.textContent?.trim()).toBe(
      'Used by 2 characters',
    );
    expect(root.querySelector('.pack-detail__remove')).not.toBeNull();
  });

  it('Remove asks for confirmation, then removes the pack and navigates to /packs', async () => {
    const { removeContent, open, navigate, show } = await setup(SAMPLE_KEY, { confirm: true });
    await seedCharacter('Aria', pinSample);
    await seedCharacter('Brann', pinSample);
    const { fixture, root } = await render();

    root.querySelector<HTMLButtonElement>('.pack-detail__remove')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(open).toHaveBeenCalledWith(PackRemoveConfirmComponent, {
      data: { name: 'Sample content', count: 2 },
    });
    expect(removeContent).toHaveBeenCalledWith(SAMPLE_KEY);
    expect(show).toHaveBeenCalledWith('packs.remove-success');
    expect(navigate).toHaveBeenCalledWith(['/packs']);
  });

  it('a cancelled confirmation removes nothing', async () => {
    const { removeContent, navigate } = await setup(SAMPLE_KEY, { confirm: false });
    const { fixture, root } = await render();

    root.querySelector<HTMLButtonElement>('.pack-detail__remove')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(removeContent).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lists the installed packs that depend on it and disables Remove', async () => {
    const addon = {
      ...samplePack(),
      id: 'sample-addon',
      name: 'Sample add-on',
      dependencies: [{ id: 'sample-content', range: '^1.0.0' }],
    } as Pack;
    const { removeContent } = await setup(SAMPLE_KEY, { confirm: true, dependents: [addon] });
    const { fixture, root } = await render();

    expect(root.querySelector('.pack-detail__dependents')?.textContent?.trim()).toBe(
      '1 installed pack depends on this pack. Remove it first.',
    );
    expect(
      [...root.querySelectorAll('.pack-detail__dependent')].map((li) => li.textContent?.trim()),
    ).toEqual(['Sample add-on 1.0.0']);
    const remove = root.querySelector<HTMLButtonElement>('.pack-detail__remove')!;
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(remove.querySelector('.hk-button__reason')?.textContent?.trim()).toBe(
      packsEn.detail['remove-blocked'],
    );
    remove.click();
    await fixture.whenStable();
    expect(removeContent).not.toHaveBeenCalled();
  });

  it('a removal the store refuses for dependents shows the dependents toast', async () => {
    const { show, navigate } = await setup(SAMPLE_KEY, {
      confirm: true,
      removeError: new PackRemoveDependentsError(SAMPLE_KEY, ['sample-addon@1.0.0']),
    });
    const { fixture, root } = await render();

    root.querySelector<HTMLButtonElement>('.pack-detail__remove')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(show).toHaveBeenCalledWith('packs.remove-failed-dependents');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the core pack has no Remove action', async () => {
    await setup('srd-5e-2024@0.1.0');
    const { root } = await render();

    expect(root.querySelector('.pack-detail__title')?.textContent).toContain('SRD 5.2.1');
    expect(root.querySelector('.pack-detail__remove')).toBeNull();
    expect(root.querySelector('.pack-detail__core-note')?.textContent?.trim()).toBe(
      packsEn.detail['core-note'],
    );
  });

  it('an unknown key shows the not-found state', async () => {
    await setup('nope@1.0.0');
    const { root } = await render();
    expect(root.querySelector('.pack-detail__not-found')?.textContent?.trim()).toBe(
      packsEn.detail['not-found'],
    );
    expect(root.querySelector('.pack-detail__remove')).toBeNull();
  });
});

describe('PackDetailComponent, board PK02 elements (plan 17 B12b)', () => {
  it('lists the heroes that pin this version, each with Open sheet', async () => {
    const { navigate } = await setup(SAMPLE_KEY);
    await seedCharacter('Aria', pinSample);
    await seedCharacter('Brann', () => []);
    const { fixture, root } = await render();

    const users = [...root.querySelectorAll('.pack-detail__user')];
    expect(users.map((u) => u.querySelector('.pack-detail__user-name')?.textContent)).toEqual([
      'Aria',
    ]);
    expect(users[0].textContent).toContain('pinned 1.0.0');
    users[0].querySelector<HTMLButtonElement>('.pack-detail__open-sheet')!.click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/c', expect.stringContaining('char:')]);
  });

  it('shows the versions on this device with the heroes pinning each and the dependencies', async () => {
    await setup(SAMPLE_KEY);
    await seedCharacter('Aria', pinSample);
    const { root } = await render();

    const row = root.querySelector('.pack-detail__version-row[data-version="1.0.0"]')!;
    expect(row.textContent).toContain('pinned by 1 hero');
    expect(row.textContent).toContain(packsEn.detail.current);
    const need = root.querySelector('.pack-detail__need')!;
    expect(need.textContent).toContain('SRD');
    expect(root.querySelector('.pack-detail__deps')?.textContent).toContain(
      packsEn.detail['nothing-depends'],
    );
  });

  it('the strap has Back, a drawn-disabled Update pack with its reason, and Export', async () => {
    await setup(SAMPLE_KEY);
    await render();
    const config = TestBed.inject(ActionStrapService).config()!;
    expect(config.exit?.map((a) => a.id)).toEqual(['back']);
    const update = config.primary.find((a) => a.id === 'update-pack')!;
    expect(update.disabled).toBe(true);
    expect(update.disabledReason).toBe('shell.strap.packs-update-none');
    expect(config.secondary?.find((a) => a.id === 'export-pack')?.disabled).toBe(false);
  });
});

describe('PackDetailComponent, fix round: provenance, heroes, dependencies, export', () => {
  const exportAction = () =>
    TestBed.inject(ActionStrapService)
      .config()!
      .secondary!.find((a) => a.id === 'export-pack')!;

  it('names the campaign that shares this exact version and its sha256 check state', async () => {
    await setup(SAMPLE_KEY, {
      campaigns: [
        { id: 'c1', name: 'The Emberfall Company', version: '1.0.0', state: 'installed' },
        { id: 'c2', name: 'Salt Kings', version: '0.9.0', state: 'installed' },
        { id: 'c3', name: 'Old Guard', version: '1.0.0', state: 'error' },
      ],
    });
    const { root } = await render();
    expect(
      [...root.querySelectorAll('.pack-detail__campaign')].map((c) => c.textContent?.trim()),
    ).toEqual(['Campaign: The Emberfall Company', 'Campaign: Old Guard']);
    const lines = [...root.querySelectorAll('.pack-detail__integrity')];
    expect(lines.map((l) => l.getAttribute('data-state'))).toEqual(['installed', 'error']);
    expect(lines[0].textContent).toContain('matches the record of The Emberfall Company');
    expect(lines[1].textContent).toContain('does not match the record of Old Guard');
  });

  it('shows each hero that pins the pack with a portrait frame and the class line', async () => {
    await setup(SAMPLE_KEY, {
      summaries: {
        summarize: (ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id) => [id, { classes: [{ classId: 'srd:class/paladin', level: 5 }] }]),
            ),
          ),
      },
    });
    await seedCharacter('Ilyana Vorn', pinSample);
    const { root } = await render();
    const user = root.querySelector('.pack-detail__user')!;
    expect(user.querySelector('hk-portrait-frame')).not.toBeNull();
    expect(user.querySelector('.pack-detail__hero-line')?.textContent?.trim()).toBe('paladin 5');
  });

  it('says dependencies with the pack name and a version phrase, not the raw range or id', async () => {
    await setup(SAMPLE_KEY);
    const { root } = await render();
    const info = root.querySelector('.pack-info__dependencies')!;
    expect(info.textContent).toContain('SRD 5.2.1');
    expect(info.textContent).toContain('0.1.0 or newer');
    expect(info.textContent).not.toContain('^0.1.0');
    expect(info.textContent).not.toContain('srd-5e-2024');
    const need = root.querySelector('.pack-detail__need')!;
    expect(need.textContent).toContain('SRD 5.2.1');
    expect(need.textContent).toContain('0.1.0 or newer');
    expect(need.textContent).toContain(packsEn.info['dep-installed']);
  });

  it('marks a dependency that is not installed', async () => {
    const orphan = {
      ...samplePack(),
      dependencies: [{ id: 'ghost-pack', range: '>=2.0.0' }],
    } as Pack;
    await setup(SAMPLE_KEY, { installed: [orphan] });
    const { root } = await render();
    const need = root.querySelector('.pack-detail__need')!;
    expect(need.textContent).toContain('ghost-pack');
    expect(need.textContent).toContain('2.0.0 or newer');
    expect(need.textContent).toContain(packsEn.info['dep-missing']);
  });

  it('draws Export disabled for the core pack, with the reason on the action', async () => {
    await setup('srd-5e-2024@0.1.0');
    await render();
    expect(exportAction().disabled).toBe(true);
    expect(exportAction().disabledReason).toBe('shell.strap.packs-export-core');
  });

  it('draws Export disabled for a pack the importer would refuse', async () => {
    const broken = {
      ...samplePack(),
      dependencies: [{ id: 'ghost-pack', range: '^1.0.0' }],
    } as Pack;
    await setup(SAMPLE_KEY, { installed: [broken] });
    await render();
    expect(exportAction().disabled).toBe(true);
    expect(exportAction().disabledReason).toBe('shell.strap.packs-export-invalid');
  });

  it('Export builds the archive and hands it to the delivery ladder', async () => {
    const blob = new Blob(['zip']);
    const exportFn = vi.fn().mockResolvedValue({ blob, fileName: 'sample-content-1.0.0.hkpack' });
    await setup(SAMPLE_KEY, { writer: { export: exportFn } });
    const { show } = TestBed.inject(ToastService) as unknown as { show: ReturnType<typeof vi.fn> };
    await render();
    expect(exportAction().disabled).toBe(false);
    exportAction().run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exportFn).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(blob, 'sample-content-1.0.0.hkpack', 'Sample content');
    expect(show).not.toHaveBeenCalled();
  });

  it('a missing image blob toasts its own reason; any other failure toasts export-failed', async () => {
    const exportFn = vi
      .fn()
      .mockRejectedValueOnce(new HkpackAssetsMissingError('sample-content@1.0.0'))
      .mockRejectedValueOnce(new Error('disk'));
    await setup(SAMPLE_KEY, { writer: { export: exportFn } });
    const { show } = TestBed.inject(ToastService) as unknown as { show: ReturnType<typeof vi.fn> };
    await render();
    exportAction().run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(show).toHaveBeenLastCalledWith('packs.export-assets-missing');
    exportAction().run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(show).toHaveBeenLastCalledWith('packs.export-failed');
  });
});

describe('PackRemoveConfirmComponent', () => {
  function configure(count: number) {
    const close = vi.fn();
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
        { provide: DIALOG_DATA, useValue: { name: 'Sample content', count } },
        { provide: DialogRef, useValue: { close } },
      ],
    });
    return { close };
  }

  it('warns that pinning characters will show unresolved references', async () => {
    const { close } = configure(2);
    const fixture = TestBed.createComponent(PackRemoveConfirmComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-dialog-title]')?.textContent).toContain('Sample content');
    expect(root.querySelector('.pack-remove-confirm__body')?.textContent?.trim()).toBe(
      '2 characters use this pack. After removal they will show unresolved references until you reinstall it.',
    );

    root.querySelector<HTMLButtonElement>('.pack-remove-confirm__confirm')!.click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('Cancel closes with false', async () => {
    const { close } = configure(0);
    const fixture = TestBed.createComponent(PackRemoveConfirmComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLButtonElement>('.pack-remove-confirm__cancel')!.click();
    expect(close).toHaveBeenCalledWith(false);
  });
});
