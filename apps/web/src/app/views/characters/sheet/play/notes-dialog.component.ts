import { Component, inject } from '@angular/core';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { PlayActionsService } from './play-actions.service';

/**
 * The notes list opened from the sheet strap (B9a): the character's notes with Add / Edit / Remove,
 * each opening the EXISTING note dialog (`NoteDialogComponent`, remove behind its confirm). Notes
 * are freeform stream state (`Facts.notes`), read through `PlayActionsService.notes`. B9b replaces
 * this host with the notes drawer and its inline editor (board D01).
 */
@Component({
  selector: 'app-notes-dialog',
  providers: [provideTranslocoScope('characters')],
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="notes-dialog__title" data-dialog-title>
        {{ t('characters.sheet.notes.title') }}
      </h2>
      <button
        hk-button
        type="button"
        class="notes-dialog__add"
        [disabledReason]="actions.editLocked() ? t('characters.sheet.editLocked') : null"
        (click)="actions.addNote()"
      >
        {{ t('characters.sheet.notes.add') }}
      </button>
      @if (actions.notes().length > 0) {
        <ul class="notes-dialog__list">
          @for (note of actions.notes(); track note.id) {
            <li class="notes-dialog__note">
              <h3 class="notes-dialog__note-title">
                {{ note.title || t('characters.sheet.notes.untitled') }}
              </h3>
              @if (note.body) {
                <p class="notes-dialog__note-body">{{ note.body }}</p>
              }
              <div class="notes-dialog__note-actions">
                <button
                  hk-button
                  type="button"
                  [variant]="'ghost'"
                  [disabledReason]="actions.editLocked() ? t('characters.sheet.editLocked') : null"
                  (click)="actions.editNote(note)"
                >
                  {{ t('characters.sheet.notes.edit') }}
                </button>
                <button
                  hk-button
                  type="button"
                  [variant]="'ghost'"
                  [disabledReason]="actions.editLocked() ? t('characters.sheet.editLocked') : null"
                  (click)="actions.removeNote(note)"
                >
                  {{ t('characters.sheet.notes.remove') }}
                </button>
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="notes-dialog__empty">{{ t('characters.sheet.notes.empty') }}</p>
      }
      <div class="notes-dialog__actions">
        <button hk-button type="button" [variant]="'ghost'" (click)="close()">
          {{ t('characters.sheet.roll.close') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class NotesDialogComponent {
  protected readonly actions = inject(PlayActionsService);
  private readonly dialogRef = inject(DialogRef);

  protected close(): void {
    this.dialogRef.close();
  }
}
