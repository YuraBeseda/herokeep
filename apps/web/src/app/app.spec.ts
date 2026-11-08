import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService, type AuthStatus, type AuthUser } from '@shared/services/auth/auth.service';
import { UpdateService, WINDOW_RELOAD } from '@shared/services/pwa/update.service';
import { PackStore } from '@shared/stores/pack.store';
import { App } from './app';
import { NavHistoryService } from './ui/nav/nav-history.service';
import { ShellCampaignContext } from './ui/shell/campaign-context.service';
import { provideShellTransloco } from './ui/testing/transloco-testing';
import { stubViewport } from './ui/testing/viewport';

@Component({ template: '' })
class Stub {}

/** A minimal `AuthService` stand-in — only `status`/`user`/`logout` are read/called by the
 * shell's account affordance. */
function authServiceStub(status: AuthStatus, user: AuthUser | null = null): Partial<AuthService> {
  return {
    status: signal(status),
    user: signal(user),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

describe('App', () => {
  let updateAvailable: ReturnType<typeof signal<boolean>>;
  let activate: ReturnType<typeof vi.fn>;
  let coreLoadFailed: ReturnType<typeof signal<boolean>>;
  let reload: ReturnType<typeof vi.fn>;

  function configure(authService: Partial<AuthService> = authServiceStub('unknown')): void {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(
          ['', 'library', 'packs', 'settings'].map((path) => ({ path, component: Stub })),
        ),
        provideShellTransloco(),
        { provide: ShellCampaignContext, useValue: { current: signal(null) } },
        // The real `UpdateService` depends on `SwUpdate`, which in turn needs a service-worker
        // registration provider this shell test doesn't set up — `UpdateService` has its own
        // dedicated spec against a stubbed `SwUpdate` (update.service.spec.ts), so here the shell
        // only needs a lightweight double for the banner's presentational contract.
        { provide: UpdateService, useValue: { updateAvailable, activate } },
        // Likewise, the real `PackStore` needs `PackLoader`/`PacksRepository`/`ToastService` this
        // shell test doesn't set up — a signal double is enough for the retry-state contract.
        { provide: PackStore, useValue: { coreLoadFailed } },
        { provide: WINDOW_RELOAD, useValue: reload },
        { provide: AuthService, useValue: authService },
      ],
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    updateAvailable = signal(false);
    activate = vi.fn();
    coreLoadFailed = signal(false);
    reload = vi.fn();

    configure();
    await TestBed.compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render a router-outlet shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('hides the update banner when no update is available', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-shell__update')).toBeNull();
  });

  it('shows the update banner and reloads via UpdateService.activate() on click', async () => {
    updateAvailable.set(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const button = compiled.querySelector<HTMLButtonElement>('.app-shell__update-button');
    expect(button).toBeTruthy();

    button?.click();
    await fixture.whenStable();

    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('replaces the router outlet with a retry state when the core pack failed to load', async () => {
    coreLoadFailed.set(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('router-outlet')).toBeNull();
    expect(compiled.querySelector('.app-shell__error')).toBeTruthy();
  });

  it('clicking the retry button calls the injected reload function', async () => {
    coreLoadFailed.set(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.app-shell__error button')?.click();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  describe('account affordance', () => {
    it('shows a Log in link, not the account button, while logged out (anon or unknown)', async () => {
      configure(authServiceStub('anon'));
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('a.app-shell__login-link')).toBeTruthy();
      expect(compiled.querySelector('a.hk-rail__account')).toBeNull();
    });

    it('shows the account button, linked to Settings, once authed', async () => {
      configure(authServiceStub('authed', { userId: 'u1', username: 'alice' }));
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const account = compiled.querySelector('a.hk-rail__account');
      expect(account?.getAttribute('href')).toBe('/settings');
      expect(account?.getAttribute('aria-label')).toBe('Account: alice');
      expect(compiled.querySelector('a.app-shell__login-link')).toBeNull();
    });
  });

  describe('shell chrome', () => {
    it('renders the textures, strap and tab bar exactly once, docked after main', async () => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelectorAll('hk-textures')).toHaveLength(1);
      expect(compiled.querySelectorAll('hk-action-strap')).toHaveLength(1);
      expect(compiled.querySelectorAll('hk-tab-bar')).toHaveLength(1);
      const main = compiled.querySelector('main')!;
      const dock = compiled.querySelector('.app-shell__dock')!;
      expect(main.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(dock.contains(compiled.querySelector('hk-action-strap'))).toBe(true);
      expect(dock.contains(compiled.querySelector('hk-tab-bar'))).toBe(true);
    });

    it('docks the strap in the page flow (sticky, never fixed) so the page reserves its height', async () => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      document.body.append(root);
      const dock = root.querySelector('.app-shell__dock')!;
      expect(getComputedStyle(dock).position).toBe('sticky');
      root.remove();
    });

    it('shows the rail on tablet and desktop and no top bar', async () => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('hk-nav-rail')).toBeTruthy();
      expect(compiled.querySelector('hk-top-bar')).toBeNull();
    });

    it('shows the top bar, with the section title, instead of the rail on a phone', async () => {
      stubViewport({ phone: true, coarse: true });
      const fixture = TestBed.createComponent(App);
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/library');
      await fixture.whenStable();
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('hk-nav-rail')).toBeNull();
      expect(compiled.querySelector('hk-top-bar')).toBeTruthy();
      expect(compiled.querySelector('.hk-topbar__title')?.textContent?.trim()).toBe('Library');
      vi.unstubAllGlobals();
    });

    it('records every committed navigation in the navigation history', async () => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const router = TestBed.inject(Router);
      const history = TestBed.inject(NavHistoryService);
      await router.navigateByUrl('/library');
      await router.navigateByUrl('/packs?x=1');
      expect(history.currentPath()).toBe('/packs');
      expect(history.canGoBack()).toBe(true);
    });
  });
});
