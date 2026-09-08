import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Diagnostic } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { ThemeService } from '@shared/services/theme/theme.service';
import { PackStore } from '@shared/stores/pack.store';
import settingsEn from '../../../assets/i18n/settings/en.json';
import settingsRu from '../../../assets/i18n/settings/ru.json';
import settingsUk from '../../../assets/i18n/settings/uk.json';
import { SettingsComponent } from './settings.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'settings/en') return of(settingsEn);
    if (langPath === 'settings/ru') return of(settingsRu);
    if (langPath === 'settings/uk') return of(settingsUk);
    return of({});
  }
}

function demoPack(overrides: Partial<Pack> = {}): Pack {
  return {
    format: 1,
    id: 'srd-5e-2024-ru-sample',
    version: '0.1.0',
    kind: 'translation',
    name: 'RU sample',
    authors: [],
    dependencies: [],
    locale: 'ru',
    translates: { id: 'srd-5e-2024', range: '^0.1.0' },
    entities: [],
    overrides: [],
    assets: [],
    i18n: {},
    strings: { 'spell/fireball': { name: 'Огненный шар' } },
    ...overrides,
  };
}

interface StoreStub {
  translationPacks: () => Pack[];
  importTranslation: ReturnType<typeof vi.fn>;
  removeTranslation: ReturnType<typeof vi.fn>;
}

/** Configures the TestBed with real settings i18n + stubbed collaborators; returns the spies. */
function setup(options: {
  translationPacks?: Pack[];
  importTranslation?: ReturnType<typeof vi.fn>;
  loadDemoRu?: ReturnType<typeof vi.fn>;
  storage?: {
    supported?: boolean;
    estimate?: { usage?: number; quota?: number };
    persisted?: boolean;
  };
}) {
  const translationPacksState = signal<Pack[]>(options.translationPacks ?? []);
  const importTranslation =
    options.importTranslation ??
    vi.fn((pack: Pack): Promise<Diagnostic[] | null> => {
      translationPacksState.update((packs) => [...packs, pack]);
      return Promise.resolve(null);
    });
  const removeTranslation = vi.fn((key: string): Promise<void> => {
    translationPacksState.update((packs) => packs.filter((p) => `${p.id}@${p.version}` !== key));
    return Promise.resolve();
  });
  const storeStub: StoreStub = {
    translationPacks: translationPacksState,
    importTranslation,
    removeTranslation,
  };

  const loadDemoRu = options.loadDemoRu ?? vi.fn(() => Promise.resolve(demoPack()));
  const toastShow = vi.fn();
  const requestPersist = vi.fn(() => Promise.resolve(true));

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
      { provide: PackStore, useValue: storeStub },
      { provide: PackLoader, useValue: { loadDemoRu } },
      { provide: ToastService, useValue: { show: toastShow } },
      {
        provide: StoragePersistService,
        useValue: {
          supported: signal(options.storage?.supported ?? true),
          estimate: signal(options.storage?.estimate),
          persisted: signal(options.storage?.persisted),
          requestPersist,
        },
      },
    ],
  });

  return {
    translationPacksState,
    importTranslation,
    removeTranslation,
    loadDemoRu,
    toastShow,
    requestPersist,
  };
}

