import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';

export interface NoteDialogData {
  readonly mode: 'add' | 'edit';
  readonly title?: string;
  readonly body?: string;
  /** The protocol schema's note-body cap (`NoteAddedV1.shape.body`'s Zod `.max(8192)`,
   * `@hk/protocol`) — resolved ONCE by the caller (`PlayTabComponent`, via `.unwrap().maxLength`)
   * and passed in here, never re-declared as a duplicated magic number. */
  readonly maxBodyLength: number;
}

export interface NoteDialogResult {
  readonly title?: string;
  readonly body?: string;
}

/**
 * The note add/edit dialog (task-4-brief.md) — `PlayTabComponent.onAddNote`/`onEditNote` open
 * this via `DialogService.open()`, `data.mode` picking the title only. Same "own injector, full
 * unscoped keys through its own `*transloco`" pattern as `CastDialogComponent`/
 * `ConditionDialogComponent`.
 *
 * Over-limit guard: `bodyTooLong` compares the LIVE body length against the caller-supplied
 * `maxBodyLength` — blocking `confirm()` and disabling the Save button — rather than relying on
 * the `<textarea>`'s `maxlength` attribute alone (that only constrains real typed/pasted input,
 * never a scripted `.value` assignment, so a defensive JS-side check is the only reliable gate).
 *
 * Closes with a `NoteDialogResult` (trimmed; blank fields become `undefined`, matching
 * `NoteAdded`/`NoteUpdated`'s own optional `title`/`body`) on confirm, or `undefined` on
 * cancel/ESC/backdrop.
 */
@Component({
  selector: 'app-note-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  templateUrl: './note-dialog.component.html',
})
export class NoteDialogComponent {
  protected readonly data = inject<NoteDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected readonly title = signal(this.data.title ?? '');
  protected readonly body = signal(this.data.body ?? '');

  protected readonly bodyLength = computed(() => this.body().length);
  protected readonly bodyTooLong = computed(() => this.bodyLength() > this.data.maxBodyLength);

  protected onTitleChange(value: string): void {
    this.title.set(value);
  }

  protected onBodyChange(value: string): void {
    this.body.set(value);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    if (this.bodyTooLong()) return;
    const title = this.title().trim();
    const body = this.body().trim();
    this.dialogRef.close({
      title: title || undefined,
      body: body || undefined,
    } satisfies NoteDialogResult);
  }
}
