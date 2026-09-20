import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  authErrorKey,
  AuthService,
  isValidUsername,
  passwordVerdictKey,
} from '@shared/services/auth/auth.service';
import { checkPassword, type PasswordVerdict } from '@shared/services/auth/password-check';
import { normalizeRecoveryCode } from '@shared/services/auth/recovery-code';

type LiveVerdict = 'idle' | 'pending' | PasswordVerdict;

const PASSWORD_CHECK_DEBOUNCE_MS = 300;

/**
 * `/recover` (task-5-brief.md): username + one recovery code + new password (same live
 * `checkPassword` verdicts as `RegisterComponent`) → `AuthService.reset`, which burns the code,
 * sets the new credentials, and auto-logs-in (`reset()`'s own doc comment) — so success here
 * routes straight to `/characters`, same as login/register.
 *
 * The code field accepts BOTH the displayed `XXXXX-XXXXX` grouped form and a raw paste
 * (any case, stray whitespace): `normalizeRecoveryCode` (mirrors
 * `apps/api/src/core/auth/recovery-codes.ts`'s server-side function exactly) runs on submit, so
 * the string actually POSTed as `recoveryCode` is already in the shape the server hashes.
 */
@Component({
  selector: 'app-recover',
  imports: [TranslocoDirective, RouterLink, ButtonComponent],
  providers: [provideTranslocoScope('auth')],
  templateUrl: './recover.component.html',
  styleUrl: './recover.component.scss',
})
export class RecoverComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly username = signal('');
  protected readonly code = signal('');
  protected readonly newPassword = signal('');

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly passwordVerdict = signal<LiveVerdict>('idle');
  private verdictToken = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly usernameValid = computed(() => isValidUsername(this.username()));
  protected readonly passwordOk = computed(() => {
    const verdict = this.passwordVerdict();
    return typeof verdict === 'object' && verdict.ok === true;
  });
  protected readonly canSubmit = computed(
    () =>
      this.usernameValid() &&
      this.passwordOk() &&
      normalizeRecoveryCode(this.code()).length > 0 &&
      !this.submitting(),
  );
  protected readonly passwordVerdictReasonKey = computed(() => {
    const verdict = this.passwordVerdict();
    if (verdict === 'idle' || verdict === 'pending' || verdict.ok) return undefined;
    return passwordVerdictKey(verdict.reason);
  });

  protected onUsernameInput(value: string): void {
    this.username.set(value);
    this.errorKey.set(undefined);
    if (this.newPassword().length > 0) {
      this.scheduleVerdict(this.newPassword());
    }
  }

  protected onPasswordInput(value: string): void {
    this.newPassword.set(value);
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

    const verdict = await checkPassword(this.newPassword(), this.username());
    this.passwordVerdict.set(verdict);
    if (!verdict.ok) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(undefined);
    try {
      const normalizedCode = normalizeRecoveryCode(this.code());
      await this.authService.reset(this.username(), normalizedCode, this.newPassword());
      await this.router.navigate(['/characters']);
    } catch (err) {
      this.errorKey.set(authErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
