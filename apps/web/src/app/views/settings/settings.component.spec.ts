import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ATTRIBUTION } from '@hk/content/attribution';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import type { Diagnostic } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { AuthService, type AuthStatus, type AuthUser } from '@shared/services/auth/auth.service';
import { ExportAllHeroesService } from '@shared/services/export/export-all-heroes.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { PackUsageService } from '@app/views/packs/pack-usage.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { putBlob } from '@shared/services/blob-transfer/testing/blob-cache-fixtures';
import { HkDb, type CharacterRow } from '@shared/services/storage/dexie.db';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import type { QuotaInfo } from '@shared/services/sync/stream-sync-session';
import { SyncService } from '@shared/services/sync/sync.service';
import { DisplayPrefsService } from '@shared/services/theme/display-prefs.service';
import { ThemeService } from '@shared/services/theme/theme.service';
import { PackStore } from '@shared/stores/pack.store';
import settingsEn from '../../../assets/i18n/settings/en.json';
import settingsRu from '../../../assets/i18n/settings/ru.json';
import settingsUk from '../../../assets/i18n/settings/uk.json';
import authors from '../../../assets/icons/authors.json';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';
import { TopBarService } from '../../ui/shell/top-bar.service';
import { hintOf, press } from '../../ui/testing/harness';
import { overlayRoot } from '../../ui/testing/overlay';
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

function contentPack(version: string, assetSizes: number[] = []): Pack {
  return {
    format: 1,
    id: 'sample-content',
    version,
    kind: 'content',
    name: 'Sample content',
    authors: [],
    dependencies: [],
    entities: [],
    overrides: [],
    assets: assetSizes.map((size, i) => ({ hash: `sha256:${i}`, size })),
    i18n: {},
  } as unknown as Pack;
}

interface StoreStub {
  translationPacks: () => Pack[];
  corePack: () => Pack | undefined;
  installedContent: () => Pack[];
  importTranslation: ReturnType<typeof vi.fn>;
  removeTranslation: ReturnType<typeof vi.fn>;
}

function mkRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'char:00000000-0000-4000-8000-000000000001',
    name: 'Aria',
    system: 'srd-5e-2024',
    archived: false,
    updatedAt: 1000,
    ...overrides,
  };
}

function mkQuota(overrides: Partial<QuotaInfo> = {}): QuotaInfo {
  return { bytesUsed: 1024, bytesMax: 1024 * 1024, eventCount: 5, ...overrides };
}

/** Configures the TestBed with real settings i18n, a stubbed `AuthService`/`SyncService` (this
 * spec asserts the component reads their signals and calls their methods; their own internals are
 * covered by `auth.service.spec.ts`/`sync.service.spec.ts`) and the collaborators the old spec
 * already stubbed. `HkDb`, `LocaleService`, `ThemeService`, `DisplayPrefsService`,
 * `CacheManagerService` and `ActionStrapService` stay REAL: the specs below assert what they do. */
async function setup(options: {
  translationPacks?: Pack[];
  contentPacks?: Pack[];
  heroPins?: { id: string; name: string; system: string; pins: Record<string, string> }[];
  importTranslation?: ReturnType<typeof vi.fn>;
  loadDemoRu?: ReturnType<typeof vi.fn>;
  storage?: {
    supported?: boolean;
    estimate?: { usage?: number; quota?: number };
    persisted?: boolean;
  };
  authStatus?: AuthStatus;
  authUser?: AuthUser | null;
  quota?: Record<string, QuotaInfo | null>;
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
    corePack: () => undefined,
    installedContent: () => options.contentPacks ?? [],
    importTranslation,
    removeTranslation,
  };

  const loadDemoRu = options.loadDemoRu ?? vi.fn(() => Promise.resolve(demoPack()));
  const toastShow = vi.fn();
  const requestPersist = vi.fn(() => Promise.resolve(true));
  const exportAll = vi.fn(() => Promise.resolve());

  const authStatusState = signal<AuthStatus>(options.authStatus ?? 'anon');
  const authUserState = signal<AuthUser | null>(options.authUser ?? null);
  const logout = vi.fn(() => Promise.resolve());
  const logoutAll = vi.fn(() => Promise.resolve());

  const quotaSignals = new Map<string, ReturnType<typeof signal<QuotaInfo | null>>>();
  const quotaFor = vi.fn((streamId: string) => {
    let sig = quotaSignals.get(streamId);
    if (!sig) {
      sig = signal<QuotaInfo | null>(options.quota?.[streamId] ?? null);
      quotaSignals.set(streamId, sig);
    }
    return sig;
  });

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
      { provide: PackStore, useValue: storeStub },
      { provide: PackLoader, useValue: { loadDemoRu } },
      { provide: ToastService, useValue: { show: toastShow } },
      {
        provide: PackUsageService,
        useValue: { heroPins: () => Promise.resolve(options.heroPins ?? []) },
      },
      { provide: ExportAllHeroesService, useValue: { run: exportAll, exporting: signal(false) } },
      {
        provide: StoragePersistService,
        useValue: {
          supported: signal(options.storage?.supported ?? true),
          estimate: signal(options.storage?.estimate),
          persisted: signal(options.storage?.persisted),
          requestPersist,
        },
      },
      {
        provide: AuthService,
        useValue: {
          status: authStatusState.asReadonly(),
          user: authUserState.asReadonly(),
          logout,
          logoutAll,
        },
      },
      { provide: SyncService, useValue: { quotaFor } },
    ],
  });

  // Fake-indexeddb persists `HkDb` data across `it()` blocks within this spec FILE, so every test
  // starts from clean tables (the Quota rows read `CharactersRepository.list()`; the cache cap and
  // sweep stamp live in `settings`).
  const db = TestBed.inject(HkDb);
  await Promise.all([
    db.characters.clear(),
    db.settings.clear(),
    db.blobs.clear(),
    db.campaigns.clear(),
    db.events.clear(),
    db.snapshots.clear(),
  ]);

  return {
    translationPacksState,
    importTranslation,
    removeTranslation,
    loadDemoRu,
    toastShow,
    requestPersist,
    exportAll,
    authStatusState,
    authUserState,
    logout,
    logoutAll,
    quotaSignals,
    quotaFor,
  };
}

