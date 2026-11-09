import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { DialogRef } from '../../../../ui/dialog/dialog.service';

/*
 * The sheet's confirm dialogs (board DL05): a parchment `hk-dialog` with the title, one sentence
 * and a leather action strap, "keep" on the left and the destructive verb as an ember button.
 * Each closes with `true` (confirmed) or `false` (kept); Escape and the backdrop close with
 * `undefined`, which every caller treats as "kept". `DialogService.open()` attaches them under a
 * NEW injector rooted at the app's root, so they read the global (unscoped) `*transloco` lookup,
 * safe because the `characters` scope is already loaded by the time any of them can open.
 */

/** Remove a note (notes drawer). */
@Component({
  selector: 'app-note-delete-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="note-delete-confirm__title" data-dialog-title>
        {{ t('characters.sheet.notes.deleteConfirm.title') }}
      </h2>
      <p class="note-delete-confirm__body">{{ t('characters.sheet.notes.deleteConfirm.body') }}</p>
      <div class="note-delete-confirm__actions" data-dialog-actions>
        <button hk-button type="button" [variant]="'ghost-leather'" (click)="cancel()">
          {{ t('characters.sheet.notes.deleteConfirm.cancel') }}
        </button>
        <button hk-button type="button" [variant]="'ember'" (click)="confirm()">
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

/** Remove an inventory item (bag). */
@Component({
  selector: 'app-item-remove-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="item-remove-confirm__title" data-dialog-title>
        {{ t('characters.sheet.inventory.deleteConfirm.title') }}
      </h2>
      <p class="item-remove-confirm__body">
        {{ t('characters.sheet.inventory.deleteConfirm.body') }}
      </p>
      <div class="item-remove-confirm__actions" data-dialog-actions>
        <button hk-button type="button" [variant]="'ghost-leather'" (click)="cancel()">
          {{ t('characters.sheet.inventory.deleteConfirm.cancel') }}
        </button>
        <button hk-button type="button" [variant]="'ember'" (click)="confirm()">
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

/** Clear the roll log (roll-log drawer). */
@Component({
  selector: 'app-roll-log-clear-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="roll-log-clear-confirm__title" data-dialog-title>
        {{ t('characters.sheet.roll.clearConfirm.title') }}
      </h2>
      <p class="roll-log-clear-confirm__body">
        {{ t('characters.sheet.roll.clearConfirm.body') }}
      </p>
      <div class="roll-log-clear-confirm__actions" data-dialog-actions>
        <button hk-button type="button" [variant]="'ghost-leather'" (click)="cancel()">
          {{ t('characters.sheet.roll.clearConfirm.cancel') }}
        </button>
        <button hk-button type="button" [variant]="'ember'" (click)="confirm()">
          {{ t('characters.sheet.roll.clearConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class RollLogClearConfirmComponent {
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}
