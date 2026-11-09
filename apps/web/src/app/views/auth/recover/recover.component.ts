import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import {
  authErrorKey,
  AuthService,
  isValidUsername,
  passwordVerdictKey,
} from '@shared/services/auth/auth.service';
import { checkPassword, type PasswordVerdict } from '@shared/services/auth/password-check';
import { normalizeRecoveryCode } from '@shared/services/auth/recovery-code';
import { IconComponent } from '../../../shared/icons/icon.component';
import { HkBannerComponent } from '../../../ui/banner/banner.component';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkTextFieldComponent } from '../../../ui/text-field/text-field.component';
import { AuthCardComponent } from '../auth-card.component';
import { useAuthPage } from '../auth-page';

type LiveVerdict = 'idle' | 'pending' | PasswordVerdict;

const PASSWORD_CHECK_DEBOUNCE_MS = 300;

/** A refused or used-up code is the one failure that belongs under the code field. */
const CODE_ERROR_KEY = 'errors.invalidCredentials';
const USERNAME_ERROR_KEY = 'validation.invalidUsername';

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
 *
 * Board AU01: a centred leaf whose own leather strap carries Reset password (blocked, with its
 * reason in the hint, until every field is valid); the page strap keeps Back and Help.
 */
@Component({
  selector: 'app-recover',
  imports: [
    TranslocoDirective,
    RouterLink,
    AuthCardComponent,
    HkBannerComponent,
    HkButtonComponent,
    HkTextFieldComponent,
    IconComponent,
  ],
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
  /** What the new-password field says under it when there is no error: its rules, progress or approval. */
  protected readonly passwordHintKey = computed(() => {
    if (this.passwordVerdict() === 'pending') return 'validation.checking';
    return this.passwordOk() ? 'validation.ok' : 'recover.newPasswordHint';
  });

  protected readonly usernameErrorKey = computed(() => {
    const invalid = this.username().length > 0 && !this.usernameValid();
    return invalid || this.errorKey() === USERNAME_ERROR_KEY ? USERNAME_ERROR_KEY : undefined;
  });
  protected readonly codeErrorKey = computed(() =>
    this.errorKey() === CODE_ERROR_KEY ? CODE_ERROR_KEY : undefined,
  );
  protected readonly formErrorKey = computed(() => {
    const key = this.errorKey();
    return key === undefined || key === CODE_ERROR_KEY || key === USERNAME_ERROR_KEY
      ? undefined
      : key;
  });

  constructor() {
    useAuthPage();
  }

  protected onCodeInput(value: string): void {
    this.code.set(value);
    this.errorKey.set(undefined);
  }

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
