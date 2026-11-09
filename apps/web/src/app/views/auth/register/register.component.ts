import {
  afterRenderEffect,
  Component,
  computed,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import {
  authErrorKey,
  AuthService,
  isValidUsername,
  passwordVerdictKey,
} from '@shared/services/auth/auth.service';
import { defaultDeviceLabel } from '@shared/services/auth/device-label';
import { checkPassword, type PasswordVerdict } from '@shared/services/auth/password-check';
import { IconComponent } from '../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { askOnce } from '../../../ui/nav/ask-once';
import { HkTextFieldComponent } from '../../../ui/text-field/text-field.component';
import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import { AuthCardComponent } from '../auth-card.component';
import { useAuthPage } from '../auth-page';
import { ConfirmLeaveRecoveryCodesComponent } from './confirm-leave-recovery-codes.component';

/** Live password-verdict state (task-5-brief.md): `'idle'` before anything's been typed, so the
 * empty field doesn't show a spurious "too short" the instant the form mounts; `'pending'` while
 * a debounced `checkPassword` call (its own common-list fetch is async) is in flight; otherwise
 * the real `PasswordVerdict` from `password-check.ts`. */
type LiveVerdict = 'idle' | 'pending' | PasswordVerdict;

const PASSWORD_CHECK_DEBOUNCE_MS = 300;

/** Errors that belong under the username field rather than to the whole form. */
const USERNAME_ERROR_KEYS: readonly string[] = [
  'validation.invalidUsername',
  'errors.usernameTaken',
];

/** The strength gauge fills over this many characters (it is a cue, not a rule: the rules are
 * `checkPassword`'s). */
const STRENGTH_FULL_AT = 16;
/** ADR-012's upper bound, the meter's maximum. */
const PASSWORD_MAX = 128;

/**
 * `/register` (task-5-brief.md): username + password (live `checkPassword` verdicts) + device
 * label → `AuthService.register`, THEN the ADR-012 recovery-codes step — staged as component
 * state on the SAME route/component (`step`), not a second route: the six codes are returned
 * exactly once by `register()` and are never persisted client-side, so there is nothing to
 * navigate back to if the user reloads or leaves early — the `canDeactivate` guard
 * (`confirmRecoveryCodesGuard`, wired in `app.routes.ts`) is what protects against an accidental
 * loss of the still-unconfirmed codes.
 *
 * Board AU01: each step is a centred leaf whose own leather strap carries its primary button
 * (Create account; Continue); the page strap (`useAuthPage`) keeps Back and Help. Whatever a button
 * cannot do yet says why in its hint.
 */
@Component({
  selector: 'app-register',
  imports: [
    TranslocoDirective,
    RouterLink,
    AuthCardComponent,
    HkButtonComponent,
    HkTextFieldComponent,
    HkTooltipDirective,
    IconComponent,
  ],
  providers: [provideTranslocoScope('auth')],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);

  // Step state
  protected readonly step = signal<'form' | 'codes'>('form');

  // Fix-round finding (a11y): the codes step swaps in as a branch replacing the whole form,
  // including the submit button that had focus — nothing tells a screen-reader/keyboard user the
  // page changed, and focus is left on a now-removed element. `tabindex="-1"` on the codes heading
  // (template) makes it programmatically focusable without adding it to the normal tab order;
  // `afterRenderEffect` (reactive to `step`) moves focus there once the view has actually rendered
  // the codes-step branch, same "move focus to the new content's heading" pattern a step-based
  // wizard should follow.
  private readonly codesHeading = viewChild<ElementRef<HTMLElement>>('codesHeading');

  constructor() {
    useAuthPage();
    afterRenderEffect(() => {
      if (this.step() === 'codes') {
        this.codesHeading()?.nativeElement.focus();
      }
    });
  }

  // Form fields
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly deviceLabel = signal(defaultDeviceLabel());

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  // Live password verdict (debounced `checkPassword`)
  protected readonly passwordVerdict = signal<LiveVerdict>('idle');
  private verdictToken = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly usernameValid = computed(() => isValidUsername(this.username()));
  protected readonly passwordOk = computed(() => {
    const verdict = this.passwordVerdict();
    return typeof verdict === 'object' && verdict.ok === true;
  });
  protected readonly canSubmit = computed(
    () => this.usernameValid() && this.passwordOk() && !this.submitting(),
  );
  // Scope-relative validation key for the live verdict's rejection reason — `undefined` while
  // idle/pending/ok, in which case the field shows its rules or progress instead.
  protected readonly passwordVerdictReasonKey = computed(() => {
    const verdict = this.passwordVerdict();
    if (verdict === 'idle' || verdict === 'pending' || verdict.ok) return undefined;
    return passwordVerdictKey(verdict.reason);
  });
  /** What the password field says under it when there is no error: its rules, progress or approval. */
  protected readonly passwordHintKey = computed(() => {
    const verdict = this.passwordVerdict();
    if (verdict === 'pending') return 'validation.checking';
    if (this.passwordOk()) return 'validation.ok';
    return 'register.passwordHint';
  });

  // Username errors: typing an invalid name shows it at once; a taken name (or a refused one) after submit.
  protected readonly usernameErrorKey = computed(() => {
    if (this.username().length > 0 && !this.usernameValid()) return 'validation.invalidUsername';
    const key = this.errorKey();
    return key !== undefined && USERNAME_ERROR_KEYS.includes(key) ? key : undefined;
  });
  protected readonly formErrorKey = computed(() => {
    const key = this.errorKey();
    return key !== undefined && !USERNAME_ERROR_KEYS.includes(key) ? key : undefined;
  });

  // Strength gauge (a cue; `checkPassword` stays the rule)
  protected readonly strengthLength = computed(() =>
    Math.min(this.password().length, PASSWORD_MAX),
  );
  protected readonly strengthPercent = computed(() =>
    Math.round(Math.min(this.password().length / STRENGTH_FULL_AT, 1) * 100),
  );
  protected readonly strengthState = computed<'ok' | 'weak' | 'checking'>(() => {
    if (this.passwordVerdict() === 'pending') return 'checking';
    return this.passwordOk() ? 'ok' : 'weak';
  });
  protected readonly strengthLabelKey = computed(() => {
    const state = this.strengthState();
    if (state === 'ok') return 'register.strengthOk';
    return state === 'checking' ? 'register.strengthChecking' : 'register.strengthWeak';
  });
  protected readonly strengthTextKey = computed(() =>
    this.strengthState() === 'ok' ? 'register.strengthTip' : 'register.strengthTipWeak',
  );

  // Codes step
  protected readonly recoveryCodes = signal<string[]>([]);
  protected readonly codesConfirmed = signal(false);
  // Set the instant the user proceeds past the codes step with the checkbox ticked — read by
  // `canDeactivate()` so a NAVIGATION TRIGGERED BY `onContinue()` itself never re-prompts.
  private leaveConfirmed = false;

  protected onUsernameInput(value: string): void {
    this.username.set(value);
    this.errorKey.set(undefined);
    // The `contains-username` verdict depends on `username`, so re-run the live check whenever
    // it changes and a password has already been typed — otherwise editing the username after
    // typing the password could leave a stale verdict on screen.
    if (this.password().length > 0) {
      this.scheduleVerdict(this.password());
    }
  }

  protected onPasswordInput(value: string): void {
    this.password.set(value);
    this.errorKey.set(undefined);
    this.scheduleVerdict(value);
  }

  private scheduleVerdict(password: string): void {
    clearTimeout(this.debounceTimer);
    if (password.length === 0) {
      this.passwordVerdict.set('idle');
      return;
    }
    this.passwordVerdict.set('pending');
    const token = ++this.verdictToken;
    this.debounceTimer = setTimeout(() => {
      void checkPassword(password, this.username()).then((verdict) => {
        if (token === this.verdictToken) {
          this.passwordVerdict.set(verdict);
        }
      });
    }, PASSWORD_CHECK_DEBOUNCE_MS);
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;

    if (!this.usernameValid()) {
      this.errorKey.set('validation.invalidUsername');
      return;
    }

    // Re-check right before submitting (defense in depth against a still-pending debounce —
    // the submit button is already blocked while `!canSubmit()`, but Enter on a text field
    // still fires a form `submit` event regardless of the button's state).
    const verdict = await checkPassword(this.password(), this.username());
    this.passwordVerdict.set(verdict);
    if (!verdict.ok) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(undefined);
    try {
      const result = await this.authService.register(
        this.username(),
        this.password(),
        this.deviceLabel(),
      );
      this.recoveryCodes.set(result.recoveryCodes);
      this.step.set('codes');
    } catch (err) {
      this.errorKey.set(authErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async onCopyCodes(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.recoveryCodes().join('\n'));
      this.toastService.show('auth.register.codesStep.copied');
    } catch {
      this.toastService.show('auth.register.codesStep.copy-failed');
    }
  }

  protected onDownloadCodes(): void {
    const blob = new Blob([`${this.recoveryCodes().join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'herokeep-recovery-codes.txt';
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  protected async onContinue(): Promise<void> {
    if (!this.codesConfirmed()) return;
    this.leaveConfirmed = true;
    await this.router.navigate(['/characters']);
  }

  /** The leave prompt, asked once however many exits start while it is open (Back, a tab, the
   * browser's back button): they all share its answer instead of stacking a second dialog. */
  private readonly askLeave = askOnce(async () => {
    const handle = this.dialogService.open(ConfirmLeaveRecoveryCodesComponent);
    return (await handle.closed) === true;
  });

  /** `confirmRecoveryCodesGuard` (`app.routes.ts`)'s `CanDeactivateFn` delegate. Allows
   * navigation straight through unless the user is sitting on the unconfirmed codes step, in
   * which case it opens `ConfirmLeaveRecoveryCodesComponent` and waits on the dialog's result. */
  canDeactivate(): boolean | Promise<boolean> {
    if (this.step() !== 'codes' || this.leaveConfirmed) return true;
    return this.askLeave();
  }
}
