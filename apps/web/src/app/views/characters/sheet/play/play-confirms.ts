import { Component, inject } from '@angular/core';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';

/** Same-content-provider pattern as `TimelineRevertConfirmComponent`: `DialogService.open()`
 * attaches this under a NEW injector rooted at the app's root, so it reads the global (unscoped)
 * `*transloco` lookup, safe because the `characters` scope is already loaded by the time this
 * dialog can open (its only caller loaded it first). B9b restyles it on `hk-dialog` (DL05). */
@Component({
  selector: 'app-note-delete-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="note-delete-confirm__title" data-dialog-title>
        {{ t('characters.sheet.notes.deleteConfirm.title') }}
      </h2>
      <p class="note-delete-confirm__body">{{ t('characters.sheet.notes.deleteConfirm.body') }}</p>
      <div class="note-delete-confirm__actions">
        <button hk-button type="button" [variant]="'ghost'" (click)="cancel()">
          {{ t('characters.sheet.notes.deleteConfirm.cancel') }}
        </button>
        <button hk-button type="button" [variant]="'danger'" (click)="confirm()">
          {{ t('characters.sheet.notes.deleteConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class NoteDeleteConfirmComponent {
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

/** Same pattern for the inventory remove confirm (`true`/`false` close result). */
@Component({
  selector: 'app-item-remove-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="item-remove-confirm__title" data-dialog-title>
        {{ t('characters.sheet.inventory.deleteConfirm.title') }}
      </h2>
      <p class="item-remove-confirm__body">
        {{ t('characters.sheet.inventory.deleteConfirm.body') }}
      </p>
      <div class="item-remove-confirm__actions">
        <button hk-button type="button" [variant]="'ghost'" (click)="cancel()">
          {{ t('characters.sheet.inventory.deleteConfirm.cancel') }}
        </button>
        <button hk-button type="button" [variant]="'danger'" (click)="confirm()">
          {{ t('characters.sheet.inventory.deleteConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class ItemRemoveConfirmComponent {
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}
