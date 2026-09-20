import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { AuthService } from '@shared/services/auth/auth.service';
import authEn from '../../../../assets/i18n/auth/en.json';
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

      const hint = compiled.querySelector('.register__hint--error');
      expect(hint?.textContent?.trim()).toBe(authEn.validation.tooShort);

      const submit = compiled.querySelector<HTMLButtonElement>('.register__submit')!;
      expect(submit.disabled).toBe(true);

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

    it('Continue is disabled until the "I saved my codes" checkbox is checked, then navigates to /characters', async () => {
      const { fixture, compiled } = await registerToCodesStep();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const continueButton = compiled.querySelector<HTMLButtonElement>('.register__continue')!;
      expect(continueButton.disabled).toBe(true);

      const checkbox = compiled.querySelector<HTMLInputElement>(
        '.register__confirm-field input[type="checkbox"]',
      )!;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(continueButton.disabled).toBe(false);

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
});
