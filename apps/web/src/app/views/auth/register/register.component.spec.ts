import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { AuthService } from '@shared/services/auth/auth.service';
import authEn from '../../../../assets/i18n/auth/en.json';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { hintOf } from '../../../ui/testing/harness';
import { RegisterComponent } from './register.component';

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

function configure(
  authService: Partial<AuthService>,
  dialogService: Partial<DialogService> = {},
): void {
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
      { provide: DialogService, useValue: dialogService },
    ],
  });
}

function setInput(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

describe('RegisterComponent', () => {
  const originalFetch = globalThis.fetch;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(textResponse(200, COMMON_LIST_FIXTURE));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    vi.useRealTimers();
  });

  describe('password validation blocks submit', () => {
    it('shows the live too-short reason and never calls AuthService.register for a weak password', async () => {
      const register = vi.fn();
      configure({ register });

      const fixture = TestBed.createComponent(RegisterComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      setInput(compiled.querySelector('input[name="username"]')!, 'alice');

      vi.useFakeTimers();
      setInput(compiled.querySelector('input[name="password"]')!, 'short1');
      await vi.advanceTimersByTimeAsync(300);
      TestBed.tick();
      vi.useRealTimers();
      await fixture.whenStable();

      const hint = compiled.querySelector('.register__password .hk-field__msg--error');
      expect(hint?.textContent?.trim()).toBe(authEn.validation.tooShort);

      // `hk-button` blocks an action that is not available: aria-disabled, reason in the hint.
      const submit = compiled.querySelector<HTMLButtonElement>('.register__submit')!;
      expect(submit.getAttribute('aria-disabled')).toBe('true');
      submit.click();

      // Defense-in-depth: even a direct submit event (bypassing the disabled button, as Enter
      // would) must not call through to AuthService.
      compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      expect(register).not.toHaveBeenCalled();
    });
  });

  const SIX_CODES = [
    'AAAAA-11111',
    'BBBBB-22222',
    'CCCCC-33333',
    'DDDDD-44444',
    'EEEEE-55555',
    'FFFFF-66666',
  ];

  describe('happy path: reaches the codes step', () => {
    async function registerToCodesStep(dialogService: Partial<DialogService> = {}): Promise<{
      fixture: ComponentFixture<RegisterComponent>;
      compiled: HTMLElement;
      register: ReturnType<typeof vi.fn>;
    }> {
      const register = vi.fn().mockResolvedValue({ recoveryCodes: SIX_CODES });
      configure({ register }, dialogService);

      const fixture = TestBed.createComponent(RegisterComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      setInput(compiled.querySelector('input[name="username"]')!, 'alice');
      vi.useFakeTimers();
      setInput(compiled.querySelector('input[name="password"]')!, 'a-strong-unique-passphrase');
      await vi.advanceTimersByTimeAsync(300);
      TestBed.tick();
      await fixture.whenStable();
      vi.useRealTimers();

      compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();

      return { fixture, compiled, register };
    }

    it('calls AuthService.register and renders the 6 grouped recovery codes', async () => {
      const { compiled, register } = await registerToCodesStep();

      expect(register).toHaveBeenCalledWith(
        'alice',
        'a-strong-unique-passphrase',
        expect.any(String),
      );

      const codes = Array.from(compiled.querySelectorAll('.register__code')).map((el) =>
        el.textContent?.trim(),
      );
      expect(codes).toEqual(SIX_CODES);
    });

    it('moves focus to the codes-step heading (a11y cue that the page changed, not left on the removed submit button)', async () => {
      const { compiled } = await registerToCodesStep();
      const heading = compiled.querySelector('.register__title');
      expect(heading).toBeTruthy();
      expect(document.activeElement).toBe(heading);
    });

    it('Continue is disabled until the "I saved my codes" checkbox is checked, then navigates to /characters', async () => {
      const { fixture, compiled } = await registerToCodesStep();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const continueButton = compiled.querySelector<HTMLButtonElement>('.register__continue')!;
      expect(continueButton.getAttribute('aria-disabled')).toBe('true');
      continueButton.click();
      await fixture.whenStable();
      expect(navigateSpy).not.toHaveBeenCalled();

      const checkbox = compiled.querySelector<HTMLInputElement>(
        '.register__confirm-field input[type="checkbox"]',
      )!;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(continueButton.getAttribute('aria-disabled')).toBeNull();

      continueButton.click();
      await fixture.whenStable();
      expect(navigateSpy).toHaveBeenCalledWith(['/characters']);
    });

    it('the copy button writes the newline-joined codes to the clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      const { compiled } = await registerToCodesStep();
      const copyButton = Array.from(compiled.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === authEn.register.codesStep.copy,
      )!;
      copyButton.click();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith(SIX_CODES.join('\n'));
    });

    it('the download button creates a Blob URL and triggers an anchor download', async () => {
      // jsdom doesn't implement `URL.createObjectURL`/`revokeObjectURL` at all — assigned
      // directly on the REAL `URL` constructor (never replaced wholesale via `vi.stubGlobal`,
      // which would break Angular's own internal `new URL(...)` usage, e.g. its router/navigation
      // test harness) and restored in `finally` below. Read/written through a property-typed
      // (arrow-function-shaped) view of `URL` rather than the lib's method-syntax declaration, so
      // this doesn't trip `@typescript-eslint/unbound-method` on a plain static-function read.
      const urlStatics = URL as unknown as {
        createObjectURL?: (obj: Blob) => string;
        revokeObjectURL?: (url: string) => void;
      };
      const originalCreate = urlStatics.createObjectURL;
      const originalRevoke = urlStatics.revokeObjectURL;
      const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
      const revokeObjectURL = vi.fn();
      urlStatics.createObjectURL = createObjectURL;
      urlStatics.revokeObjectURL = revokeObjectURL;
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      try {
        const { compiled } = await registerToCodesStep();
        const downloadButton = Array.from(
          compiled.querySelectorAll<HTMLButtonElement>('button'),
        ).find((b) => b.textContent?.trim() === authEn.register.codesStep.download)!;
        downloadButton.click();

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      } finally {
        urlStatics.createObjectURL = originalCreate;
        urlStatics.revokeObjectURL = originalRevoke;
        clickSpy.mockRestore();
      }
    });

    describe('leaving the codes step without confirming', () => {
      it('canDeactivate opens a confirm dialog and blocks navigation when the user chooses to stay', async () => {
        const open = vi.fn().mockReturnValue({ closed: Promise.resolve(false), close: vi.fn() });
        const { fixture } = await registerToCodesStep({ open });

        const canLeave = await fixture.componentInstance.canDeactivate();
        expect(open).toHaveBeenCalledWith(expect.anything());
        expect(canLeave).toBe(false);
      });

      it('canDeactivate resolves true and does not prompt again once the user confirms via Continue', async () => {
        const { fixture, compiled } = await registerToCodesStep();
        const checkbox = compiled.querySelector<HTMLInputElement>(
          '.register__confirm-field input[type="checkbox"]',
        )!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
        await fixture.whenStable();

        const router = TestBed.inject(Router);
        vi.spyOn(router, 'navigate').mockResolvedValue(true);
        compiled.querySelector<HTMLButtonElement>('.register__continue')!.click();
        await fixture.whenStable();

        const canLeave = await fixture.componentInstance.canDeactivate();
        expect(canLeave).toBe(true);
      });

      it('canDeactivate returns true synchronously (no dialog) while still on the form step', async () => {
        const open = vi.fn();
        configure({ register: vi.fn() }, { open });
        const fixture = TestBed.createComponent(RegisterComponent);
        await fixture.whenStable();

        expect(fixture.componentInstance.canDeactivate()).toBe(true);
        expect(open).not.toHaveBeenCalled();
      });
    });
  });

  describe('AU01 leaf', () => {
    async function mountForm() {
      configure({ register: vi.fn() });
      const fixture = TestBed.createComponent(RegisterComponent);
      await fixture.whenStable();
      TestBed.tick();
      return { fixture, compiled: fixture.nativeElement as HTMLElement };
    }

    async function typePassword(
      fixture: ComponentFixture<RegisterComponent>,
      compiled: HTMLElement,
      password: string,
    ) {
      setInput(compiled.querySelector('input[name="username"]')!, 'alice');
      vi.useFakeTimers();
      setInput(compiled.querySelector('input[name="password"]')!, password);
      await vi.advanceTimersByTimeAsync(300);
      TestBed.tick();
      vi.useRealTimers();
      await fixture.whenStable();
    }

    it('shows the rules before anything is typed, linked to their fields', async () => {
      const { compiled } = await mountForm();

      const hintOfField = (name: string) => {
        const input = compiled.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        return compiled.querySelector(`#${input.getAttribute('aria-describedby')}`)?.textContent;
      };
      expect(hintOfField('username')?.trim()).toBe(authEn.register.usernameHint);
      expect(hintOfField('password')?.trim()).toBe(authEn.register.passwordHint);
      expect(hintOfField('deviceLabel')?.trim()).toBe(authEn.register.deviceLabelHint);
    });

    it('carries the primary button in the form’s own strap; the page strap keeps Back and Help', async () => {
      const { compiled } = await mountForm();

      expect(compiled.querySelector('form [data-auth-strap] button[type="submit"]')).toBe(
        compiled.querySelector('.register__submit'),
      );
      const strap = TestBed.inject(ActionStrapService).config()!;
      expect(strap.exit?.map((a) => a.id)).toEqual(['back']);
      expect(strap.primary).toEqual([]);
      expect(strap.secondary?.map((a) => a.id)).toEqual(['help']);
    });

    it('explains in the button hint why Create account is not available yet', async () => {
      const { compiled } = await mountForm();

      expect(hintOf(compiled.querySelector('.register__submit')!)).toBe(
        authEn.register.reasonIncomplete,
      );
    });

    it('draws a strength meter that tracks the verdict, with a hint that counts characters', async () => {
      const { fixture, compiled } = await mountForm();
      expect(compiled.querySelector('.register__strength')).toBeNull();

      await typePassword(fixture, compiled, 'short1');
      let meter = compiled.querySelector<HTMLElement>('.register__strength')!;
      expect(meter.getAttribute('role')).toBe('meter');
      expect(meter.dataset['state']).toBe('weak');
      expect(meter.getAttribute('aria-valuenow')).toBe('6');

      await typePassword(fixture, compiled, 'a-strong-unique-passphrase');
      meter = compiled.querySelector<HTMLElement>('.register__strength')!;
      expect(meter.dataset['state']).toBe('ok');
      expect(meter.getAttribute('aria-valuenow')).toBe('26');
      expect(meter.getAttribute('aria-valuetext')).toBe('26 characters, not a common password');
      expect(compiled.querySelector('.register__strength-label')?.textContent?.trim()).toBe(
        authEn.register.strengthOk,
      );
    });

    it('re-enables Create account once the username and password pass', async () => {
      const { fixture, compiled } = await mountForm();
      const submit = compiled.querySelector<HTMLButtonElement>('.register__submit')!;
      expect(submit.getAttribute('aria-disabled')).toBe('true');

      await typePassword(fixture, compiled, 'a-strong-unique-passphrase');

      expect(submit.getAttribute('aria-disabled')).toBeNull();
      expect(hintOf(submit)).toBeNull();
    });

    it('shows an invalid username under its field as soon as it is typed', async () => {
      const { fixture, compiled } = await mountForm();

      setInput(compiled.querySelector('input[name="username"]')!, 'no spaces!');
      await fixture.whenStable();

      expect(
        compiled.querySelector('.register__username .hk-field__msg--error')?.textContent,
      ).toContain(authEn.validation.invalidUsername);
    });

    it('shows a taken username under the username field after submit', async () => {
      const { ApiError } = await import('@shared/services/api/api-fetch');
      configure({ register: vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'taken')) });
      const fixture = TestBed.createComponent(RegisterComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      await typePassword(fixture, compiled, 'a-strong-unique-passphrase');

      compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();

      const username = compiled.querySelector<HTMLInputElement>('input[name="username"]')!;
      const message = compiled.querySelector('.register__username [role="alert"]');
      expect(message?.textContent?.trim()).toBe(authEn.errors.usernameTaken);
      expect(username.getAttribute('aria-invalid')).toBe('true');
    });

    it('shows any other failure in the form, not under a field', async () => {
      const { ApiError } = await import('@shared/services/api/api-fetch');
      configure({
        register: vi.fn().mockRejectedValue(new ApiError(0, 'network_error', 'offline')),
      });
      const fixture = TestBed.createComponent(RegisterComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      await typePassword(fixture, compiled, 'a-strong-unique-passphrase');

      compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();

      expect(compiled.querySelector('.register__error')?.textContent?.trim()).toBe(
        authEn.errors.network,
      );
      expect(compiled.querySelector('.register__username [role="alert"]')).toBeNull();
    });

    describe('codes step', () => {
      async function toCodes(dialog: Partial<DialogService> = {}) {
        const register = vi.fn().mockResolvedValue({ recoveryCodes: SIX_CODES });
        configure({ register }, dialog);
        const fixture = TestBed.createComponent(RegisterComponent);
        await fixture.whenStable();
        const compiled = fixture.nativeElement as HTMLElement;
        await typePassword(fixture, compiled, 'a-strong-unique-passphrase');
        compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        await fixture.whenStable();
        return { fixture, compiled };
      }

      it('lists the codes in a labelled list and says each works once', async () => {
        const { compiled } = await toCodes();

        const list = compiled.querySelector('.register__codes')!;
        expect(list.getAttribute('aria-label')).toBe(authEn.register.codesStep.listLabel);
        expect(compiled.querySelector('.register__codes-once')?.textContent?.trim()).toBe(
          authEn.register.codesStep.once,
        );
      });

      it('keeps Continue in the leaf’s strap and explains why it is not available yet', async () => {
        const { compiled } = await toCodes();

        expect(compiled.querySelector('[data-auth-strap] .register__continue')).not.toBeNull();
        expect(hintOf(compiled.querySelector('.register__continue')!)).toBe(
          authEn.register.codesStep.reasonUnchecked,
        );
      });

      it('copying toasts that the codes were copied', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const { compiled } = await toCodes();
        const show = vi
          .spyOn(TestBed.inject(ToastService), 'show')
          .mockImplementation(() => undefined);

        compiled.querySelector<HTMLButtonElement>('.register__copy')!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(writeText).toHaveBeenCalledWith(SIX_CODES.join('\n'));
        expect(show).toHaveBeenCalledWith('auth.register.codesStep.copied');
      });

      it('a clipboard that refuses toasts a failure instead of an unhandled rejection', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('denied'));
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const { compiled } = await toCodes();
        const show = vi
          .spyOn(TestBed.inject(ToastService), 'show')
          .mockImplementation(() => undefined);

        compiled.querySelector<HTMLButtonElement>('.register__copy')!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(show).toHaveBeenCalledWith('auth.register.codesStep.copy-failed');
      });

      it('two exits while the leave prompt is open ask once and share the answer', async () => {
        let answer!: (stay: boolean) => void;
        const open = vi.fn().mockReturnValue({
          closed: new Promise<boolean>((resolve) => (answer = resolve)),
          close: vi.fn(),
        });
        const { fixture } = await toCodes({ open });

        const first = fixture.componentInstance.canDeactivate();
        const second = fixture.componentInstance.canDeactivate();
        answer(false);

        expect(open).toHaveBeenCalledTimes(1);
        expect(await first).toBe(false);
        expect(await second).toBe(false);
      });
    });
  });
});
