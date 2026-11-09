import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { DialogRef, type DialogService } from '@app/ui/dialog/dialog.service';
import { HkButtonComponent } from '../../../ui/button/button.component';

/**
 * The one "discard your changes?" question every dirty campaign form asks before it is left (join,
 * house rules, and the create dialog's own inline copy of it). Closes `true` to discard and
 * `false` to keep editing. Opened by `DialogService` at the root injector, so its keys are full
 * `campaigns.*` keys; the `campaigns` scope is always loaded by the screens that open it.
 */
@Component({
  selector: 'app-discard-changes-dialog',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="discard-changes-dialog__title" data-dialog-title>
        {{ t('campaigns.discard.title') }}
      </h2>
      <p class="discard-changes-dialog__body">{{ t('campaigns.discard.body') }}</p>
      <div class="discard-changes-dialog__actions" data-dialog-actions>
        <button hk-button type="button" [variant]="'ghost-leather'" (click)="close(false)">
          {{ t('campaigns.discard.keep') }}
        </button>
        <button hk-button type="button" [variant]="'ember'" (click)="close(true)">
          {{ t('campaigns.discard.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class DiscardChangesDialogComponent {
  private readonly dialogRef = inject(DialogRef);

  protected close(discard: boolean): void {
    this.dialogRef.close(discard);
  }
}

/** Opens the discard question and resolves `true` when the user chose to discard. */
export async function askToDiscard(dialogs: DialogService): Promise<boolean> {
  const handle = dialogs.open(DiscardChangesDialogComponent);
  return (await handle.closed) === true;
}
