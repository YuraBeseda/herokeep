import { Component, inject, input, model, signal } from '@angular/core';
import type { NoteEntry } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { HkDrawerComponent } from '../../../../../ui/drawer/drawer.component';
import { HkTooltipDirective } from '../../../../../ui/tooltip/tooltip.directive';
import { PlayActionsService } from '../play-actions.service';
import { NoteEditorComponent, type NoteEditorResult } from './note-editor.component';

type Opener = HTMLElement | null | undefined;

/** The note being edited: the literal 'new' for a note being written, else an existing note's id. */
type Editing = string | null;

/**
 * The notes drawer (board D01), opened from the sheet strap's Notes action and from the phone More
 * tab. The character's notes (freeform stream state, `Facts.notes`) as rows with Edit and Remove,
 * an Add note button, and the editor INLINE at the top while a note is being written or edited. It
 * replaces the notes list dialog and the note dialog: the events are the same `note.added` /
 * `note.updated` / `note.removed` through `PlayActionsService`, and Remove still asks first.
 * While the campaign edit lock is on, the mutating controls are unavailable with the reason.
 */
@Component({
  selector: 'app-notes-drawer',
  imports: [
    TranslocoDirective,
    HkButtonComponent,
    HkDrawerComponent,
    HkTooltipDirective,
    IconComponent,
    NoteEditorComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './notes-drawer.component.html',
  styleUrl: './notes-drawer.component.scss',
})
export class NotesDrawerComponent {
  protected readonly actions = inject(PlayActionsService);

  readonly open = model(false);
  /** The control that opened the drawer: focus returns to it and pressing it never counts as outside. */
  readonly opener = input<Opener>(null);

  protected readonly editing = signal<Editing>(null);

  protected noteBeingEdited(): NoteEntry | undefined {
    const id = this.editing();
    return id === null || id === 'new' ? undefined : this.actions.notes().find((n) => n.id === id);
  }

  protected startAdd(): void {
    this.editing.set('new');
  }

  protected startEdit(note: NoteEntry): void {
    this.editing.set(note.id);
  }

  protected save(result: NoteEditorResult): void {
    const note = this.noteBeingEdited();
    if (note) this.actions.updateNote(note.id, result);
    else this.actions.createNote(result);
    this.editing.set(null);
  }

  protected async remove(note: NoteEntry): Promise<void> {
    if (await this.actions.removeNote(note)) {
      if (this.editing() === note.id) this.editing.set(null);
    }
  }
}
