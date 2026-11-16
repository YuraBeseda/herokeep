import { Component, inject, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { authErrorKey, AuthService } from '@shared/services/auth/auth.service';
import { HkButtonComponent } from '../../ui/button/button.component';
import { HkRecoveryCodesComponent } from '../../ui/recovery-codes/recovery-codes.component';
import { HkTextFieldComponent } from '../../ui/text-field/text-field.component';

/** Settings → Account → "New recovery codes": asks for the password (a session alone is not
 * enough), then shows the six new codes once. A wrong password shows the login error text. */
@Component({
  selector: 'app-recovery-codes-dialog',
  imports: [TranslocoDirective, HkButtonComponent, HkRecoveryCodesComponent, HkTextFieldComponent],
  providers: [provideTranslocoScope('auth')],
  template: `
    <ng-container *transloco="let t; read: 'auth'">
      <h2 class="recovery-codes-dialog__title" data-dialog-title>{{ t('regenerate.title') }}</h2>
      <p class="recovery-codes-dialog__warning">{{ t('regenerate.warning') }}</p>
      @if (codes(); as codes) {
        <p class="recovery-codes-dialog__saved">{{ t('regenerate.saved') }}</p>
        <hk-recovery-codes [codes]="codes" />
        <div data-dialog-actions>
          <button hk-button type="button" class="recovery-codes-dialog__done" (click)="close()">
            {{ t('regenerate.done') }}
          </button>
        </div>
      } @else {
        <form class="recovery-codes-dialog__form" (submit)="submit($event)">
          <p>{{ t('regenerate.intro') }}</p>
          <hk-text-field
            name="password"
            type="password"
            autocomplete="current-password"
            [label]="t('regenerate.passwordLabel')"
            [required]="true"
            [error]="errorKey() ? t(errorKey()!) : null"
            [value]="password()"
            (valueChange)="password.set($event)"
          />
          <div data-dialog-actions>
            <button hk-button type="button" [variant]="'ghost-leather'" (click)="close()">
              {{ t('regenerate.cancel') }}
            </button>
            <button
              hk-button
              type="submit"
              class="recovery-codes-dialog__submit"
              [disabled]="submitting() || password().length === 0"
            >
              {{ t('regenerate.submit') }}
            </button>
          </div>
        </form>
      }
    </ng-container>
  `,
})
export class RecoveryCodesDialogComponent {
  private readonly authService = inject(AuthService);
  private readonly dialogRef = inject(DialogRef);

  protected readonly password = signal('');
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);
  protected readonly codes = signal<string[] | null>(null);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting() || this.password().length === 0) return;
    this.submitting.set(true);
    this.errorKey.set(undefined);
    try {
      this.codes.set(await this.authService.regenerateRecoveryCodes(this.password()));
      this.password.set('');
    } catch (err) {
      this.errorKey.set(authErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
