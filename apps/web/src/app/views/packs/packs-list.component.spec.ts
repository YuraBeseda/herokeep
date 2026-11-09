import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkpackReader, type PackImportPreview } from '@shared/services/packs/hkpack-reader.service';
import { HomebrewIdService } from '@shared/services/packs/homebrew-id';
import {
  PackImportBadSchemaError,
  PackImportInvalidError,
  PackImportTooLargeError,
} from '@shared/services/packs/pack-import.errors';
import { PackStore } from '@shared/stores/pack.store';
import packsEn from '../../../assets/i18n/packs/en.json';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';
import { HomebrewNewChooserComponent } from './homebrew/homebrew-new-chooser.component';
import { PackTrustDialogComponent } from './pack-trust-dialog.component';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CampaignStore } from '@shared/stores/campaign.store';
import { PackUsageService } from './pack-usage.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { PacksListComponent } from './packs-list.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'packs/en') return of(packsEn);
    return of({});
  }
}

function mkPack(overrides: Partial<Pack>): Pack {
  return {
    format: 1,
    id: 'some-pack',
    version: '1.0.0',
    kind: 'content',
    name: 'Some pack',
    authors: [],
    dependencies: [],
    locale: 'en',
    entities: [],
    overrides: [],
    assets: [],
    i18n: {},
    strings: {},
    ...overrides,
  };
}

const CORE = mkPack({ id: 'srd-5e-2024', version: '0.1.0', name: 'SRD 5.2.1' });
/** This device's homebrew pack id (stubbed `HomebrewIdService`). */
const LOCAL_HOMEBREW = 'homebrew-aaaaaaaa';
const SAMPLE = mkPack({ id: 'sample-content', version: '1.0.0', name: 'Sample content' });
const RU = mkPack({
  id: 'srd-5e-2024-ru-sample',
  version: '0.1.0',
  kind: 'translation',
  name: 'RU sample',
  locale: 'ru',
});

function setup(
  options: {
    read?: ReturnType<typeof vi.fn>;
    content?: Pack[];
    storedPins?: Record<string, string>[];
    campaigns?: { id: string; name: string; packs: Record<string, string> }[];
    removeTranslationFails?: boolean;
  } = {},
) {
  const translationPacks = signal<Pack[]>([RU]);
  const removeTranslation = vi.fn((key: string) => {
    if (options.removeTranslationFails) return Promise.reject(new Error('idb'));
    translationPacks.update((packs) => packs.filter((p) => `${p.id}@${p.version}` !== key));
    return Promise.resolve();
  });
  const read = options.read ?? vi.fn();
  const open = vi.fn<(...args: unknown[]) => { closed: Promise<unknown>; close: () => void }>(
    () => ({ closed: Promise.resolve(undefined), close: vi.fn() }),
  );
  const show = vi.fn();
  const heroPins = vi.fn(() =>
    Promise.resolve(
      (options.storedPins ?? []).map((pins, index) => ({
        id: `char:${index}`,
        name: `Hero ${index}`,
        pins,
      })),
    ),
  );

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
      {
        provide: PackStore,
        useValue: {
          corePack: signal<Pack | undefined>(CORE),
          installedContent: signal<Pack[]>(options.content ?? [SAMPLE]),
          translationPacks,
          removeTranslation,
        },
      },
      { provide: HkpackReader, useValue: { read } },
      { provide: DialogService, useValue: { open } },
      { provide: ToastService, useValue: { show } },
      { provide: PackUsageService, useValue: { heroPins } },
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
                new Map(
                  Object.entries(c.packs).map(([id, version]) => [id, { version, sha256: 'ab' }]),
                ),
              ]),
            ),
          ),
        },
      },
      { provide: LocaleService, useValue: { locale: signal('en') } },
      {
        provide: StoragePersistService,
        useValue: { estimate: signal(undefined), persisted: signal(undefined) },
      },
      { provide: HomebrewIdService, useValue: { id: signal<string | null>(LOCAL_HOMEBREW) } },
    ],
  });

  return { read, open, show, removeTranslation, heroPins };
}

