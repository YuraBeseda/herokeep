import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { DialogRef } from '../../../ui/dialog/dialog.service';

/**
 * The "leave without creating?" question the wizard's Cancel asks once something has been entered
 * or chosen. A dialog's content is attached at the app root injector (`DialogService`), so it reads
 * the global key space (`characters.wizard.cancel.*`, loaded by the wizard) instead of declaring a
 * scope of its own. Closes `true` (discard and leave) or `false` / dismissed (keep editing).
 */
@Component({
  selector: 'app-cancel-wizard-dialog',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="cancel-wizard__title" data-dialog-title>
        {{ t('characters.wizard.cancel.title') }}
      </h2>
      <p class="cancel-wizard__message">{{ t('characters.wizard.cancel.message') }}</p>
      <div class="cancel-wizard__actions">
        <button hk-button type="button" [variant]="'ghost'" (click)="stay()">
          {{ t('characters.wizard.cancel.stay') }}
        </button>
        <button hk-button type="button" [variant]="'ember'" (click)="leave()">
          {{ t('characters.wizard.cancel.leave') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    .cancel-wizard__title {
      margin: 0 0 var(--space-2);
    }

    .cancel-wizard__message {
      margin: 0 0 var(--space-4);
    }

    .cancel-wizard__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--space-2);
    }
  `,
})
export class CancelWizardDialogComponent {
  private readonly dialogRef = inject(DialogRef);

  protected stay(): void {
    this.dialogRef.close(false);
  }

  protected leave(): void {
    this.dialogRef.close(true);
  }
}
