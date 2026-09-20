import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { AuthService } from '@shared/services/auth/auth.service';
import authEn from '../../../../assets/i18n/auth/en.json';
import { RecoverComponent } from './recover.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'auth/en') return of(authEn);
    return of({});
  }
}

const COMMON_LIST_FIXTURE = ['password', 'letmein', 'qwerty123'].join('\n');

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function configure(authService: Partial<AuthService>): void {
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

describe('RecoverComponent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(textResponse(200, COMMON_LIST_FIXTURE));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  async function fillAndSubmit(
    compiled: HTMLElement,
    fixture: { whenStable(): Promise<void> },
    { username, code, password }: { username: string; code: string; password: string },
  ): Promise<void> {
    setInput(compiled.querySelector('input[name="username"]')!, username);
    setInput(compiled.querySelector('input[name="code"]')!, code);

    vi.useFakeTimers();
    setInput(compiled.querySelector('input[name="newPassword"]')!, password);
    await vi.advanceTimersByTimeAsync(300);
    TestBed.tick();
    await fixture.whenStable();
    vi.useRealTimers();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  it('normalizes the recovery code (dashes/lowercase stripped, uppercased) before calling AuthService.reset', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    configure({ reset });

    const fixture = TestBed.createComponent(RecoverComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await fillAndSubmit(compiled, fixture, {
      username: 'alice',
      code: ' abcde-23456 ',
      password: 'a-strong-unique-passphrase',
    });

    expect(reset).toHaveBeenCalledWith('alice', 'ABCDE23456', 'a-strong-unique-passphrase');
    expect(navigateSpy).toHaveBeenCalledWith(['/characters']);
  });

  it('shows the generic error message on a rejected reset (e.g. invalid/used code)', async () => {
    const { ApiError } = await import('@shared/services/api/api-fetch');
    const reset = vi.fn().mockRejectedValue(new ApiError(401, 'unauthorized', 'nope'));
    configure({ reset });

    const fixture = TestBed.createComponent(RecoverComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    await fillAndSubmit(compiled, fixture, {
      username: 'alice',
      code: 'ABCDE-12345',
      password: 'a-strong-unique-passphrase',
    });

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(authEn.errors.invalidCredentials);
  });

  it('blocks submit and shows the live reason for a weak new password', async () => {
    const reset = vi.fn();
    configure({ reset });

    const fixture = TestBed.createComponent(RecoverComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    await fillAndSubmit(compiled, fixture, {
      username: 'alice',
      code: 'ABCDE-12345',
      password: 'short1',
    });

    expect(reset).not.toHaveBeenCalled();
    const hint = compiled.querySelector('.recover__hint--error');
    expect(hint?.textContent?.trim()).toBe(authEn.validation.tooShort);
  });

  it('renders a notice that a successful reset signs out other devices', async () => {
    configure({ reset: vi.fn() });
    const fixture = TestBed.createComponent(RecoverComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.recover__notice')?.textContent?.trim()).toBe(
      authEn.recover.signOutNotice,
    );
  });
});
