import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { DialogRef } from '../../../ui/dialog/dialog.service';

/**
 * The "leave without leveling up?" question the level-up's Cancel asks once hit points, a choice or
 * a spell has been chosen. A dialog's content is attached at the app root injector
 * (`DialogService`), so it reads the global key space (`characters.levelUp.cancel.*`, loaded by the
 * level-up) instead of declaring a scope of its own. Closes `true` (discard and leave) or `false` /
 * dismissed (keep going).
 */
@Component({
  selector: 'app-cancel-level-up-dialog',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="cancel-level-up__title" data-dialog-title>
        {{ t('characters.levelUp.cancel.title') }}
      </h2>
      <p class="cancel-level-up__message">{{ t('characters.levelUp.cancel.message') }}</p>
      <div class="cancel-level-up__actions">
        <button hk-button type="button" [variant]="'ghost'" (click)="stay()">
          {{ t('characters.levelUp.cancel.stay') }}
        </button>
        <button hk-button type="button" [variant]="'ember'" (click)="leave()">
          {{ t('characters.levelUp.cancel.leave') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    .cancel-level-up__title {
      margin: 0 0 var(--space-2);
    }

    .cancel-level-up__message {
      margin: 0 0 var(--space-4);
    }

    .cancel-level-up__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--space-2);
    }
  `,
})
export class CancelLevelUpDialogComponent {
  private readonly dialogRef = inject(DialogRef);

  protected stay(): void {
    this.dialogRef.close(false);
  }

  protected leave(): void {
    this.dialogRef.close(true);
  }
}
