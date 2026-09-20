import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogRef } from '@shared/components/dialog/dialog.service';

/**
 * The "are you sure" dialog `RegisterComponent`'s `canDeactivate` guard opens when the user tries
 * to navigate away from the recovery-codes step WITHOUT ticking "I saved my recovery codes"
 * (ADR-012: codes are shown once, never persisted client-side — leaving unconfirmed means they're
 * gone for good). Same "own injector, full unscoped keys through its own `*transloco`" pattern as
 * `NoteDialogComponent`/`ConditionDialogComponent` — a dialog's content is portal-attached at the
 * app ROOT injector (`dialog.service.ts`'s `contentInjector`), not at whatever component opened
 * it, so it reaches into the global key space rather than declaring its own scope provider for
 * one dialog's three strings.
 *
 * Closes `true` (confirmed: proceed and lose the codes) or `false`/`undefined` (stay).
 */
@Component({
  selector: 'app-confirm-leave-recovery-codes',
  imports: [TranslocoDirective, ButtonComponent],
  templateUrl: './confirm-leave-recovery-codes.component.html',
})
export class ConfirmLeaveRecoveryCodesComponent {
  private readonly dialogRef = inject(DialogRef);

  protected stay(): void {
    this.dialogRef.close(false);
  }

  protected leave(): void {
    this.dialogRef.close(true);
  }
}
