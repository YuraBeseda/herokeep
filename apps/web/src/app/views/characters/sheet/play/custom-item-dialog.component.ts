import { Component, computed, inject, signal } from '@angular/core';
import type { ItemIconRef } from '@hk/protocol';
import { TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { BlobUrlPipe } from '../../../../shared/pipes/blob-url.pipe';
import { IconPickerComponent } from '../../../../ui/icon-picker/icon-picker.component';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { DIALOG_DATA, DialogRef } from '../../../../ui/dialog/dialog.service';
import { HkNumberFieldComponent } from '../../../../ui/number-field/number-field.component';
import { HkTextFieldComponent } from '../../../../ui/text-field/text-field.component';
import { HkTextareaComponent } from '../../../../ui/textarea/textarea.component';

export interface CustomItemDialogResult {
  readonly name: string;
  readonly qty: number;
  readonly notes?: string;
  readonly icon?: ItemIconRef;
}

/** What the opener passes: the game-icon slugs the hero's items already use (picker order). */
export interface CustomItemDialogData {
  readonly used: readonly string[];
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
  imports: [
    TranslocoDirective,
    HkButtonComponent,
    HkNumberFieldComponent,
    HkTextFieldComponent,
    HkTextareaComponent,
    IconComponent,
    IconPickerComponent,
    BlobUrlPipe,
  ],
  templateUrl: './custom-item-dialog.component.html',
  styleUrl: './custom-item-dialog.component.scss',
})
export class CustomItemDialogComponent {
  private readonly dialogRef = inject(DialogRef);
  protected readonly used =
    (inject(DIALOG_DATA, { optional: true }) as CustomItemDialogData | null)?.used ?? [];

  protected readonly name = signal('');
  protected readonly qty = signal<number | null>(1);
  protected readonly notes = signal('');
  protected readonly icon = signal<ItemIconRef | null>(null);
  protected readonly pickerOpen = signal(false);
  /** The name has been left once: only then does a blank one read as an error. */
  protected readonly nameTouched = signal(false);

  protected readonly nameBlank = computed(() => this.name().trim() === '');

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    const name = this.name().trim();
    if (!name) {
      this.nameTouched.set(true);
      return;
    }
    const notes = this.notes().trim();
    this.dialogRef.close({
      name,
      qty: this.qty() !== null && this.qty()! >= 1 ? Math.floor(this.qty()!) : 1,
      notes: notes || undefined,
      ...(this.icon() ? { icon: this.icon()! } : {}),
    } satisfies CustomItemDialogResult);
  }
}
