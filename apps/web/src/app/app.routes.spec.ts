import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { AuthService, type AuthStatus } from '@shared/services/auth/auth.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { HkDb, type CampaignRow } from '@shared/services/storage/dexie.db';
import { CampaignStore } from '@shared/stores/campaign.store';
import { UpdateService } from '@shared/services/pwa/update.service';
import { App } from './app';
import { authGuard, campaignGuard, redirectAuthedGuard, routes } from './app.routes';
import shellEn from '../assets/i18n/shell/en.json';
import campaignsEn from '../assets/i18n/campaigns/en.json';

/** A minimal `AuthService` stand-in for guard tests: only `status` is read by
 * `redirectAuthedGuard`/`authGuard`, so only `status` needs to exist on the stub. */
function authServiceStub(status: AuthStatus): AuthService {
  return { status: signal(status) } as unknown as AuthService;
}

function configureTestBed(authService: AuthService = authServiceStub('unknown')): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      // Same rationale as app.spec.ts: `UpdateService` needs `SwUpdate`, which needs a real
      // service-worker registration this route test doesn't set up. `UpdateService` itself is
      // covered by its own spec.
      { provide: UpdateService, useValue: { updateAvailable: signal(false), activate: vi.fn() } },
      { provide: AuthService, useValue: authService },
    ],
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { en: {}, 'shell/en': shellEn, 'campaigns/en': campaignsEn },
        translocoConfig: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        preloadLangs: true,
      }),
    ],
  });
}

/** Recursively collects the `path` of every route (at any nesting depth) whose `canActivate`
 * array is non-empty — used below to assert every guard (this task's `authGuard`/`campaignGuard`
 * included) landed on exactly the routes the brief calls for, and nowhere else. */
function collectGuardedPaths(routeConfig: Routes): string[] {
  const guarded: string[] = [];
  for (const route of routeConfig) {
    if (route.canActivate && route.canActivate.length > 0) {
      guarded.push(route.path ?? '(unnamed)');
    }
    if (route.children) {
      guarded.push(...collectGuardedPaths(route.children));
    }
  }
  return guarded;
}

describe('app routes', () => {
  beforeEach(() => configureTestBed());

  it.each([
    '/',
    '/characters',
    '/campaigns',
    '/join',
    '/library',
    '/library/goblin',
    '/settings',
    '/about',
    '/login',
    '/register',
    '/recover',
  ])('resolves %s without error', async (url) => {
    const harness = await RouterTestingHarness.create(url);
    expect(harness.routeNativeElement).toBeTruthy();
  });

  it("adds canActivate to exactly level-up, the three auth routes, and plan-10's campaigns/join/join-code/g routes — no other route is guarded", () => {
    expect(collectGuardedPaths(routes).sort()).toEqual(
      [
        'campaigns',
        'g/:id',
        'join',
        'join/:code',
        'level-up',
        'login',
        'recover',
        'register',
      ].sort(),
    );
  });

  it('adds canDeactivate to exactly the register route (task-5: the recovery-codes confirm guard)', () => {
    const guarded = routes
      .filter((route) => route.canDeactivate && route.canDeactivate.length > 0)
      .map((route) => route.path);
    expect(guarded).toEqual(['register']);
  });

  it('renders the shell nav with 6 routerLink anchors using the real translations', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    // Scoped to the primary nav specifically — task-5 adds its own account-affordance link(s)
    // (Login / logout) in the header, outside this nav landmark, which would otherwise inflate
    // this count without actually changing the primary nav destinations this test guards.
    const links = compiled.querySelectorAll<HTMLAnchorElement>('.app-shell__nav a[routerLink]');
    expect(links.length).toBe(6);
    // Compare against the imported JSON, not re-typed literals, so this cannot drift from the
    // real translation file — a typo'd key or an unresolved scope would render the raw key
    // string instead and fail this assertion.
    const actual = Array.from(links).map((link) => link.textContent?.trim());
    expect(actual).toEqual([
      shellEn.nav.home,
      shellEn.nav.characters,
      shellEn.nav.campaigns,
      shellEn.nav.library,
      shellEn.nav.settings,
      shellEn.nav.about,
    ]);
  });

  it('mounts the home route inside the shell and renders its content', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const tagline = compiled.querySelector('app-home .home__tagline');
    expect(tagline?.textContent?.trim()).toBe(shellEn.home.tagline);
  });
});

describe('redirectAuthedGuard', () => {
  it('returns a UrlTree to /characters when status is authed', () => {
    configureTestBed(authServiceStub('authed'));
    const result = TestBed.runInInjectionContext(() =>
      redirectAuthedGuard({} as never, { url: '/login' } as never),
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as ReturnType<Router['createUrlTree']>)).toBe('/characters');
  });

  it.each<AuthStatus>(['anon', 'unknown'])('allows activation when status is %s', (status) => {
    configureTestBed(authServiceStub(status));
    const result = TestBed.runInInjectionContext(() =>
      redirectAuthedGuard({} as never, { url: '/login' } as never),
    );
    expect(result).toBe(true);
  });

  it('redirects an ALREADY-AUTHED user navigating to /login to /characters (end-to-end through the router)', async () => {
    configureTestBed(authServiceStub('authed'));
    await RouterTestingHarness.create('/login');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/characters');
  });

  it('lets an anon user reach /login (end-to-end through the router)', async () => {
    configureTestBed(authServiceStub('anon'));
    const harness = await RouterTestingHarness.create('/login');
    expect(harness.routeNativeElement).toBeTruthy();
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/login');
  });
});