/** Waits a couple of real macrotask turns then `whenStable()`: the Devices `resource()` loader runs
 * a real (stubbed-`fetch`) round trip that zoneless stability tracking alone doesn't wait out. */
async function flushAsync(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noBodyResponse(status: number): Response {
  return new Response(null, { status });
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function routedFetch(routes: Record<string, Handler>): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input);
    const key = Object.keys(routes).find((k) =>
      k.endsWith('*') ? url.startsWith(k.slice(0, -1)) : url === k,
    );
    if (!key) throw new Error(`routedFetch: no handler declared for ${url}`);
    return routes[key](init);
  });
}

/** Picks `value` in a native `<select>` the way a person does: set it, fire `change`. */
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T | null =>
  root.querySelector<T>(selector);

async function mountSettings() {
  const fixture = TestBed.createComponent(SettingsComponent);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('SettingsComponent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.removeItem('hk.locale');
    localStorage.removeItem('hk.theme');
    localStorage.removeItem('hk.density');
    localStorage.removeItem('hk.motion');
    // Devices GET is a REAL `apiJson` call under a stubbed `fetch`, matching `auth.service.spec.ts`'s
    // own convention — a route not declared per-test defaults to a harmless empty-list GET.
    globalThis.fetch = routedFetch({
      '/api/me/sessions': () => jsonResponse(200, []),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ['hk.locale', 'hk.theme', 'hk.density', 'hk.motion'].forEach((key) =>
      localStorage.removeItem(key),
    );
    document.documentElement.removeAttribute('data-density');
    document.documentElement.removeAttribute('data-motion');
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  // --- Index and sections (board ST01) ----------------------------------------------------------

  describe('Index and sections', () => {
    it('lists the five sections in the left index, each linking to a section that exists', async () => {
      await setup({});
      const { el } = await mountSettings();

      const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.settings__index a'));
      expect(links.map((a) => a.dataset['section'])).toEqual([
        'account',
        'appearance',
        'storage',
        'packs',
        'about',
      ]);
      for (const link of links) {
        const id = link.dataset['section']!;
        expect(link.getAttribute('href')).toContain(`#${id}`);
        expect(el.querySelector(`#${id}`)).not.toBeNull();
      }
      expect(links.map((a) => a.textContent?.trim())).toEqual([
        settingsEn.index.account,
        settingsEn.index.appearance,
        settingsEn.index.storage,
        settingsEn.index.packs,
        settingsEn.index.about,
      ]);
      expect(q(el, '.settings__title')?.textContent?.trim()).toBe(settingsEn.title);
    });

    it('marks the first section current until a fragment names another', async () => {
      await setup({});
      const { el } = await mountSettings();

      const current = Array.from(el.querySelectorAll('.settings__index a[aria-current]'));
      expect(current.map((a) => (a as HTMLElement).dataset['section'])).toEqual(['account']);
    });
  });

  // --- Appearance (theme, density, motion, language) ---------------------------------------------

  describe('Appearance', () => {
    it('shows three theme cards as a radio group and marks the stored theme', async () => {
      await setup({});
      const { el } = await mountSettings();

      const group = q(el, '.settings__themes');
      expect(group?.getAttribute('role')).toBe('radiogroup');
      const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-theme-option]'));
      expect(cards.map((c) => c.dataset['themeOption'])).toEqual(['tavern', 'scroll', 'plain']);
      expect(cards.map((c) => c.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
      expect(cards.map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
      // The hint under each name is part of the card (and its accessible name).
      expect(cards[1]?.textContent).toContain(settingsEn.appearance['hint-scroll']);
    });

    it('clicking a theme card calls ThemeService.setTheme, stamps <html> and marks it checked', async () => {
      await setup({});
      const { fixture, el } = await mountSettings();
      const themeService = TestBed.inject(ThemeService);
      const setThemeSpy = vi.spyOn(themeService, 'setTheme');

      press(q(el, '[data-theme-option="scroll"]')!);
      await fixture.whenStable();
      TestBed.tick();

      expect(setThemeSpy).toHaveBeenCalledWith('scroll');
      expect(themeService.theme()).toBe('scroll');
      expect(document.documentElement.getAttribute('data-theme')).toBe('scroll');
      expect(localStorage.getItem('hk.theme')).toBe('scroll');
      expect(q(el, '[data-theme-option="scroll"]')?.getAttribute('aria-checked')).toBe('true');
      expect(q(el, '[data-theme-option="tavern"]')?.getAttribute('aria-checked')).toBe('false');
    });

    it('arrow keys move the theme and density selection like a native radio group, wrapping', async () => {
      await setup({});
      const { fixture, el } = await mountSettings();
      const themeService = TestBed.inject(ThemeService);
      const prefs = TestBed.inject(DisplayPrefsService);
      const arrow = (target: Element, key: string) =>
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );

      arrow(q(el, '[data-theme-option="tavern"]')!, 'ArrowRight');
      await fixture.whenStable();
      expect(themeService.theme()).toBe('scroll');

      arrow(q(el, '[data-theme-option="scroll"]')!, 'ArrowLeft');
      arrow(q(el, '[data-theme-option="tavern"]')!, 'ArrowLeft');
      await fixture.whenStable();
      expect(themeService.theme()).toBe('plain');

      arrow(q(el, '[data-density="compact"]')!, 'ArrowDown');
      await fixture.whenStable();
      expect(prefs.density()).toBe('comfortable');
      arrow(q(el, '[data-density="comfortable"]')!, 'ArrowRight');
      await fixture.whenStable();
      expect(prefs.density()).toBe('compact');

      // The selected option is the group's one tab stop.
      expect(q(el, '[data-density="compact"]')!.getAttribute('tabindex')).toBe('0');
      expect(q(el, '[data-density="comfortable"]')!.getAttribute('tabindex')).toBe('-1');
    });

    it('density is a two-way choice that DisplayPrefsService persists and stamps', async () => {
      await setup({});
      const { fixture, el } = await mountSettings();
      const prefs = TestBed.inject(DisplayPrefsService);

      const radios = Array.from(
        el.querySelectorAll<HTMLElement>('.settings__density [role="radio"]'),
      );
      expect(radios.map((r) => r.dataset['density'])).toEqual(['compact', 'comfortable']);
      expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);

      press(radios[1]);
      await fixture.whenStable();
      TestBed.tick();

      expect(prefs.density()).toBe('comfortable');
      expect(localStorage.getItem('hk.density')).toBe('comfortable');
      expect(document.documentElement.getAttribute('data-density')).toBe('comfortable');
      expect(radios[1].getAttribute('aria-checked')).toBe('true');
      expect(radios[0].getAttribute('aria-checked')).toBe('false');
    });

    it('motion is a switch that DisplayPrefsService persists and stamps', async () => {
      await setup({});
      const { fixture, el } = await mountSettings();
      const prefs = TestBed.inject(DisplayPrefsService);

      const toggle = q(el, '.settings__motion [role="switch"]')!;
      expect(toggle.getAttribute('aria-checked')).toBe('true');

      press(toggle);
      await fixture.whenStable();
      TestBed.tick();

      expect(prefs.motion()).toBe(false);
      expect(localStorage.getItem('hk.motion')).toBe('off');
      expect(document.documentElement.getAttribute('data-motion')).toBe('off');
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    it('choosing a language calls LocaleService.setLocale and shows it selected', async () => {
      await setup({});
      const { fixture, el } = await mountSettings();
      const localeService = TestBed.inject(LocaleService);
      const setLocaleSpy = vi.spyOn(localeService, 'setLocale');

      const select = q<HTMLSelectElement>(el, '.settings__language select')!;
      expect(Array.from(select.options).map((o) => [o.value, o.textContent?.trim()])).toEqual([
        ['en', 'English'],
        ['ru', 'Русский'],
        ['uk', 'Українська'],
      ]);
      expect(select.value).toBe('en');

      choose(select, 'ru');
      await fixture.whenStable();

      expect(setLocaleSpy).toHaveBeenCalledWith('ru');
      expect(localeService.locale()).toBe('ru');
      expect(select.value).toBe('ru');
    });
  });

  // --- Content packs ------------------------------------------------------------------------------

  it('import-demo happy path adds a translation pack row and toasts success', async () => {
    const { toastShow, translationPacksState } = await setup({});
    const { fixture, el } = await mountSettings();
    expect(el.querySelectorAll('.settings__pack-chip').length).toBe(0);

    q<HTMLButtonElement>(el, '.settings__import-button')!.click();
    await fixture.whenStable();

    expect(toastShow).toHaveBeenCalledWith('settings.packs.import-success');
    expect(translationPacksState()).toHaveLength(1);
    expect(el.querySelectorAll('.settings__pack-chip').length).toBe(1);
    expect(q(el, '[data-pack-key="srd-5e-2024-ru-sample@0.1.0"]')).toBeTruthy();
  });

  it('a pack failing validation toasts the diagnostic and does not add a row', async () => {
    const importTranslation = vi.fn((): Promise<Diagnostic[] | null> =>
      Promise.resolve([
        { severity: 'error', code: 'pack.corrupted', path: 'strings', message: 'corrupted' },
      ]),
    );
    const { toastShow, translationPacksState } = await setup({ importTranslation });
    const { fixture, el } = await mountSettings();

    q<HTMLButtonElement>(el, '.settings__import-button')!.click();
    await fixture.whenStable();

    expect(toastShow).toHaveBeenCalledWith('settings.packs.import-invalid');
    expect(translationPacksState()).toHaveLength(0);
    expect(el.querySelectorAll('.settings__pack-chip').length).toBe(0);
  });

  it('a fetch failure while importing also toasts invalid, with no unhandled rejection', async () => {
    const loadDemoRu = vi.fn(() => Promise.reject(new Error('network down')));
    const { toastShow, translationPacksState } = await setup({ loadDemoRu });
    const { fixture, el } = await mountSettings();

    q<HTMLButtonElement>(el, '.settings__import-button')!.click();
    await fixture.whenStable();

    expect(toastShow).toHaveBeenCalledWith('settings.packs.import-invalid');
    expect(translationPacksState()).toHaveLength(0);
  });

  it('removing an installed translation pack calls PackStore.removeTranslation', async () => {
    const { removeTranslation, translationPacksState } = await setup({
      translationPacks: [demoPack()],
    });
    const { fixture, el } = await mountSettings();

    const removeButton = q<HTMLButtonElement>(el, '.settings__pack-chip button')!;
    expect(removeButton).toBeTruthy();
    // Icon-only: its name is the remove label plus the pack it removes.
    expect(removeButton.getAttribute('aria-label')).toContain(settingsEn.packs.remove);
    removeButton.click();
    await fixture.whenStable();

    expect(removeTranslation).toHaveBeenCalledWith('srd-5e-2024-ru-sample@0.1.0');
    expect(translationPacksState()).toHaveLength(0);
  });

  it('renders the core pack row: its name and a version plate, keyed by PACK_ID@PACK_VERSION', async () => {
    await setup({});
    const { el } = await mountSettings();

    const row = q(el, '.settings__core-pack')!;
    expect(row.getAttribute('data-pack-key')).toBe(`${PACK_ID}@${PACK_VERSION}`);
    expect(row.textContent).toContain(settingsEn.packs['core-label']);
    expect(q(row, '.settings__pack-id')?.textContent?.trim()).toBe(PACK_VERSION);
  });

  it('counts the installed content packs, plural-aware, and flags a pending update', async () => {
    await setup({
      contentPacks: [contentPack('1.1.0')],
      heroPins: [
        { id: 'char:a', name: 'Aria', system: 'srd-5e-2024', pins: { 'sample-content': '1.0.0' } },
      ],
    });
    const { fixture, el } = await mountSettings();
    await flushAsync(fixture);

    expect(q(el, '.settings__pack-count')?.textContent?.trim()).toBe('1 content pack installed');
    const chip = q(el, '.settings__pack-updates')!;
    expect(chip.textContent).toContain('1');
  });

  it('the core pack row is focusable, so its hint reaches keyboard and touch', async () => {
    await setup({});
    const { el } = await mountSettings();

    const row = q(el, '.settings__core-pack')!;
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(hintOf(row)).toBe(settingsEn.packs['core-tip']);
  });

  it('shows no update chip when no hero pins an older version', async () => {
    await setup({
      contentPacks: [contentPack('1.0.0')],
      heroPins: [
        { id: 'char:a', name: 'Aria', system: 'srd-5e-2024', pins: { 'sample-content': '1.0.0' } },
      ],
    });
    const { fixture, el } = await mountSettings();
    await flushAsync(fixture);

    expect(q(el, '.settings__pack-updates')).toBeNull();
  });

  it('the Content packs section links to /packs and to the homebrew list', async () => {
    await setup({});
    const { el } = await mountSettings();

    const link = q<HTMLAnchorElement>(el, 'a.settings__manage-packs');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/packs');
    expect(link!.textContent?.trim()).toBe(settingsEn.packs.open);

    const homebrew = q<HTMLAnchorElement>(el, 'a.settings__homebrew');
    expect(homebrew?.getAttribute('href')).toBe('/packs/homebrew');
    expect(homebrew?.textContent?.trim()).toBe(settingsEn.packs.homebrew);
  });

  // --- Storage --------------------------------------------------------------------------------------

  it('storage section renders used/quota from a stubbed StoragePersistService', async () => {
    await setup({
      storage: { supported: true, estimate: { usage: 1_048_576, quota: 104_857_600 } },
    });
    const { el } = await mountSettings();

    const usageText = q(el, '.settings__storage-usage')?.textContent ?? '';
    expect(usageText).toContain('1');
    expect(usageText).toContain('100');
    expect(q(el, '.settings__persist-button')).toBeTruthy();
    // One bar with the used share, announced as a meter.
    const bar = q(el, '.settings__storage-bar')!;
    expect(bar.getAttribute('role')).toBe('meter');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('the persist button is explained, requests persistence, and a granted persist shows a chip', async () => {
    const { requestPersist } = await setup({ storage: { supported: true, persisted: false } });
    const { fixture, el } = await mountSettings();

    expect(q(el, '.settings__persist-note')?.textContent?.trim()).toBe(
      settingsEn.storage['persist-note'],
    );
    const persistButton = q<HTMLButtonElement>(el, '.settings__persist-button');
    expect(persistButton).toBeTruthy();
    expect(q(el, '.settings__persisted')).toBeNull();

    persistButton!.click();
    await fixture.whenStable();

    expect(requestPersist).toHaveBeenCalled();
  });

  it('shows "granted" in place of the button once persistence is granted', async () => {
    await setup({ storage: { supported: true, persisted: true } });
    const { el } = await mountSettings();

    expect(q(el, '.settings__persist-button')).toBeNull();
    expect(q(el, '.settings__persisted')?.textContent).toContain(settingsEn.storage.granted);
  });

  it('hides the persist affordance gracefully when the Storage Manager API is unsupported', async () => {
    await setup({ storage: { supported: false } });
    const { el } = await mountSettings();

    expect(q(el, '.settings__persist-button')).toBeNull();
    expect(q(el, '.settings__storage-usage')).toBeNull();
  });

  describe('Storage breakdown and the cache line (S4 notes: one storage line)', () => {
    const MB = 1024 * 1024;

    it('splits the device usage into cached images, installed packs and the rest', async () => {
      await setup({
        storage: { supported: true, estimate: { usage: 10 * MB, quota: 100 * MB } },
        contentPacks: [contentPack('1.0.0', [MB, MB])],
      });
      await putBlob('peer-image', MB, false, undefined, 'peer');
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const text = (segment: string) =>
        q(el, `.settings__storage-breakdown [data-segment="${segment}"]`)?.textContent ?? '';
      expect(text('images')).toContain('1 MB');
      expect(text('packs')).toContain('2 MB');
      expect(text('other')).toContain('7 MB');
      expect(el.querySelectorAll('.settings__storage-bar [data-segment]').length).toBe(3);
    });

    it('never lets "other" go negative when the parts outweigh the estimate', async () => {
      await setup({
        storage: { supported: true, estimate: { usage: MB, quota: 100 * MB } },
        contentPacks: [contentPack('1.0.0', [5 * MB])],
      });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      expect(q(el, '.settings__storage-breakdown [data-segment="other"]')?.textContent).toContain(
        '0 B',
      );
    });

    it('the cache line shows the cache’s own bytes, not the device estimate again', async () => {
      await setup({
        storage: { supported: true, estimate: { usage: 50 * MB, quota: 100 * MB } },
      });
      await putBlob('peer-image', 3 * MB, false, undefined, 'peer');
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const line = q(el, '.settings__cache-usage')?.textContent ?? '';
      expect(line).toContain('3 MB');
      expect(line).not.toContain('50');
      expect(line).not.toContain('100');
    });

    it('re-measures the cache after the limit changes', async () => {
      await setup({});
      await putBlob('peer-a', 150 * MB, false, 1, 'peer');
      await putBlob('peer-b', 150 * MB, false, 2, 'peer');
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);
      expect(q(el, '.settings__cache-usage')?.textContent).toContain('300 MB');

      choose(q<HTMLSelectElement>(el, '.settings__cache-select select')!, '100');
      await new Promise((resolve) => setTimeout(resolve, 100));
      await flushAsync(fixture);

      expect(q(el, '.settings__cache-usage')?.textContent).not.toContain('300 MB');
    });
  });

  describe('Blob cache limit', () => {
    it('is a labelled select defaulting to 500 MB, spanning the 100 MB to 2 GB range', async () => {
      await setup({});
      const { fixture, el } = await mountSettings();
      // `CacheManagerService.ready` settles asynchronously — give it a turn.
      await flushAsync(fixture);

      const select = q<HTMLSelectElement>(el, '.settings__cache-select select')!;
      expect(select).toBeTruthy();
      const values = Array.from(select.options).map((o) => Number(o.value));
      expect(values[0]).toBe(100);
      expect(values[values.length - 1]).toBe(2048); // 2 GB = 2048 MB (binary), not a round 2000
      expect(select.value).toBe('500');
      const label = q(el, '.settings__cache-select label')!;
      expect(label.getAttribute('for')).toBe(select.id);
    });

    it('choosing a limit persists the new cap via CacheManagerService', async () => {
      await setup({});
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      choose(q<HTMLSelectElement>(el, '.settings__cache-select select')!, '1000');
      await flushAsync(fixture);

      const capBytes = await TestBed.inject(SettingsRepository).get<number>('blobCacheCapBytes');
      expect(capBytes).toBe(1000 * 1024 * 1024);
    });

    it('keeps a cap stored by the old slider (750 MB) selectable instead of showing a wrong value', async () => {
      await setup({});
      await TestBed.inject(SettingsRepository).set('blobCacheCapBytes', 750 * 1024 * 1024);
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const select = q<HTMLSelectElement>(el, '.settings__cache-select select')!;
      expect(select.value).toBe('750');
    });
  });

  // --- About & licences (folded in from the former /about screen) -------------------------------

  describe('About & licences', () => {
    it('renders the SRD attribution EXACTLY as imported from @hk/content/attribution — not a copy', async () => {
      await setup({});
      const { el } = await mountSettings();

      const text = q(el, '.settings__srd-attribution')?.textContent?.trim();

      expect(ATTRIBUTION.length).toBeGreaterThan(50); // guards against a hollowed-out fixture
      expect(text).toBe(ATTRIBUTION);
    });

    it('the game-icons credit line contains a humanized author from the real authors.json', async () => {
      await setup({});
      const { el } = await mountSettings();

      const text = q(el, '.settings__icons-credit')?.textContent ?? '';

      expect((authors as readonly string[]).length).toBeGreaterThan(0);
      const [firstSlug] = authors as readonly string[];
      const humanized = firstSlug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      expect(text).toContain(humanized);
      expect(text).toContain('https://game-icons.net');
      expect(text).toContain('CC BY 3.0');
    });

    it('lists every icon author from authors.json, not only the first', async () => {
      await setup({});
      const { el } = await mountSettings();

      const text = q(el, '.settings__icons-credit')?.textContent ?? '';
      for (const slug of authors as readonly string[]) {
        const humanized = slug
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        expect(text).toContain(humanized);
      }
    });

    it('renders the open5e credit line verbatim', async () => {
      await setup({});
      const { el } = await mountSettings();

      // The legal-attribution.md "Third-party assets" table's open5e row, copied verbatim.
      expect(q(el, '.settings__open5e-credit')?.textContent?.trim()).toBe(
        'Structured SRD data derived from the Open5e project (https://open5e.com).',
      );
    });

    it('labels the date "Released", not "Built", since it is a hand-bumped release date', async () => {
      await setup({});
      const { el } = await mountSettings();

      const labels = Array.from(el.querySelectorAll('.settings__kv dt')).map((n) =>
        n.textContent?.trim(),
      );
      expect(labels).toContain(settingsEn.about.released);
      expect(labels).not.toContain('Built');
    });

    it('draws the release-notes link disabled, with its reason', async () => {
      await setup({});
      const { el } = await mountSettings();

      const link = q(el, '.settings__release-notes')!;
      expect(link.getAttribute('aria-disabled')).toBe('true');
      expect(hintOf(link)).toBe(settingsEn.about['release-notes-reason']);
    });

    it('credits the fonts', async () => {
      await setup({});
      const { el } = await mountSettings();

      const text = q(el, '.settings__fonts-credit')?.textContent ?? '';
      expect(text).toContain('Forum');
      expect(text).toContain('Alegreya');
    });

    it('shows the app name and version on a plate', async () => {
      await setup({});
      const { el } = await mountSettings();

      expect(q(el, '.settings__about-plate')?.textContent?.trim()).toBe('Herokeep 0.1.0');
    });

    it('dates the build through the locale, as a hint on the plate', async () => {
      await setup({});
      const { el } = await mountSettings();

      const built = q(el, '.settings__about-built')?.textContent ?? '';
      expect(built).toContain('2026');
    });
  });

  // --- Account ---------------------------------------------------------------------------------------

  describe('Account section', () => {
    it('anon: shows a login prompt with Login/Register links, no username or logout buttons', async () => {
      await setup({ authStatus: 'anon' });
      const { el } = await mountSettings();

      expect(q(el, '.settings__account-prompt')).toBeTruthy();
      expect(q(el, '.settings__login-link')).toBeTruthy();
      expect(q(el, '.settings__register-link')).toBeTruthy();
      expect(q(el, '.settings__login-link')?.getAttribute('href')).toBe('/login');
      expect(q(el, '.settings__register-link')?.getAttribute('href')).toBe('/register');
      expect(q(el, '.settings__account-username')).toBeNull();
      expect(q(el, '.settings__logout')).toBeNull();
      expect(q(el, '.settings__logout-all')).toBeNull();
      // The signed-out inset says so, as a chip with a hint.
      expect(q(el, '.settings__account-state')?.textContent).toContain(
        settingsEn.account['state-anon'],
      );
    });

    it('authed: shows the username and never a regenerate-recovery-codes button (no server route)', async () => {
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'Aria' } });
      const { el } = await mountSettings();

      expect(q(el, '.settings__account-username')?.textContent?.trim()).toBe('Aria');
      expect(q(el, '.settings__logout')).toBeTruthy();
      expect(q(el, '.settings__logout-all')).toBeTruthy();
      expect(q(el, '.settings__account-prompt')).toBeNull();
      expect(q(el, '.settings__account-state')?.textContent).toContain(
        settingsEn.account['state-authed'],
      );
      // task-9-brief.md's explicit VERIFY result: the server never shipped a
      // regenerate-recovery-codes route — omitted here, never invented client-side.
      expect(q(el, '.settings__regenerate-codes')).toBeNull();
    });

    it('authed: says how many heroes sync from how many devices, plural-aware', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            { id: 's1', deviceLabel: 'Laptop', createdAt: 1, lastSeenAt: 1, current: true },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      await TestBed.inject(HkDb).characters.put(mkRow({ id: 'char:one', name: 'Solo' }));
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      expect(q(el, '.settings__account-summary')?.textContent?.trim()).toBe(
        '1 hero syncs to this account from 1 device.',
      );
    });

    it('authed: clicking Logout calls AuthService.logout', async () => {
      const { logout } = await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
      });
      const { fixture, el } = await mountSettings();

      q<HTMLButtonElement>(el, '.settings__logout')!.click();
      await fixture.whenStable();

      expect(logout).toHaveBeenCalled();
    });

    it('authed: Logout-everywhere opens a confirm dialog; confirming calls AuthService.logoutAll', async () => {
      const { logoutAll } = await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
      });
      const { fixture, el } = await mountSettings();

      q<HTMLButtonElement>(el, '.settings__logout-all')!.click();
      await fixture.whenStable();

      const confirmButton = q<HTMLButtonElement>(
        overlayRoot(),
        '.settings-logout-all-confirm__confirm',
      );
      expect(confirmButton).toBeTruthy();
      confirmButton!.click();
      await fixture.whenStable();

      expect(logoutAll).toHaveBeenCalled();
    });

    it('authed: cancelling the Logout-everywhere dialog never calls AuthService.logoutAll', async () => {
      const { logoutAll } = await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
      });
      const { fixture, el } = await mountSettings();

      q<HTMLButtonElement>(el, '.settings__logout-all')!.click();
      await fixture.whenStable();

      q<HTMLButtonElement>(overlayRoot(), '.settings-logout-all-confirm__cancel')!.click();
      await fixture.whenStable();

      expect(logoutAll).not.toHaveBeenCalled();
    });

    it('explains Log out everywhere in a hint, not a native title', async () => {
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { el } = await mountSettings();

      const button = q(el, '.settings__logout-all')!;
      expect(button.hasAttribute('title')).toBe(false);
      expect(hintOf(button)).toBe(settingsEn.account['logout-all-hint']);
    });
  });

  // --- Devices ----------------------------------------------------------------------------------------

  describe('Devices', () => {
    it('is absent when logged out', async () => {
      await setup({ authStatus: 'anon' });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      expect(q(el, '.settings__devices-list')).toBeNull();
      expect(q(el, '.settings__devices-error')).toBeNull();
    });

    it('renders rows from GET /api/me/sessions with the current-device marker', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            {
              id: 'sess-1',
              deviceLabel: 'Chrome on Windows',
              createdAt: 1000,
              lastSeenAt: 2000,
              current: true,
            },
            {
              id: 'sess-2',
              deviceLabel: 'Safari on iPhone',
              createdAt: 500,
              lastSeenAt: 500,
              current: false,
            },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const rows = el.querySelectorAll('.settings__devices-row');
      expect(rows.length).toBe(2);
      const currentRow = q(el, '.settings__devices-row[data-current="true"]');
      expect(currentRow?.textContent).toContain('Chrome on Windows');
      expect(currentRow?.querySelector('.settings__devices-current-tag')).toBeTruthy();
      // The current session's own row never offers a self-revoke button (see settings.component.ts).
      expect(currentRow?.querySelector('.settings__devices-revoke')).toBeNull();

      const otherRow = q(el, '.settings__devices-row[data-current="false"]');
      expect(otherRow?.querySelector('.settings__devices-revoke')).toBeTruthy();
    });

    it('shows when each device was last active and when it signed in, through the locale', async () => {
      const now = Date.now();
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            {
              id: 'sess-1',
              deviceLabel: 'Pixel 8',
              createdAt: now - 2 * 86_400_000,
              lastSeenAt: now - 2 * 3_600_000,
              current: false,
            },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const seen = q(el, '.settings__devices-seen')?.textContent ?? '';
      expect(seen).toContain('Last active');
      expect(seen).toContain('2 hours ago');
      expect(seen).toContain('signed in 2 days ago');
    });

    it('picks a phone, tablet or laptop glyph from the device name', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            {
              id: 's1',
              deviceLabel: 'Safari on iPhone',
              createdAt: 1,
              lastSeenAt: 1,
              current: false,
            },
            {
              id: 's2',
              deviceLabel: 'Safari on iPad',
              createdAt: 1,
              lastSeenAt: 1,
              current: false,
            },
            {
              id: 's3',
              deviceLabel: 'Chrome on Windows',
              createdAt: 1,
              lastSeenAt: 1,
              current: false,
            },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const glyphs = Array.from(
        el.querySelectorAll('.settings__devices-row .settings__iring use'),
      ).map((use) => use.getAttribute('href'));
      expect(glyphs).toEqual([
        'assets/icons/sprite.svg#ui-phone',
        'assets/icons/sprite.svg#ui-tablet',
        'assets/icons/sprite.svg#ui-laptop',
      ]);
    });

    it('revoke is an icon-free text button whose hint says the device signs out at once', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            { id: 'sess-1', deviceLabel: 'Chrome', createdAt: 1, lastSeenAt: 1, current: true },
            { id: 'sess-2', deviceLabel: 'Firefox', createdAt: 1, lastSeenAt: 1, current: false },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const revoke = q(el, '.settings__devices-revoke')!;
      expect(revoke.hasAttribute('title')).toBe(false);
      expect(hintOf(revoke)).toBe(settingsEn.devices['revoke-hint']);
    });

    it('shows a loading state while the fetch is in flight', async () => {
      let resolveFetch!: (res: Response) => void;
      globalThis.fetch = vi.fn<typeof fetch>(
        () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
      );
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const fixture = TestBed.createComponent(SettingsComponent);
      // Deliberately NOT `whenStable()` — the fetch never resolves until `resolveFetch` below, and
      // `whenStable()` waits for exactly that. `resource()`'s `isLoading` flips `true` at once.
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(q(el, '.settings__devices-loading')).toBeTruthy();

      resolveFetch(jsonResponse(200, []));
      await flushAsync(fixture);
      expect(q(el, '.settings__devices-loading')).toBeNull();
    });

    it('shows an error state (with retry) when the fetch fails, and retry re-fetches', async () => {
      let calls = 0;
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () => {
          calls++;
          if (calls === 1) throw new Error('network down');
          return jsonResponse(200, [
            { id: 'sess-1', deviceLabel: 'Chrome', createdAt: 1, lastSeenAt: 1, current: true },
          ]);
        },
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      expect(q(el, '.settings__devices-error')).toBeTruthy();

      const retryButton = q<HTMLButtonElement>(el, '.settings__devices-retry');
      expect(retryButton).toBeTruthy();
      retryButton!.click();
      await flushAsync(fixture);

      expect(q(el, '.settings__devices-error')).toBeNull();
      expect(el.querySelectorAll('.settings__devices-row').length).toBe(1);
    });

    it('revoke: confirming calls DELETE and removes the row', async () => {
      let devices = [
        { id: 'sess-1', deviceLabel: 'Chrome', createdAt: 1, lastSeenAt: 1, current: true },
        { id: 'sess-2', deviceLabel: 'Firefox', createdAt: 1, lastSeenAt: 1, current: false },
      ];
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () => jsonResponse(200, devices),
        '/api/me/sessions/sess-2': (init) => {
          expect(init?.method).toBe('DELETE');
          devices = devices.filter((d) => d.id !== 'sess-2');
          return noBodyResponse(204);
        },
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      expect(el.querySelectorAll('.settings__devices-row').length).toBe(2);

      q<HTMLButtonElement>(
        el,
        '.settings__devices-row[data-current="false"] .settings__devices-revoke',
      )!.click();
      await fixture.whenStable();

      const confirmButton = q<HTMLButtonElement>(
        overlayRoot(),
        '.settings-revoke-device-confirm__confirm',
      );
      expect(confirmButton).toBeTruthy();
      confirmButton!.click();
      await flushAsync(fixture);

      expect(el.querySelectorAll('.settings__devices-row').length).toBe(1);
    });

    it('revoke: cancelling the dialog leaves the row and never calls DELETE', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            { id: 'sess-1', deviceLabel: 'Chrome', createdAt: 1, lastSeenAt: 1, current: true },
            { id: 'sess-2', deviceLabel: 'Firefox', createdAt: 1, lastSeenAt: 1, current: false },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      q<HTMLButtonElement>(
        el,
        '.settings__devices-row[data-current="false"] .settings__devices-revoke',
      )!.click();
      await fixture.whenStable();

      q<HTMLButtonElement>(overlayRoot(), '.settings-revoke-device-confirm__cancel')!.click();
      await flushAsync(fixture);

      expect(el.querySelectorAll('.settings__devices-row').length).toBe(2);
    });

    it('revoke: a DELETE failure toasts and leaves the row in place', async () => {
      const { toastShow } = await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
      });
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            { id: 'sess-1', deviceLabel: 'Chrome', createdAt: 1, lastSeenAt: 1, current: true },
            { id: 'sess-2', deviceLabel: 'Firefox', createdAt: 1, lastSeenAt: 1, current: false },
          ]),
        '/api/me/sessions/sess-2': () => {
          throw new Error('network down');
        },
      });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      q<HTMLButtonElement>(
        el,
        '.settings__devices-row[data-current="false"] .settings__devices-revoke',
      )!.click();
      await fixture.whenStable();

      q<HTMLButtonElement>(overlayRoot(), '.settings-revoke-device-confirm__confirm')!.click();
      await flushAsync(fixture);

      expect(toastShow).toHaveBeenCalledWith('settings.devices.toast.revoke-failed');
      expect(el.querySelectorAll('.settings__devices-row').length).toBe(2);
    });

    // `DeviceRow.id` is `string | null` server-side (a pre-migration session row never got the
    // additive `0001` column) — a null-id row must never offer revoke (there is no
    // `DELETE /api/me/sessions/null`), and must still render distinctly from any other null-id row.
    it('a null-id row (pre-migration session) never offers revoke, and still renders', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            { id: 'sess-1', deviceLabel: 'Chrome', createdAt: 1, lastSeenAt: 1, current: true },
            { id: null, deviceLabel: 'Old device', createdAt: 2, lastSeenAt: 2, current: false },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      expect(el.querySelectorAll('.settings__devices-row').length).toBe(2);

      const nullIdRow = q(el, '.settings__devices-row[data-current="false"]');
      expect(nullIdRow?.textContent).toContain('Old device');
      expect(nullIdRow?.querySelector('.settings__devices-revoke')).toBeNull();
    });

    it('draws Revoke disabled in the current device’s slot and on an unknown session, with the reason', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            { id: 'sess-1', deviceLabel: 'Chrome', createdAt: 1, lastSeenAt: 1, current: true },
            { id: null, deviceLabel: 'Old device', createdAt: 2, lastSeenAt: 2, current: false },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const current = q(
        el,
        '.settings__devices-row[data-current="true"] .settings__devices-revoke-blocked',
      )!;
      expect(current.getAttribute('aria-disabled')).toBe('true');
      expect(hintOf(current)).toBe(settingsEn.devices['revoke-self']);
      const unknown = q(
        el,
        '.settings__devices-row[data-current="false"] .settings__devices-revoke-blocked',
      )!;
      expect(unknown.getAttribute('aria-disabled')).toBe('true');
      expect(hintOf(unknown)).toBe(settingsEn.devices['revoke-unknown']);
      // Neither can start a revoke.
      expect(el.querySelectorAll('.settings__devices-revoke').length).toBe(0);
      current.click();
      await fixture.whenStable();
      expect(overlayRoot().querySelector('.settings-revoke-device-confirm__title')).toBeNull();
    });

    it('two null-id rows both render distinctly (fallback track key, not identity collapse)', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            { id: null, deviceLabel: 'Old device A', createdAt: 1, lastSeenAt: 1, current: false },
            { id: null, deviceLabel: 'Old device B', createdAt: 2, lastSeenAt: 2, current: false },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const labels = Array.from(el.querySelectorAll('.settings__devices-label')).map((n) =>
        n.textContent?.trim(),
      );
      expect(labels).toEqual(['Old device A', 'Old device B']);
    });
  });

  // --- Account storage (quota) ---------------------------------------------------------------------

  describe('Account storage (quota)', () => {
    it('is absent when logged out', async () => {
      await setup({ authStatus: 'anon' });
      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      expect(q(el, '.settings__quota-list')).toBeNull();
      expect(q(el, '.settings__quota-bar')).toBeNull();
    });

    it('renders per-character rows with formatted used/max from seeded quota signals', async () => {
      const row = mkRow({ id: 'char:aaaa', name: 'Aria' });
      const { quotaSignals } = await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
        quota: { 'char:aaaa': mkQuota({ bytesUsed: 1024, bytesMax: 1024 * 1024 }) },
      });
      await TestBed.inject(HkDb).characters.put(row);

      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const quotaRow = q(el, '.settings__quota-row');
      expect(quotaRow?.querySelector('.settings__quota-name')?.textContent?.trim()).toBe('Aria');
      const usageText = quotaRow?.querySelector('.settings__quota-usage')?.textContent ?? '';
      expect(usageText).toContain('1');
      expect(quotaRow?.classList.contains('settings__quota-row--warning')).toBe(false);
      expect(quotaSignals.has('char:aaaa')).toBe(true);
    });

    it('draws one bar for the account total across the heroes that report quota', async () => {
      await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
        quota: {
          'char:aaaa': mkQuota({ bytesUsed: 1024 * 1024, bytesMax: 2 * 1024 * 1024 }),
          'char:bbbb': mkQuota({ bytesUsed: 1024 * 1024, bytesMax: 2 * 1024 * 1024 }),
        },
      });
      const db = TestBed.inject(HkDb);
      await db.characters.put(mkRow({ id: 'char:aaaa', name: 'Aria' }));
      await db.characters.put(mkRow({ id: 'char:bbbb', name: 'Borin', updatedAt: 2000 }));

      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const bar = q(el, '.settings__quota-bar')!;
      expect(bar.getAttribute('role')).toBe('meter');
      expect(bar.getAttribute('aria-valuenow')).toBe('50');
      expect(q(el, '.settings__quota-total')?.textContent).toContain('2 MB');
      expect(q(el, '.settings__quota-total')?.textContent).toContain('4 MB');
    });

    it('applies the warning style at >= 80% usage', async () => {
      const row = mkRow({ id: 'char:bbbb', name: 'Borin' });
      await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
        quota: { 'char:bbbb': mkQuota({ bytesUsed: 900, bytesMax: 1000 }) },
      });
      await TestBed.inject(HkDb).characters.put(row);

      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const quotaRow = q(el, '.settings__quota-row');
      expect(quotaRow?.classList.contains('settings__quota-row--warning')).toBe(true);
    });

    it('shows an unknown (em-dash) state for a character with no quota data yet', async () => {
      const row = mkRow({ id: 'char:cccc', name: 'Cora' });
      await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
        quota: {},
      });
      await TestBed.inject(HkDb).characters.put(row);

      const { fixture, el } = await mountSettings();
      await flushAsync(fixture);

      const quotaRow = q(el, '.settings__quota-row');
      expect(quotaRow?.querySelector('.settings__quota-usage--unknown')).toBeTruthy();
      expect(quotaRow?.textContent).toContain('—');
    });
  });

  // --- Action strap and phone top bar --------------------------------------------------------------

  describe('Action strap', () => {
    it('puts Manage packs first, Export all heroes and Help in zone 3', async () => {
      await setup({});
      await mountSettings();
      TestBed.tick();

      const config = TestBed.inject(ActionStrapService).config()!;
      expect(config.primary.map((a) => a.id)).toEqual(['manage-packs']);
      expect(config.secondary?.map((a) => a.id)).toEqual(['export-all', 'help']);
    });

    it('Export all heroes hands the picker description to the export service', async () => {
      const { exportAll } = await setup({});
      await TestBed.inject(HkDb).characters.put(mkRow({ id: 'char:one' }));
      const { fixture } = await mountSettings();
      await flushAsync(fixture);
      TestBed.tick();

      TestBed.inject(ActionStrapService)
        .config()!
        .secondary!.find((a) => a.id === 'export-all')!
        .run();

      expect(exportAll).toHaveBeenCalledWith(settingsEn.export.pickerDescription);
    });

    it('draws Export all heroes disabled, with its reason, while there is no hero to export', async () => {
      await setup({});
      const { fixture } = await mountSettings();
      await flushAsync(fixture);
      TestBed.tick();

      const action = TestBed.inject(ActionStrapService)
        .config()!
        .secondary!.find((a) => a.id === 'export-all')!;
      expect(action.disabled).toBe(true);
      expect(action.disabledReason).toBe('shell.strap.settings-export-none');
    });

    it('on a phone the top bar’s action jumps to the Account section', async () => {
      await setup({});
      await mountSettings();
      TestBed.tick();

      const action = TestBed.inject(TopBarService).config()?.action;
      expect(action?.id).toBe('account');
      expect(action?.label).toBe('shell.icon.account');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      action!.run();
      expect(navigate).toHaveBeenCalledWith([], { fragment: 'account' });
    });

    it('Help opens a dialog that explains the sections', async () => {
      await setup({});
      const { fixture } = await mountSettings();
      TestBed.tick();

      TestBed.inject(ActionStrapService)
        .config()!
        .secondary!.find((a) => a.id === 'help')!
        .run();
      await fixture.whenStable();

      const dialog = overlayRoot() as HTMLElement;
      expect(dialog.textContent).toContain(settingsEn.help.title);
      expect(dialog.textContent).toContain(settingsEn.help.account);
      expect(dialog.textContent).toContain(settingsEn.help.appearance);
    });
  });
});
