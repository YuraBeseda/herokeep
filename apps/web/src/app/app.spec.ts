import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { AuthService, type AuthStatus, type AuthUser } from '@shared/services/auth/auth.service';
import { UpdateService, WINDOW_RELOAD } from '@shared/services/pwa/update.service';
import { PackStore } from '@shared/stores/pack.store';
import { App } from './app';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

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
    it('shows a Login link, not a username/logout, while logged out (anon or unknown)', async () => {
      configure(authServiceStub('anon'));
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('a.app-shell__login-link')).toBeTruthy();
      expect(compiled.querySelector('.app-shell__account-name')).toBeNull();
      expect(compiled.querySelector('.app-shell__logout')).toBeNull();
    });

    it('shows the username and a Logout button once authed, not the Login link', async () => {
      configure(authServiceStub('authed', { userId: 'u1', username: 'alice' }));
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.app-shell__account-name')?.textContent?.trim()).toBe('alice');
      expect(compiled.querySelector('.app-shell__logout')).toBeTruthy();
      expect(compiled.querySelector('a.app-shell__login-link')).toBeNull();
    });

    it('clicking Logout calls AuthService.logout() and navigates to /', async () => {
      const stub = authServiceStub('authed', { userId: 'u1', username: 'alice' });
      configure(stub);
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const compiled = fixture.nativeElement as HTMLElement;

      compiled.querySelector<HTMLButtonElement>('.app-shell__logout')!.click();
      await fixture.whenStable();

      expect(stub.logout).toHaveBeenCalledTimes(1);
      expect(navigateSpy).toHaveBeenCalledWith(['/']);
    });
  });
});