describe('authGuard', () => {
  it('redirects an anon user to /login?returnUrl=<attempted url>', () => {
    configureTestBed(authServiceStub('anon'));
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/g/some-id/lobby' } as never),
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as ReturnType<Router['createUrlTree']>)).toBe(
      '/login?returnUrl=%2Fg%2Fsome-id%2Flobby',
    );
  });

  it.each<AuthStatus>(['authed', 'unknown'])('allows activation when status is %s', (status) => {
    configureTestBed(authServiceStub(status));
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/campaigns' } as never),
    );
    expect(result).toBe(true);
  });

  it('redirects an anon user hitting /campaigns to /login with the returnUrl set (end-to-end)', async () => {
    configureTestBed(authServiceStub('anon'));
    await RouterTestingHarness.create('/campaigns');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/login?returnUrl=%2Fcampaigns');
  });
});

describe('campaignGuard', () => {
  const CAMPAIGN_ID = '00000000-0000-4000-8000-000000000001';
  const originalFetch = globalThis.fetch;

  // Fresh `HkDb` state per test (mirrors `campaign.store.spec.ts`'s own `beforeEach`) — fake-
  // indexeddb's backing store is a genuinely global singleton (`globalThis.indexedDB`), NOT reset
  // between `it()` blocks by TestBed/Angular the way DI providers are; a leftover
  // `CampaignsRepository` row from an earlier test in this file would otherwise make a LATER
  // "no cached row" test silently see one anyway.
  beforeEach(async () => {
    configureTestBed();
    const db = TestBed.inject(HkDb);
    await Promise.all([db.campaigns.clear(), db.events.clear(), db.settings.clear()]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    TestBed.inject(HkDb).close();
  });

  function routeSnapshot(id: string | null): Parameters<typeof campaignGuard>[0] {
    return { paramMap: convertToParamMap(id ? { id } : {}) } as never;
  }

  it('trusts an already-cached CampaignsRepository row with no network call', async () => {
    const campaignsRepository = TestBed.inject(CampaignsRepository);
    await campaignsRepository.put({
      id: CAMPAIGN_ID,
      name: 'Curse of Strahd',
      system: 'srd-5e-2024',
      role: 'dm',
      lastSeq: 0,
      updatedAt: 1,
    } satisfies CampaignRow);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const openSpy = vi.spyOn(TestBed.inject(CampaignStore), 'open').mockResolvedValue(undefined);

    const result = await TestBed.runInInjectionContext(() =>
      campaignGuard(routeSnapshot(CAMPAIGN_ID), {} as never),
    );

    expect(result).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(`camp:${CAMPAIGN_ID}`);
  });

  it('with no cached row, fetches GET /api/campaigns and seeds one when :id is in the response', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { id: CAMPAIGN_ID, name: 'Icewind Dale', system: 'srd-5e-2024', role: 'player' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.spyOn(TestBed.inject(CampaignStore), 'open').mockResolvedValue(undefined);

    const result = await TestBed.runInInjectionContext(() =>
      campaignGuard(routeSnapshot(CAMPAIGN_ID), {} as never),
    );

    expect(result).toBe(true);
    const row = await TestBed.inject(CampaignsRepository).get(CAMPAIGN_ID);
    expect(row).toMatchObject({ id: CAMPAIGN_ID, name: 'Icewind Dale', role: 'player' });
  });

  it('redirects to /campaigns with a toast when no cached row exists and the server list does not include :id', async () => {
    // `TestBed.overrideProvider` can't run here — the shared `beforeEach`'s own `TestBed.inject
    // (HkDb)` (for the DB-clear step) has already instantiated the test module by this point, so
    // this spies on the REAL (root-provided) `ToastService`'s `show` method instead — equally
    // effective for asserting the CALL, and never actually renders anything since the mock
    // implementation is empty.
    const toastShow = vi
      .spyOn(TestBed.inject(ToastService), 'show')
      .mockImplementation(() => undefined);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await TestBed.runInInjectionContext(() =>
      campaignGuard(routeSnapshot(CAMPAIGN_ID), {} as never),
    );

    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as ReturnType<Router['createUrlTree']>)).toBe('/campaigns');
    expect(toastShow).toHaveBeenCalledWith('campaigns.guard.notMember');
  });

  it('redirects to /campaigns when the server is unreachable (offline) — nothing left to trust', async () => {
    const toastShow = vi
      .spyOn(TestBed.inject(ToastService), 'show')
      .mockImplementation(() => undefined);
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('network down'));

    const result = await TestBed.runInInjectionContext(() =>
      campaignGuard(routeSnapshot(CAMPAIGN_ID), {} as never),
    );

    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as ReturnType<Router['createUrlTree']>)).toBe('/campaigns');
    expect(toastShow).toHaveBeenCalledWith('campaigns.guard.notMember');
  });

  it('redirects to /campaigns when the route has no :id param at all', async () => {
    const result = await TestBed.runInInjectionContext(() =>
      campaignGuard(routeSnapshot(null), {} as never),
    );
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as ReturnType<Router['createUrlTree']>)).toBe('/campaigns');
  });
});