function chipByAttr(root: HTMLElement, attr: string, value: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${attr}="${value}"]`);
}

describe('SettingsComponent', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  it('clicking a language chip calls LocaleService.setLocale and marks it active', async () => {
    setup({});
    const fixture = TestBed.createComponent(SettingsComponent);
    const localeService = TestBed.inject(LocaleService);
    const setLocaleSpy = vi.spyOn(localeService, 'setLocale');
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const ruChip = chipByAttr(compiled, 'data-locale', 'ru');
    expect(ruChip).toBeTruthy();
    expect(ruChip?.getAttribute('aria-pressed')).toBe('false');

    ruChip!.click();
    await fixture.whenStable();

    expect(setLocaleSpy).toHaveBeenCalledWith('ru');
    expect(localeService.locale()).toBe('ru');
    expect(chipByAttr(compiled, 'data-locale', 'ru')?.getAttribute('aria-pressed')).toBe('true');
    expect(chipByAttr(compiled, 'data-locale', 'en')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking a theme chip calls ThemeService.setTheme and marks it active', async () => {
    setup({});
    const fixture = TestBed.createComponent(SettingsComponent);
    const themeService = TestBed.inject(ThemeService);
    const setThemeSpy = vi.spyOn(themeService, 'setTheme');
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const lightChip = chipByAttr(compiled, 'data-theme-option', 'light');
    lightChip!.click();
    await fixture.whenStable();

    expect(setThemeSpy).toHaveBeenCalledWith('light');
    expect(themeService.theme()).toBe('light');
    expect(chipByAttr(compiled, 'data-theme-option', 'light')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('import-demo happy path adds a translation pack row and toasts success', async () => {
    const { toastShow, translationPacksState } = setup({});
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.settings__pack-chip').length).toBe(0);

    const importButton = compiled.querySelector<HTMLButtonElement>('.settings__import-button');
    importButton!.click();
    await fixture.whenStable();

    expect(toastShow).toHaveBeenCalledWith('settings.packs.import-success');
    expect(translationPacksState()).toHaveLength(1);
    expect(compiled.querySelectorAll('.settings__pack-chip').length).toBe(1);
    expect(chipByAttr(compiled, 'data-pack-key', 'srd-5e-2024-ru-sample@0.1.0')).toBeTruthy();
  });

  it('a pack failing validation toasts the diagnostic and does not add a row', async () => {
    const importTranslation = vi.fn((): Promise<Diagnostic[] | null> =>
      Promise.resolve([
        { severity: 'error', code: 'pack.corrupted', path: 'strings', message: 'corrupted' },
      ]),
    );
    const { toastShow, translationPacksState } = setup({ importTranslation });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const importButton = compiled.querySelector<HTMLButtonElement>('.settings__import-button');
    importButton!.click();
    await fixture.whenStable();

    expect(toastShow).toHaveBeenCalledWith('settings.packs.import-invalid');
    expect(translationPacksState()).toHaveLength(0);
    expect(compiled.querySelectorAll('.settings__pack-chip').length).toBe(0);
  });

  it('a fetch failure while importing also toasts invalid, with no unhandled rejection', async () => {
    const loadDemoRu = vi.fn(() => Promise.reject(new Error('network down')));
    const { toastShow, translationPacksState } = setup({ loadDemoRu });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const importButton = compiled.querySelector<HTMLButtonElement>('.settings__import-button');
    importButton!.click();
    await fixture.whenStable();

    expect(toastShow).toHaveBeenCalledWith('settings.packs.import-invalid');
    expect(translationPacksState()).toHaveLength(0);
  });

  it('removing an installed translation pack calls PackStore.removeTranslation', async () => {
    const { removeTranslation, translationPacksState } = setup({
      translationPacks: [demoPack()],
    });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const removeButton = compiled.querySelector<HTMLButtonElement>(
      '.settings__pack-chip .hk-chip__remove',
    );
    expect(removeButton).toBeTruthy();
    removeButton!.click();
    await fixture.whenStable();

    expect(removeTranslation).toHaveBeenCalledWith('srd-5e-2024-ru-sample@0.1.0');
    expect(translationPacksState()).toHaveLength(0);
  });

  it('renders the core pack row from PACK_ID/PACK_VERSION', async () => {
    setup({});
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.settings__pack-id')?.textContent?.trim()).toBe(
      'srd-5e-2024@0.1.0',
    );
  });

  it('storage section renders used/quota from a stubbed StoragePersistService', async () => {
    setup({ storage: { supported: true, estimate: { usage: 1_048_576, quota: 104_857_600 } } });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const usageText = compiled.querySelector('.settings__storage-usage')?.textContent ?? '';
    expect(usageText).toContain('1');
    expect(usageText).toContain('100');
    expect(compiled.querySelector('.settings__persist-button')).toBeTruthy();
  });

  it('the persist button requests persistence, and a granted persist swaps in the persisted label', async () => {
    const { requestPersist } = setup({ storage: { supported: true, persisted: false } });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const persistButton = compiled.querySelector<HTMLButtonElement>('.settings__persist-button');
    expect(persistButton).toBeTruthy();

    persistButton!.click();
    await fixture.whenStable();

    expect(requestPersist).toHaveBeenCalled();
  });

  it('hides the persist affordance gracefully when the Storage Manager API is unsupported', async () => {
    setup({ storage: { supported: false } });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.settings__persist-button')).toBeNull();
    expect(compiled.querySelector('.settings__storage-usage')).toBeNull();
  });
});
