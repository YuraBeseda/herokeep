import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { AuthService } from '@shared/services/auth/auth.service';
import authEn from '../../../../assets/i18n/auth/en.json';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { hintOf } from '../../../ui/testing/harness';
import { overlayRoot } from '../../../ui/testing/overlay';
import { LoginComponent } from './login.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'auth/en') return of(authEn);
    return of({});
  }
}

function configure(authService: Partial<AuthService>, returnUrl?: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'characters', children: [] }]),
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
      { provide: AuthService, useValue: authService },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}),
          },
        },
      },
    ],
  });
}

function setInput(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

describe('LoginComponent', () => {
  it('submits the form values (including device label) to AuthService.login and navigates to /characters on success', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    configure({ login });

    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const compiled = fixture.nativeElement as HTMLElement;
    setInput(compiled.querySelector('input[name="username"]')!, 'alice');
    setInput(compiled.querySelector('input[name="password"]')!, 'hunter2-passphrase');
    setInput(compiled.querySelector('input[name="deviceLabel"]')!, 'My custom label');
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(login).toHaveBeenCalledWith('alice', 'hunter2-passphrase', 'My custom label');
    expect(navigateSpy).toHaveBeenCalledWith(['/characters']);
  });

  it('navigates to ?returnUrl instead of /characters when present (plan-10 authGuard deep-link)', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    configure({ login }, '/g/00000000-0000-4000-8000-000000000001/lobby');

    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateByUrlSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const compiled = fixture.nativeElement as HTMLElement;
    setInput(compiled.querySelector('input[name="username"]')!, 'alice');
    setInput(compiled.querySelector('input[name="password"]')!, 'hunter2-passphrase');
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(navigateByUrlSpy).toHaveBeenCalledWith('/g/00000000-0000-4000-8000-000000000001/lobby');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores a protocol-relative returnUrl ("//host/...") and falls back to /characters', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    configure({ login }, '//evil.example/phish');

    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const compiled = fixture.nativeElement as HTMLElement;
    setInput(compiled.querySelector('input[name="username"]')!, 'alice');
    setInput(compiled.querySelector('input[name="password"]')!, 'hunter2-passphrase');
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith(['/characters']);
  });

  it('shows the generic invalid-credentials message on a 401 — no user-exists oracle wording', async () => {
    const { ApiError } = await import('@shared/services/api/api-fetch');
    const login = vi.fn().mockRejectedValue(new ApiError(401, 'unauthorized', 'nope'));
    configure({ login });

    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    setInput(compiled.querySelector('input[name="username"]')!, 'alice');
    setInput(compiled.querySelector('input[name="password"]')!, 'whatever-password');
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(authEn.errors.invalidCredentials);
  });

  it('shows the lockout message on a 429', async () => {
    const { ApiError } = await import('@shared/services/api/api-fetch');
    const login = vi.fn().mockRejectedValue(new ApiError(429, 'too_many_requests', 'slow down'));
    configure({ login });

    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    setInput(compiled.querySelector('input[name="username"]')!, 'alice');
    setInput(compiled.querySelector('input[name="password"]')!, 'whatever-password');
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(authEn.errors.lockout);
  });

  it('shows the offline message on a network-level (status 0) failure', async () => {
    const { ApiError } = await import('@shared/services/api/api-fetch');
    const login = vi.fn().mockRejectedValue(new ApiError(0, 'network_error', 'no network'));
    configure({ login });

    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    setInput(compiled.querySelector('input[name="username"]')!, 'alice');
    setInput(compiled.querySelector('input[name="password"]')!, 'whatever-password');
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(authEn.errors.network);
  });

  it('disables the submit button while a login is in flight', async () => {
    let resolveLogin!: () => void;
    const login = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    configure({ login });

    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    setInput(compiled.querySelector('input[name="username"]')!, 'alice');
    setInput(compiled.querySelector('input[name="password"]')!, 'whatever-password');
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const submit = compiled.querySelector<HTMLButtonElement>('.login__submit')!;
    // `hk-button` blocks while loading: aria-disabled + busy, and a click never reaches the form.
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.getAttribute('aria-busy')).toBe('true');
    submit.click();
    await fixture.whenStable();
    expect(login).toHaveBeenCalledTimes(1);

    resolveLogin();
    // `fixture.whenStable()` tracks Angular-registered pending tasks, not an arbitrary
    // unresolved promise chain inside `onSubmit` — a real macrotask boundary guarantees the
    // `login()`/`router.navigate()`/`finally` microtask chain has actually run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    expect(submit.getAttribute('aria-disabled')).toBeNull();
    expect(submit.getAttribute('aria-busy')).toBeNull();
  });

  it('prefills the device label field with a non-empty default', async () => {
    configure({ login: vi.fn() });
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const deviceLabelInput = compiled.querySelector<HTMLInputElement>('input[name="deviceLabel"]')!;
    expect(deviceLabelInput.value.length).toBeGreaterThan(0);
  });

  describe('AU01 leaf', () => {
    async function mountAndSubmitWith(error: unknown) {
      const login = vi.fn().mockRejectedValue(error);
      configure({ login });
      const fixture = TestBed.createComponent(LoginComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      setInput(compiled.querySelector('input[name="username"]')!, 'alice');
      setInput(compiled.querySelector('input[name="password"]')!, 'whatever-password');
      await fixture.whenStable();
      compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      return { fixture, compiled };
    }

    it('carries the primary button in the form’s own strap, and the page strap keeps Back and Help', async () => {
      configure({ login: vi.fn() });
      const fixture = TestBed.createComponent(LoginComponent);
      await fixture.whenStable();
      TestBed.tick();
      const compiled = fixture.nativeElement as HTMLElement;

      const submit = compiled.querySelector('form [data-auth-strap] button[type="submit"]');
      expect(submit).toBe(compiled.querySelector('.login__submit'));

      const strap = TestBed.inject(ActionStrapService).config()!;
      expect(strap.exit?.map((a) => a.id)).toEqual(['back']);
      expect(strap.primary).toEqual([]);
      expect(strap.secondary?.map((a) => a.id)).toEqual(['help']);
    });

    it('Help opens a dialog that explains accounts and recovery codes', async () => {
      configure({ login: vi.fn() });
      const fixture = TestBed.createComponent(LoginComponent);
      await fixture.whenStable();
      TestBed.tick();

      TestBed.inject(ActionStrapService).config()!.secondary![0].run();
      await fixture.whenStable();

      const text = (overlayRoot() as HTMLElement).textContent ?? '';
      expect(text).toContain(authEn.help.title);
      expect(text).toContain(authEn.help.recovery);
    });

    it('shows a wrong password under the password field, outlined, and not in the form', async () => {
      const { ApiError } = await import('@shared/services/api/api-fetch');
      const { compiled } = await mountAndSubmitWith(new ApiError(401, 'unauthorized', 'nope'));

      const password = compiled.querySelector<HTMLInputElement>('input[name="password"]')!;
      const message = compiled.querySelector('.login__password [role="alert"]');
      expect(message?.textContent?.trim()).toBe(authEn.errors.invalidCredentials);
      expect(password.getAttribute('aria-invalid')).toBe('true');
      expect(password.getAttribute('aria-describedby')).toBe(message?.id);
      expect(compiled.querySelector('.login__error')).toBeNull();
    });

    it('shows a lockout or an offline failure in the form, not under a field', async () => {
      const { ApiError } = await import('@shared/services/api/api-fetch');
      const { compiled } = await mountAndSubmitWith(new ApiError(429, 'too_many_requests', 'x'));

      expect(compiled.querySelector('.login__error')?.textContent?.trim()).toBe(
        authEn.errors.lockout,
      );
      expect(
        compiled
          .querySelector<HTMLInputElement>('input[name="password"]')!
          .getAttribute('aria-invalid'),
      ).toBeNull();
    });

    it('clears the error as soon as the person edits a field', async () => {
      const { ApiError } = await import('@shared/services/api/api-fetch');
      const { fixture, compiled } = await mountAndSubmitWith(
        new ApiError(401, 'unauthorized', 'nope'),
      );
      expect(compiled.querySelector('[role="alert"]')).not.toBeNull();

      setInput(compiled.querySelector('input[name="password"]')!, 'another-try');
      await fixture.whenStable();

      expect(compiled.querySelector('[role="alert"]')).toBeNull();
    });

    it('names the section the person was sent from when authGuard redirected them', async () => {
      configure({ login: vi.fn() }, '/g/00000000-0000-4000-8000-000000000001/lobby');
      const fixture = TestBed.createComponent(LoginComponent);
      await fixture.whenStable();

      const notice = (fixture.nativeElement as HTMLElement).querySelector('.login__redirected');
      expect(notice?.textContent).toContain('Campaigns');
      expect(notice?.textContent).toContain('taken there afterwards');
    });

    it('shows no redirect notice for a plain visit', async () => {
      configure({ login: vi.fn() });
      const fixture = TestBed.createComponent(LoginComponent);
      await fixture.whenStable();

      expect((fixture.nativeElement as HTMLElement).querySelector('.login__redirected')).toBeNull();
    });

    it('explains the device name, and links to create an account and to recovery', async () => {
      configure({ login: vi.fn() });
      const fixture = TestBed.createComponent(LoginComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const device = compiled.querySelector<HTMLInputElement>('input[name="deviceLabel"]')!;
      const hint = compiled.querySelector(`#${device.getAttribute('aria-describedby')}`);
      expect(hint?.textContent?.trim()).toBe(authEn.login.deviceLabelHint);

      const links = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.login__links a'));
      expect(links.map((a) => [a.getAttribute('href'), a.textContent?.trim()])).toEqual([
        ['/register', authEn.login.registerLink],
        ['/recover', authEn.login.recoverLink],
      ]);
    });

    it('says in the strap that no e-mail is needed', async () => {
      configure({ login: vi.fn() });
      const fixture = TestBed.createComponent(LoginComponent);
      await fixture.whenStable();

      const note = (fixture.nativeElement as HTMLElement).querySelector('[data-auth-strap]');
      expect(note?.textContent).toContain(authEn.login.strapNote);
    });

    it('hints at the seal in the title', async () => {
      configure({ login: vi.fn() });
      const fixture = TestBed.createComponent(LoginComponent);
      await fixture.whenStable();

      const seal = (fixture.nativeElement as HTMLElement).querySelector('hk-wax-seal')!;
      expect(hintOf(seal)).toBe(authEn.login.title);
    });
  });
});
