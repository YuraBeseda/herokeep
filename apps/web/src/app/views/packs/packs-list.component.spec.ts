import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkpackReader, type PackImportPreview } from '@shared/services/packs/hkpack-reader.service';
import {
  PackImportBadSchemaError,
  PackImportInvalidError,
  PackImportTooLargeError,
} from '@shared/services/packs/pack-import.errors';
import { PackStore } from '@shared/stores/pack.store';
import packsEn from '../../../assets/i18n/packs/en.json';
import { PackTrustDialogComponent } from './pack-trust-dialog.component';
import { PackUsageService } from './pack-usage.service';
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
  } = {},
) {
  const translationPacks = signal<Pack[]>([RU]);
  const removeTranslation = vi.fn((key: string) => {
    translationPacks.update((packs) => packs.filter((p) => `${p.id}@${p.version}` !== key));
    return Promise.resolve();
  });
  const read = options.read ?? vi.fn();
  const open = vi.fn(() => ({ closed: Promise.resolve(undefined), close: vi.fn() }));
  const show = vi.fn();
  const pinSets = vi.fn(() => Promise.resolve(options.storedPins ?? []));

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
      { provide: PackUsageService, useValue: { pinSets } },
    ],
  });

  return { read, open, show, removeTranslation, pinSets };
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
      .querySelector<HTMLElement>('[data-pack-key="srd-5e-2024-ru-sample@0.1.0"] .hk-chip__remove')!
      .click();
    await fixture.whenStable();

    expect(removeTranslation).toHaveBeenCalledWith('srd-5e-2024-ru-sample@0.1.0');
    expect(root.querySelector('[data-pack-key="srd-5e-2024-ru-sample@0.1.0"]')).toBeNull();
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
    expect(open).toHaveBeenCalledWith(PackTrustDialogComponent, { data: preview });
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
      root.querySelector(`a[href="/packs/${key}"] .packs-list__update`);

    it('marks the newest installed version when a stored character pins an older one', async () => {
      const { pinSets } = setup({
        content: [SAMPLE, SAMPLE_11],
        storedPins: [{ [CORE.id]: CORE.version, [SAMPLE.id]: '1.0.0' }],
      });
      const { root } = await renderSettled();

      expect(pinSets).toHaveBeenCalled();
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
  });
});
