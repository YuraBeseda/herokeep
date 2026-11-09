import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { HkTextFieldComponent } from '../../../../../ui/text-field/text-field.component';
import { HkTextareaComponent } from '../../../../../ui/textarea/textarea.component';

/** What the editor hands back on Save: trimmed, a blank field becomes `undefined` (matching
 * `NoteAdded`/`NoteUpdated`'s own optional `title`/`body`). */
export interface NoteEditorResult {
  readonly title?: string;
  readonly body?: string;
}

/**
 * The note editor (board D01): the add/edit form the notes drawer shows inline. It was the note
 * dialog (`NoteDialogComponent`); the fields, the trimming and the guard are unchanged, but it emits
 * instead of closing a dialog. It owns no store call: the drawer turns `saved` into a note event.
 *
 * Over-limit guard: `bodyTooLong` compares the LIVE body length against the caller-supplied
 * `maxBodyLength` (the protocol schema's cap, resolved once by `PlayActionsService`) and blocks
 * `save()` and the Save button, rather than relying on the textarea's `maxlength` alone (that only
 * constrains typed or pasted input, never a scripted value).
 */
@Component({
  selector: 'app-note-editor',
  imports: [TranslocoDirective, HkButtonComponent, HkTextFieldComponent, HkTextareaComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './note-editor.component.html',
  styleUrl: './note-editor.component.scss',
})
export class NoteEditorComponent {
  // Inputs
  readonly mode = input<'add' | 'edit'>('add');
  readonly title = input('');
  readonly body = input('');
  readonly maxBodyLength = input.required<number>();

  // Outputs
  readonly saved = output<NoteEditorResult>();
  readonly cancelled = output<void>();
  readonly removed = output<void>();

  protected readonly titleValue = signal('');
  protected readonly bodyValue = signal('');

  protected readonly bodyLength = computed(() => this.bodyValue().length);
  protected readonly bodyTooLong = computed(() => this.bodyLength() > this.maxBodyLength());

  constructor() {
    // Seed the fields from the inputs; the host recreates the editor for another note.
    effect(() => {
      const title = this.title();
      const body = this.body();
      untracked(() => {
        this.titleValue.set(title);
        this.bodyValue.set(body);
      });
    });
  }

  protected save(): void {
    if (this.bodyTooLong()) return;
    const title = this.titleValue().trim();
    const body = this.bodyValue().trim();
    this.saved.emit({ title: title || undefined, body: body || undefined });
  }
}
