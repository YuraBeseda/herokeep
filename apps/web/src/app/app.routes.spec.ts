import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { AuthService, type AuthStatus } from '@shared/services/auth/auth.service';
import { UpdateService } from '@shared/services/pwa/update.service';
import { App } from './app';
import { redirectAuthedGuard, routes } from './app.routes';
import shellEn from '../assets/i18n/shell/en.json';

/** A minimal `AuthService` stand-in for guard tests: only `status` is read by
 * `redirectAuthedGuard`, so only `status` needs to exist on the stub. */
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
        langs: { en: {}, 'shell/en': shellEn },
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
 * array is non-empty — used below to assert `redirectAuthedGuard` (this task) landed on ONLY the
 * three new auth routes, alongside the pre-existing `level-up` (`levelUpGuard`), and nowhere
 * else — a literal reading of the brief's "NO other route gains a guard". */
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

  it('adds canActivate to exactly level-up and the three new auth routes — no other route is guarded', () => {
    expect(collectGuardedPaths(routes).sort()).toEqual(
      ['level-up', 'login', 'recover', 'register'].sort(),
    );
  });

  it('adds canDeactivate to exactly the register route (task-5: the recovery-codes confirm guard)', () => {
    const guarded = routes
      .filter((route) => route.canDeactivate && route.canDeactivate.length > 0)
      .map((route) => route.path);
    expect(guarded).toEqual(['register']);
  });

  it('renders the shell nav with 5 routerLink anchors using the real translations', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    // Scoped to the primary nav specifically — task-5 adds its own account-affordance link(s)
    // (Login / logout) in the header, outside this nav landmark, which would otherwise inflate
    // this count without actually changing the 5 primary nav destinations this test guards.
    const links = compiled.querySelectorAll<HTMLAnchorElement>('.app-shell__nav a[routerLink]');
    expect(links.length).toBe(5);
    // Compare against the imported JSON, not re-typed literals, so this cannot drift from the
    // real translation file — a typo'd key or an unresolved scope would render the raw key
    // string instead and fail this assertion.
    const actual = Array.from(links).map((link) => link.textContent?.trim());
    expect(actual).toEqual([
      shellEn.nav.home,
      shellEn.nav.characters,
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
