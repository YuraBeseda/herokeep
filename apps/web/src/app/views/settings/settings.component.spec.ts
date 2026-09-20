import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Diagnostic } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { AuthService, type AuthStatus, type AuthUser } from '@shared/services/auth/auth.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb, type CharacterRow } from '@shared/services/storage/dexie.db';
import type { QuotaInfo } from '@shared/services/sync/stream-sync-session';
import { SyncService } from '@shared/services/sync/sync.service';
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

/** Configures the TestBed with real settings i18n, a stubbed `AuthService`/`SyncService` (T9
 * touches neither's own internals — those are covered by `auth.service.spec.ts`/
 * `sync.service.spec.ts`; this spec only asserts the component reads their signals/calls their
 * methods) and every collaborator `settings.component.spec.ts` already stubbed. `HkDb` stays real
 * (fake-indexeddb, via `test-setup.ts`) so the Quota card's `CharactersRepository.list()` read is
 * genuine, same reasoning `characters-list.component.spec.ts` gives for its own `HkDb` use. */
async function setup(options: {
  translationPacks?: Pack[];
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
    importTranslation,
    removeTranslation,
  };

  const loadDemoRu = options.loadDemoRu ?? vi.fn(() => Promise.resolve(demoPack()));
  const toastShow = vi.fn();
  const requestPersist = vi.fn(() => Promise.resolve(true));

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

  // Fake-indexeddb persists `HkDb` data across `it()` blocks within this spec FILE (a real
  // IndexedDB-backed Dexie instance, keyed by a fixed DB name — not reset by
  // `TestBed.configureTestingModule` itself); the Quota card reads `CharactersRepository.list()`
  // straight off it, so every test starts from a clean `characters` table regardless of what an
  // earlier test in this file left behind (mirrors `characters-list.component.spec.ts`'s own
  // per-test `db.characters.clear()`).
  await TestBed.inject(HkDb).characters.clear();

  return {
    translationPacksState,
    importTranslation,
    removeTranslation,
    loadDemoRu,
    toastShow,
    requestPersist,
    authStatusState,
    authUserState,
    logout,
    logoutAll,
    quotaSignals,
    quotaFor,
  };
}