async function render() {
  const fixture = TestBed.createComponent(PacksListComponent);
  await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

/** Puts `file` on the hidden input and fires `change`, then waits out the async import chain. */
async function selectFile(
  fixture: { whenStable(): Promise<unknown> },
  root: HTMLElement,
  file: File,
): Promise<void> {
  const input = root.querySelector<HTMLInputElement>('.packs-list__import-input')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
}

describe('PacksListComponent', () => {
  it("hints that another device's homebrew pack came from another device (never this device's own)", async () => {
    const homebrew = (id: string) =>
      ({ ...SAMPLE, id, name: 'My homebrew', entities: [], assets: [] }) as Pack;
    setup({ content: [SAMPLE, homebrew(LOCAL_HOMEBREW), homebrew('homebrew-bbbbbbbb')] });
    const { root } = await render();

    const rowOf = (key: string) =>
      root.querySelector<HTMLElement>(
        `.packs-list__content .packs-list__row[data-pack-key="${key}"]`,
      )!;
    const hint = (key: string) =>
      rowOf(key).querySelector('.packs-list__other-device')?.textContent?.trim();
    expect(hint('homebrew-bbbbbbbb@1.0.0')).toBe(packsEn.list['other-device-homebrew']);
    expect(hint(`${LOCAL_HOMEBREW}@1.0.0`)).toBeUndefined();
    expect(hint('sample-content@1.0.0')).toBeUndefined();
  });

  it('renders the translated title (the packs scope is loaded, not the raw key)', async () => {
    setup();
    const { root } = await render();
    expect(root.querySelector('.packs-list__title')?.textContent?.trim()).toBe(packsEn.list.title);
  });

  it('renders the core, content and translation groups from the PackStore', async () => {
    setup();
    const { root } = await render();

    const core = root.querySelector<HTMLElement>('.packs-list__core')!;
    expect(core.textContent).toContain('SRD 5.2.1');
    expect(core.textContent).toContain('0.1.0');
    expect(core.textContent).toContain(packsEn.list['core-label']);

    const content = root.querySelector<HTMLElement>('.packs-list__content')!;
    const link = content.querySelector<HTMLAnchorElement>('a[href="/packs/sample-content@1.0.0"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Sample content');

    const translations = root.querySelector<HTMLElement>('.packs-list__translations')!;
    expect(
      translations.querySelector('[data-pack-key="srd-5e-2024-ru-sample@0.1.0"]'),
    ).not.toBeNull();
  });

  it('removes a translation pack through PackStore.removeTranslation', async () => {
    const { removeTranslation } = setup();
    const { fixture, root } = await render();

    root
      .querySelector<HTMLElement>(
        '[data-pack-key="srd-5e-2024-ru-sample@0.1.0"] .packs-list__remove-translation',
      )!
      .click();
    await fixture.whenStable();

    expect(removeTranslation).toHaveBeenCalledWith('srd-5e-2024-ru-sample@0.1.0');
    expect(root.querySelector('[data-pack-key="srd-5e-2024-ru-sample@0.1.0"]')).toBeNull();
  });

  it('a failed translation removal toasts remove-failed and keeps the chip', async () => {
    const { show } = setup({ removeTranslationFails: true });
    const { fixture, root } = await render();

    root
      .querySelector<HTMLElement>(
        '[data-pack-key="srd-5e-2024-ru-sample@0.1.0"] .packs-list__remove-translation',
      )!
      .click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(show).toHaveBeenCalledWith('packs.remove-failed');
    expect(root.querySelector('[data-pack-key="srd-5e-2024-ru-sample@0.1.0"]')).not.toBeNull();
  });

  it('binds the Import button to a hidden file input accepting .hkpack and .json', async () => {
    setup();
    const { root } = await render();
    const input = root.querySelector<HTMLInputElement>('.packs-list__import-input')!;
    expect(input.type).toBe('file');
    expect(input.hidden).toBe(true);
    expect(input.getAttribute('accept')).toBe('.hkpack,.json');
    expect(root.querySelector('.packs-list__import')?.textContent?.trim()).toBe(
      packsEn.list.import,
    );
  });

  it('reads a selected file and opens the trust dialog with the preview', async () => {
    const preview = { pack: SAMPLE } as unknown as PackImportPreview;
    const read = vi.fn().mockResolvedValue(preview);
    const { open, show } = setup({ read });
    const { fixture, root } = await render();

    const file = new File(['{}'], 'sample.hkpack');
    await selectFile(fixture, root, file);

    expect(read).toHaveBeenCalledWith(file);
    expect(open).toHaveBeenCalledWith(PackTrustDialogComponent, {
      data: { ...preview, fileName: 'sample.hkpack', fileSize: file.size },
      size: 'wide',
    });
    expect(show).not.toHaveBeenCalled();
  });

  it("shows a reader error as a toast with the error's code", async () => {
    const read = vi.fn().mockRejectedValue(new PackImportTooLargeError('zip-bytes', 10, 5));
    const { open, show } = setup({ read });
    const { fixture, root } = await render();

    await selectFile(fixture, root, new File(['x'], 'big.hkpack'));

    expect(show).toHaveBeenCalledWith('packs.import-failed-too-large');
    expect(open).not.toHaveBeenCalled();
  });

  it('lists the schema issues of a bad-schema refusal below the toast', async () => {
    const read = vi
      .fn()
      .mockRejectedValue(
        new PackImportBadSchemaError(['kind: only content packs can be imported']),
      );
    const { show } = setup({ read });
    const { fixture, root } = await render();

    await selectFile(fixture, root, new File(['{}'], 'pack.json'));

    expect(show).toHaveBeenCalledWith('packs.import-failed-bad-schema');
    const details = root.querySelector<HTMLElement>('.packs-list__import-details')!;
    expect(details.textContent).toContain(packsEn.list['import-details']);
    expect(details.textContent).toContain('kind: only content packs can be imported');
  });

  it('lists the error diagnostics of an invalid-pack refusal', async () => {
    const read = vi
      .fn()
      .mockRejectedValue(
        new PackImportInvalidError([
          { severity: 'error', code: 'unresolved-ref', message: 'Unknown entity x' },
        ]),
      );
    const { show } = setup({ read });
    const { fixture, root } = await render();

    await selectFile(fixture, root, new File(['{}'], 'pack.json'));

    expect(show).toHaveBeenCalledWith('packs.import-failed-invalid');
    const details = root.querySelector<HTMLElement>('.packs-list__import-details')!;
    expect(details.textContent).toContain('unresolved-ref');
    expect(details.textContent).toContain('Unknown entity x');
  });

  it('shows a generic toast for an unexpected (non-import) failure', async () => {
    const read = vi.fn().mockRejectedValue(new Error('boom'));
    const { show } = setup({ read });
    const { fixture, root } = await render();

    await selectFile(fixture, root, new File(['{}'], 'pack.json'));

    expect(show).toHaveBeenCalledWith('packs.import-failed-unknown');
    expect(root.querySelector('.packs-list__import-details')).toBeNull();
  });

  describe('"Update available" badge (plan 15 Task 5)', () => {
    const SAMPLE_11 = mkPack({ id: 'sample-content', version: '1.1.0', name: 'Sample content' });

    /** The resource behind the badge reads the stored characters asynchronously. */
    async function renderSettled() {
      const rendered = await render();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await rendered.fixture.whenStable();
      return rendered;
    }

    const badgeOf = (root: HTMLElement, key: string) =>
      root.querySelector(`.packs-list__row[data-pack-key="${key}"] .packs-list__update`);

    it('marks the newest installed version when a stored character pins an older one', async () => {
      const { heroPins } = setup({
        content: [SAMPLE, SAMPLE_11],
        storedPins: [{ [CORE.id]: CORE.version, [SAMPLE.id]: '1.0.0' }],
      });
      const { root } = await renderSettled();

      expect(heroPins).toHaveBeenCalled();
      expect(badgeOf(root, 'sample-content@1.1.0')?.textContent?.trim()).toBe(
        packsEn['update-available'],
      );
      expect(badgeOf(root, 'sample-content@1.0.0')).toBeNull();
      expect(badgeOf(root, 'srd-5e-2024@0.1.0')).toBeNull();
    });

    it('shows no badge when every stored character pins the newest installed version', async () => {
      setup({
        content: [SAMPLE, SAMPLE_11],
        storedPins: [{ [CORE.id]: CORE.version, [SAMPLE.id]: '1.1.0' }, { [CORE.id]: '0.1.0' }],
      });
      const { root } = await renderSettled();

      expect(root.querySelector('.packs-list__update')).toBeNull();
    });

    it('marks the core when a stored character pins another core version', async () => {
      setup({ storedPins: [{ [CORE.id]: '0.0.9' }] });
      const { root } = await renderSettled();

      expect(badgeOf(root, 'srd-5e-2024@0.1.0')?.textContent?.trim()).toBe(
        packsEn['update-available'],
      );
      expect(badgeOf(root, 'sample-content@1.0.0')).toBeNull();
    });

    it('does not mark the core when a stored character pins a NEWER core (no downgrade)', async () => {
      setup({ storedPins: [{ [CORE.id]: '0.2.0' }] });
      const { root } = await renderSettled();

      expect(root.querySelector('.packs-list__update')).toBeNull();
    });
  });

  describe('board PK01 elements (plan 17 B12b)', () => {
    async function renderSettled() {
      const rendered = await render();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await rendered.fixture.whenStable();
      return rendered;
    }

    it('shows entries, images and how many stored heroes pin each pack on its row', async () => {
      const withAssets = mkPack({
        id: 'sample-content',
        version: '1.0.0',
        name: 'Sample content',
        authors: ['Herokeep contributors'],
        license: 'CC BY 4.0',
        assets: [{ hash: `sha256:${'a'.repeat(64)}`, kind: 'icon', mime: 'image/webp', size: 34 }],
      });
      setup({
        content: [withAssets],
        storedPins: [{ [withAssets.id]: '1.0.0' }, { [withAssets.id]: '1.0.0' }, {}],
      });
      const { root } = await renderSettled();
      const sub = root.querySelector(
        '.packs-list__row[data-pack-key="sample-content@1.0.0"] .packs-list__sub',
      )!;
      expect(sub.textContent).toContain('Herokeep contributors');
      expect(sub.textContent).toContain('0 entries');
      expect(sub.textContent).toContain('1 image');
      expect(sub.textContent).toContain('used by 2 heroes');
    });

    it("draws this device's homebrew with its chip and an Edit button, and the core with its lock", async () => {
      const homebrew = mkPack({ id: LOCAL_HOMEBREW, name: 'My homebrew', version: '0.1.0' });
      setup({ content: [homebrew] });
      const { root } = await renderSettled();
      const row = root.querySelector(`.packs-list__row[data-pack-key="${LOCAL_HOMEBREW}@0.1.0"]`)!;
      expect(row.textContent).toContain(packsEn.list['this-device']);
      expect(row.querySelector('.packs-list__edit')).not.toBeNull();
      const lock = root.querySelector('.packs-list__core .packs-list__lock')!;
      expect(lock.getAttribute('aria-label')).toBe(packsEn.list['core-lock']);
    });

    it('an empty content group offers Import pack and New homebrew inside the card', async () => {
      setup({ content: [] });
      const { root } = await renderSettled();
      const card = root.querySelector('.packs-list__empty-card')!;
      expect(card.textContent).toContain(packsEn.list.import);
      expect(card.textContent).toContain(packsEn.homebrew['open-new']);
    });

    it('a dropped file goes through the same import path as a chosen one', async () => {
      const preview = { pack: SAMPLE } as unknown as PackImportPreview;
      const read = vi.fn().mockResolvedValue(preview);
      const { open } = setup({ read });
      const { fixture, root } = await render();
      const file = new File(['{}'], 'dropped.hkpack');
      const drop = new Event('drop', { cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
      root.querySelector('.packs-list__dropzone')!.dispatchEvent(drop);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
      expect(read).toHaveBeenCalledWith(file);
      expect(open).toHaveBeenCalled();
    });

    it('the strap carries Import pack and New homebrew, and a drawn-disabled Check for updates with its reason', async () => {
      setup();
      await renderSettled();
      const config = TestBed.inject(ActionStrapService).config()!;
      expect(config.primary.map((a) => a.id)).toEqual(['import-pack', 'new-homebrew']);
      const check = config.secondary!.find((a) => a.id === 'check-updates')!;
      expect(check.disabled).toBe(true);
      expect(check.disabledReason).toBe('shell.strap.packs-check-none');
    });

    it('New homebrew opens the type chooser and goes to the chosen form', async () => {
      const { open } = setup();
      open.mockReturnValue({ closed: Promise.resolve('spell'), close: vi.fn() });
      await renderSettled();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      TestBed.inject(ActionStrapService)
        .config()!
        .primary.find((a) => a.id === 'new-homebrew')!
        .run();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(open).toHaveBeenCalledWith(HomebrewNewChooserComponent);
      expect(navigate).toHaveBeenCalledWith(['/packs/homebrew/new', 'spell']);
    });

    it('opens the trust dialog in the wide size', async () => {
      const preview = { pack: SAMPLE } as unknown as PackImportPreview;
      const { open } = setup({ read: vi.fn().mockResolvedValue(preview) });
      const { fixture, root } = await render();
      await selectFile(fixture, root, new File(['{}'], 'sample.hkpack'));
      expect((open.mock.calls[0][1] as { size: string }).size).toBe('wide');
    });

    it('shows the campaign that shares exactly this pack version as a chip', async () => {
      setup({
        content: [SAMPLE],
        campaigns: [
          { id: 'c1', name: 'The Emberfall Company', packs: { 'sample-content': '1.0.0' } },
          { id: 'c2', name: 'Salt Kings', packs: { 'sample-content': '0.9.0' } },
        ],
      });
      const { root } = await renderSettled();
      const row = root.querySelector('.packs-list__row[data-pack-key="sample-content@1.0.0"]')!;
      const chips = [...row.querySelectorAll('.packs-list__campaign')].map((c) =>
        c.textContent?.trim(),
      );
      expect(chips).toEqual(['Campaign: The Emberfall Company']);
    });

    it('lists the homebrew breakdown by type with locale-built parts', async () => {
      const entity = (type: string, n: number) =>
        ({ type, id: `${LOCAL_HOMEBREW}:${type}/e${n}`, name: `E${n}` }) as never;
      const homebrew = mkPack({
        id: LOCAL_HOMEBREW,
        name: 'My homebrew',
        entities: [entity('item', 1), entity('item', 2), entity('spell', 3)],
      });
      setup({ content: [homebrew] });
      const { root } = await renderSettled();
      const text = root.querySelector('.packs-list__breakdown')?.textContent?.trim();
      expect(text).toBe('3 entries: Spells 1 Items 2');
    });

    it('hints with the tooltip directive, never a native title, and the icon-only open link is named', async () => {
      setup({ content: [SAMPLE] });
      const { root } = await renderSettled();
      expect(root.querySelectorAll('.packs-list__row [title]')).toHaveLength(0);
      const open = root.querySelector<HTMLElement>(
        '.packs-list__row[data-pack-key="sample-content@1.0.0"] .packs-list__open',
      )!;
      expect(open.getAttribute('aria-label')).toBe('Open Sample content');
      const lock = root.querySelector<HTMLElement>('.packs-list__lock')!;
      expect(lock.getAttribute('tabindex')).toBe('0');
      lock.dispatchEvent(new Event('focus'));
      await renderSettled();
      expect(document.body.textContent).toContain(packsEn.list['core-lock-tip']);
    });
  });
});
