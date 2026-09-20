import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import {
  authErrorKey,
  AuthService,
  isValidUsername,
  passwordVerdictKey,
} from '@shared/services/auth/auth.service';
import { defaultDeviceLabel } from '@shared/services/auth/device-label';
import { checkPassword, type PasswordVerdict } from '@shared/services/auth/password-check';
import { ConfirmLeaveRecoveryCodesComponent } from './confirm-leave-recovery-codes.component';

/** Live password-verdict state (task-5-brief.md): `'idle'` before anything's been typed, so the
 * empty field doesn't show a spurious "too short" the instant the form mounts; `'pending'` while
 * a debounced `checkPassword` call (its own common-list fetch is async) is in flight; otherwise
 * the real `PasswordVerdict` from `password-check.ts`. */
type LiveVerdict = 'idle' | 'pending' | PasswordVerdict;

const PASSWORD_CHECK_DEBOUNCE_MS = 300;

/**
 * `/register` (task-5-brief.md): username + password (live `checkPassword` verdicts) + device
 * label → `AuthService.register`, THEN the ADR-012 recovery-codes step — staged as component
 * state on the SAME route/component (`step`), not a second route: the six codes are returned
 * exactly once by `register()` and are never persisted client-side, so there is nothing to
 * navigate back to if the user reloads or leaves early — the `canDeactivate` guard
 * (`confirmRecoveryCodesGuard`, wired in `app.routes.ts`) is what protects against an accidental
 * loss of the still-unconfirmed codes.
 */
@Component({
  selector: 'app-register',
  imports: [TranslocoDirective, RouterLink, ButtonComponent],
  providers: [provideTranslocoScope('auth')],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialogService = inject(DialogService);

  // Step state
  protected readonly step = signal<'form' | 'codes'>('form');

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
  // idle/pending/ok, in which case the template shows no reason text (a separate pending
  // indicator covers the "checking" state).
  protected readonly passwordVerdictReasonKey = computed(() => {
    const verdict = this.passwordVerdict();
    if (verdict === 'idle' || verdict === 'pending' || verdict.ok) return undefined;
    return passwordVerdictKey(verdict.reason);
  });

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
    // the submit button is already disabled while `!canSubmit()`, but Enter on a text field
    // still fires a form `submit` event regardless of the button's `disabled` state).
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
    await navigator.clipboard.writeText(this.recoveryCodes().join('\n'));
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

  /** `confirmRecoveryCodesGuard` (`app.routes.ts`)'s `CanDeactivateFn` delegate. Allows
   * navigation straight through unless the user is sitting on the unconfirmed codes step, in
   * which case it opens `ConfirmLeaveRecoveryCodesComponent` and waits on the dialog's result. */
  canDeactivate(): boolean | Promise<boolean> {
    if (this.step() !== 'codes' || this.leaveConfirmed) return true;
    const handle = this.dialogService.open(ConfirmLeaveRecoveryCodesComponent);
    return handle.closed.then((result) => result === true);
  }
}
