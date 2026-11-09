import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { AuthService } from '@shared/services/auth/auth.service';
import authEn from '../../../../assets/i18n/auth/en.json';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { hintOf } from '../../../ui/testing/harness';
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
      provideTranslocoMessageformat(),
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
    const hint = compiled.querySelector('.recover__password .hk-field__msg--error');
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

  describe('AU01 leaf', () => {
    async function mountForm() {
      configure({ reset: vi.fn() });
      const fixture = TestBed.createComponent(RecoverComponent);
      await fixture.whenStable();
      TestBed.tick();
      return { fixture, compiled: fixture.nativeElement as HTMLElement };
    }

    it('carries Reset password in the form’s own strap; the page strap keeps Back and Help', async () => {
      const { compiled } = await mountForm();

      expect(compiled.querySelector('form [data-auth-strap] button[type="submit"]')).toBe(
        compiled.querySelector('.recover__submit'),
      );
      const strap = TestBed.inject(ActionStrapService).config()!;
      expect(strap.exit?.map((a) => a.id)).toEqual(['back']);
      expect(strap.primary).toEqual([]);
      expect(strap.secondary?.map((a) => a.id)).toEqual(['help']);
    });

    it('draws Reset password disabled, with its reason in the hint, until every field is valid', async () => {
      const { compiled } = await mountForm();
      const submit = compiled.querySelector<HTMLButtonElement>('.recover__submit')!;

      expect(submit.getAttribute('aria-disabled')).toBe('true');
      expect(hintOf(submit)).toBe(authEn.recover.reasonIncomplete);
    });

    it('sets the recovery code in a monospace face and explains it under the field', async () => {
      const { compiled } = await mountForm();

      const code = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
      expect(code.classList.contains('hk-input--mono')).toBe(true);
      expect(
        compiled.querySelector(`#${code.getAttribute('aria-describedby')}`)?.textContent,
      ).toContain(authEn.recover.codeHint);
    });

    it('shows the password rules under the new password before anything is typed', async () => {
      const { compiled } = await mountForm();

      const input = compiled.querySelector<HTMLInputElement>('input[name="newPassword"]')!;
      expect(
        compiled.querySelector(`#${input.getAttribute('aria-describedby')}`)?.textContent?.trim(),
      ).toBe(authEn.recover.newPasswordHint);
    });

    it('shows a rejected code under the code field, outlined', async () => {
      const { ApiError } = await import('@shared/services/api/api-fetch');
      configure({ reset: vi.fn().mockRejectedValue(new ApiError(401, 'unauthorized', 'nope')) });
      const fixture = TestBed.createComponent(RecoverComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      await fillAndSubmit(compiled, fixture, {
        username: 'alice',
        code: 'ABCDE-12345',
        password: 'a-strong-unique-passphrase',
      });

      const code = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
      const message = compiled.querySelector('.recover__code [role="alert"]');
      expect(message?.textContent?.trim()).toBe(authEn.errors.invalidCredentials);
      expect(code.getAttribute('aria-invalid')).toBe('true');
    });

    it('links back to log in', async () => {
      const { compiled } = await mountForm();

      const link = compiled.querySelector<HTMLAnchorElement>('.recover__links a')!;
      expect(link.getAttribute('href')).toBe('/login');
      expect(link.textContent?.trim()).toBe(authEn.recover.loginLink);
    });
  });
});
