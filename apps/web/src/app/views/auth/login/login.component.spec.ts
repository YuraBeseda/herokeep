import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { AuthService } from '@shared/services/auth/auth.service';
import authEn from '../../../../assets/i18n/auth/en.json';
import { LoginComponent } from './login.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'auth/en') return of(authEn);
    return of({});
  }
}

function configure(authService: Partial<AuthService>) {
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
      { provide: AuthService, useValue: authService },
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
    expect(submit.disabled).toBe(true);

    resolveLogin();
    // `fixture.whenStable()` tracks Angular-registered pending tasks, not an arbitrary
    // unresolved promise chain inside `onSubmit` — a real macrotask boundary guarantees the
    // `login()`/`router.navigate()`/`finally` microtask chain has actually run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    expect(submit.disabled).toBe(false);
  });

  it('prefills the device label field with a non-empty default', async () => {
    configure({ login: vi.fn() });
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const deviceLabelInput = compiled.querySelector<HTMLInputElement>('input[name="deviceLabel"]')!;
    expect(deviceLabelInput.value.length).toBeGreaterThan(0);
  });
});