function chipByAttr(root: HTMLElement, attr: string, value: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${attr}="${value}"]`);
}

/** Waits a couple of real macrotask turns then `whenStable()` — same helper reasoning as
 * `characters-list.component.spec.ts`'s `flushDeleteFlow`: the Devices card's `resource()` loader
 * runs a real (stubbed-`fetch`) async round trip that Angular's zoneless stability tracking alone
 * doesn't reliably wait out. */
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

describe('SettingsComponent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.removeItem('hk.locale');
    // Devices GET is a REAL `apiJson` call under a stubbed `fetch`, matching
    // `auth.service.spec.ts`'s own convention — a route not declared per-test defaults to a
    // harmless empty-list GET so tests that don't care about devices don't need to stub it.
    globalThis.fetch = routedFetch({
      '/api/me/sessions': () => jsonResponse(200, []),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // A confirm dialog left open by a test (e.g. one that never clicks confirm/cancel) attaches
    // straight to `document.body` via CDK Overlay — same cleanup
    // `characters-list.component.spec.ts`'s own `afterEach` does, so a later test's
    // `document.querySelector('.settings-*-confirm__*')` never accidentally matches a stale node.
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('clicking a language chip calls LocaleService.setLocale and marks it active', async () => {
    await setup({});
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
    await setup({});
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
    const { toastShow, translationPacksState } = await setup({});
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
    const { toastShow, translationPacksState } = await setup({ importTranslation });
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
    const { toastShow, translationPacksState } = await setup({ loadDemoRu });
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
    const { removeTranslation, translationPacksState } = await setup({
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
    await setup({});
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.settings__pack-id')?.textContent?.trim()).toBe(
      'srd-5e-2024@0.1.0',
    );
  });

  it('storage section renders used/quota from a stubbed StoragePersistService', async () => {
    await setup({
      storage: { supported: true, estimate: { usage: 1_048_576, quota: 104_857_600 } },
    });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const usageText = compiled.querySelector('.settings__storage-usage')?.textContent ?? '';
    expect(usageText).toContain('1');
    expect(usageText).toContain('100');
    expect(compiled.querySelector('.settings__persist-button')).toBeTruthy();
  });

  it('the persist button requests persistence, and a granted persist swaps in the persisted label', async () => {
    const { requestPersist } = await setup({ storage: { supported: true, persisted: false } });
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
    await setup({ storage: { supported: false } });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.settings__persist-button')).toBeNull();
    expect(compiled.querySelector('.settings__storage-usage')).toBeNull();
  });

  // --- Account card (task-9-brief.md) -----------------------------------------------------

  describe('Account card', () => {
    it('anon: shows a login prompt with Login/Register links, no username or logout buttons', async () => {
      await setup({ authStatus: 'anon' });
      const fixture = TestBed.createComponent(SettingsComponent);
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('.settings__account-prompt')).toBeTruthy();
      expect(compiled.querySelector('.settings__login-link')).toBeTruthy();
      expect(compiled.querySelector('.settings__register-link')).toBeTruthy();
      expect(compiled.querySelector('.settings__account-username')).toBeNull();
      expect(compiled.querySelector('.settings__logout')).toBeNull();
      expect(compiled.querySelector('.settings__logout-all')).toBeNull();
    });

    it('authed: shows the username and never a regenerate-recovery-codes button (no server route)', async () => {
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'Aria' } });
      const fixture = TestBed.createComponent(SettingsComponent);
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('.settings__account-username')?.textContent?.trim()).toBe(
        'Aria',
      );
      expect(compiled.querySelector('.settings__logout')).toBeTruthy();
      expect(compiled.querySelector('.settings__logout-all')).toBeTruthy();
      expect(compiled.querySelector('.settings__account-prompt')).toBeNull();
      // task-9-brief.md's explicit VERIFY result: the server never shipped a
      // regenerate-recovery-codes route — omitted here, never invented client-side.
      expect(compiled.querySelector('.settings__regenerate-codes')).toBeNull();
    });

    it('authed: clicking Logout calls AuthService.logout', async () => {
      const { logout } = await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
      });
      const fixture = TestBed.createComponent(SettingsComponent);
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      compiled.querySelector<HTMLButtonElement>('.settings__logout')!.click();
      await fixture.whenStable();

      expect(logout).toHaveBeenCalled();
    });

    it('authed: Logout-everywhere opens a confirm dialog; confirming calls AuthService.logoutAll', async () => {
      const { logoutAll } = await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
      });
      const fixture = TestBed.createComponent(SettingsComponent);
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      compiled.querySelector<HTMLButtonElement>('.settings__logout-all')!.click();
      await fixture.whenStable();

      const confirmButton = document.querySelector<HTMLButtonElement>(
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
      const fixture = TestBed.createComponent(SettingsComponent);
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      compiled.querySelector<HTMLButtonElement>('.settings__logout-all')!.click();
      await fixture.whenStable();

      document.querySelector<HTMLButtonElement>('.settings-logout-all-confirm__cancel')!.click();
      await fixture.whenStable();

      expect(logoutAll).not.toHaveBeenCalled();
    });
  });

  // --- Devices card (task-9-brief.md) -----------------------------------------------------

  describe('Devices card', () => {
    it('is absent when logged out', async () => {
      await setup({ authStatus: 'anon' });
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('.settings__devices-list')).toBeNull();
      expect(compiled.querySelector('.settings__devices-error')).toBeNull();
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
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      const rows = compiled.querySelectorAll('.settings__devices-row');
      expect(rows.length).toBe(2);
      const currentRow = compiled.querySelector('.settings__devices-row[data-current="true"]');
      expect(currentRow?.textContent).toContain('Chrome on Windows');
      expect(currentRow?.querySelector('.settings__devices-current-tag')).toBeTruthy();
      // The current session's own row never offers a self-revoke button (see settings.component.ts).
      expect(currentRow?.querySelector('.settings__devices-revoke')).toBeNull();

      const otherRow = compiled.querySelector('.settings__devices-row[data-current="false"]');
      expect(otherRow?.querySelector('.settings__devices-revoke')).toBeTruthy();
    });

    it('shows a loading state while the fetch is in flight', async () => {
      let resolveFetch!: (res: Response) => void;
      globalThis.fetch = vi.fn<typeof fetch>(
        () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
      );
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const fixture = TestBed.createComponent(SettingsComponent);
      // Deliberately NOT `whenStable()` here — the fetch above never resolves until
      // `resolveFetch` below, and `whenStable()` waits for exactly that (the `resource()`'s
      // pending load) to settle, so awaiting it first would hang forever. A synchronous
      // `detectChanges()` is enough: `resource()`'s `isLoading` signal flips `true` immediately
      // on creation, before its loader's promise ever settles.
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('.settings__devices-loading')).toBeTruthy();

      resolveFetch(jsonResponse(200, []));
      await flushAsync(fixture);
      expect(compiled.querySelector('.settings__devices-loading')).toBeNull();
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
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('.settings__devices-error')).toBeTruthy();

      const retryButton = compiled.querySelector<HTMLButtonElement>('.settings__devices-retry');
      expect(retryButton).toBeTruthy();
      retryButton!.click();
      await flushAsync(fixture);

      expect(compiled.querySelector('.settings__devices-error')).toBeNull();
      expect(compiled.querySelectorAll('.settings__devices-row').length).toBe(1);
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
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelectorAll('.settings__devices-row').length).toBe(2);

      const revokeButton = compiled.querySelector<HTMLButtonElement>(
        '.settings__devices-row[data-current="false"] .settings__devices-revoke',
      );
      revokeButton!.click();
      await fixture.whenStable();

      const confirmButton = document.querySelector<HTMLButtonElement>(
        '.settings-revoke-device-confirm__confirm',
      );
      expect(confirmButton).toBeTruthy();
      confirmButton!.click();
      await flushAsync(fixture);

      expect(compiled.querySelectorAll('.settings__devices-row').length).toBe(1);
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
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      const revokeButton = compiled.querySelector<HTMLButtonElement>(
        '.settings__devices-row[data-current="false"] .settings__devices-revoke',
      );
      revokeButton!.click();
      await fixture.whenStable();

      document.querySelector<HTMLButtonElement>('.settings-revoke-device-confirm__cancel')!.click();
      await flushAsync(fixture);

      expect(compiled.querySelectorAll('.settings__devices-row').length).toBe(2);
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
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      const revokeButton = compiled.querySelector<HTMLButtonElement>(
        '.settings__devices-row[data-current="false"] .settings__devices-revoke',
      );
      revokeButton!.click();
      await fixture.whenStable();

      document
        .querySelector<HTMLButtonElement>('.settings-revoke-device-confirm__confirm')!
        .click();
      await flushAsync(fixture);

      expect(toastShow).toHaveBeenCalledWith('settings.devices.toast.revoke-failed');
      expect(compiled.querySelectorAll('.settings__devices-row').length).toBe(2);
    });

    // Fix-round 1, Minor 2: `DeviceRow.id` is `string | null` server-side (a pre-migration
    // session row never got the additive `0001` column) — a null-id row must never offer revoke
    // (there is no `DELETE /api/me/sessions/null`), and must still render distinctly from any
    // other null-id row despite `@for`'s fallback track key not being `id`.
    it('a null-id row (pre-migration session) never offers revoke, and still renders', async () => {
      globalThis.fetch = routedFetch({
        '/api/me/sessions': () =>
          jsonResponse(200, [
            { id: 'sess-1', deviceLabel: 'Chrome', createdAt: 1, lastSeenAt: 1, current: true },
            { id: null, deviceLabel: 'Old device', createdAt: 2, lastSeenAt: 2, current: false },
          ]),
      });
      await setup({ authStatus: 'authed', authUser: { userId: 'u1', username: 'A' } });
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      const rows = compiled.querySelectorAll('.settings__devices-row');
      expect(rows.length).toBe(2);

      const nullIdRow = compiled.querySelector('.settings__devices-row[data-current="false"]');
      expect(nullIdRow?.textContent).toContain('Old device');
      expect(nullIdRow?.querySelector('.settings__devices-revoke')).toBeNull();
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
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      const labels = Array.from(compiled.querySelectorAll('.settings__devices-label')).map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual(['Old device A', 'Old device B']);
    });
  });

  // --- Quota card (task-9-brief.md) -------------------------------------------------------

  describe('Quota card', () => {
    it('is absent when logged out', async () => {
      await setup({ authStatus: 'anon' });
      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('.settings__quota-list')).toBeNull();
    });

    it('renders per-character rows with formatted used/max from seeded quota signals', async () => {
      const row = mkRow({ id: 'char:aaaa', name: 'Aria' });
      const { quotaSignals } = await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
        quota: { 'char:aaaa': mkQuota({ bytesUsed: 1024, bytesMax: 1024 * 1024 }) },
      });
      await TestBed.inject(HkDb).characters.put(row);

      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      const quotaRow = compiled.querySelector('.settings__quota-row');
      expect(quotaRow?.querySelector('.settings__quota-name')?.textContent?.trim()).toBe('Aria');
      const usageText = quotaRow?.querySelector('.settings__quota-usage')?.textContent ?? '';
      expect(usageText).toContain('1');
      expect(quotaRow?.classList.contains('settings__quota-row--warning')).toBe(false);
      expect(quotaSignals.has('char:aaaa')).toBe(true);
    });

    it('applies the warning style at >= 80% usage', async () => {
      const row = mkRow({ id: 'char:bbbb', name: 'Borin' });
      await setup({
        authStatus: 'authed',
        authUser: { userId: 'u1', username: 'A' },
        quota: { 'char:bbbb': mkQuota({ bytesUsed: 900, bytesMax: 1000 }) },
      });
      await TestBed.inject(HkDb).characters.put(row);

      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      const quotaRow = compiled.querySelector('.settings__quota-row');
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

      const fixture = TestBed.createComponent(SettingsComponent);
      await flushAsync(fixture);

      const compiled = fixture.nativeElement as HTMLElement;
      const quotaRow = compiled.querySelector('.settings__quota-row');
      expect(quotaRow?.querySelector('.settings__quota-usage--unknown')).toBeTruthy();
      expect(quotaRow?.textContent).toContain('—');
    });
  });
});
