import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogRef } from '@shared/components/dialog/dialog.service';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';

export interface CustomItemDialogResult {
  readonly name: string;
  readonly qty: number;
  readonly notes?: string;
}

/**
 * The custom (homebrew) item quick-add dialog (task-5-brief.md, design ruling 2) —
 * `PlayTabComponent.onAddCustomItem` opens this via `DialogService.open()`. Same "own injector,
 * full unscoped keys through its own `*transloco`" pattern as `NoteDialogComponent`.
 *
 * Ruling 2, binding: a custom item is name+qty+notes ONLY — no weapon/armor/attunement
 * mechanics (those stay out until Phase 4). `PlayTabComponent` turns a confirmed result into
 * `propose.addItem(sheet, {name, qty, custom: {}}, newId)` plus (only when `notes` is non-blank)
 * a hand-assembled `item.updated {instanceId, notes}` sharing that same freshly-minted
 * `instanceId`, concatenated into ONE `appendTx` call — this dialog itself never touches the
 * engine, it only collects the three fields.
 *
 * Closes with a `CustomItemDialogResult` (trimmed; a blank `notes` becomes `undefined`) on
 * confirm, or `undefined` on cancel/ESC/backdrop. Confirm is disabled while `name` is blank —
 * `ItemAddedV1.name` doesn't accept an empty custom item with nothing to call it.
 */
@Component({
  selector: 'app-custom-item-dialog',
  imports: [TranslocoDirective, FormsModule, ButtonComponent, NumberFieldComponent],
  templateUrl: './custom-item-dialog.component.html',
})
export class CustomItemDialogComponent {
  private readonly dialogRef = inject(DialogRef);

  protected readonly name = signal('');
  protected readonly qty = signal(1);
  protected readonly notes = signal('');

  protected onNameChange(value: string): void {
    this.name.set(value);
  }

  protected onQtyChange(value: number | null): void {
    this.qty.set(value !== null && value >= 1 ? Math.floor(value) : 1);
  }

  protected onNotesChange(value: string): void {
    this.notes.set(value);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    const name = this.name().trim();
    if (!name) return;
    const notes = this.notes().trim();
    this.dialogRef.close({
      name,
      qty: this.qty(),
      notes: notes || undefined,
    } satisfies CustomItemDialogResult);
  }
}
