import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogRef } from '@shared/components/dialog/dialog.service';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { EntityPickerComponent } from '../../create-wizard/steps/entity-picker.component';

// `hk-entity-picker`'s R3 render cap (task-6 fix round, plan 5) — same value
// `EquipmentStepComponent` uses for its own (960-item) picker.
const ITEM_PICKER_LIMIT = 60;

export interface AddItemDialogResult {
  readonly itemId: string;
  readonly qty: number;
}

/**
 * The add-from-library dialog (task-5-brief.md) — `PlayTabComponent.onAddFromLibrary` opens this
 * via `DialogService.open({ sheet: true })` (a bottom sheet, roomy enough for the picker's own
 * search field + card grid). Queries item entities itself (`index.query({type:'item'})`), the
 * same self-contained approach `EquipmentStepComponent` uses for its own item picker — no caller
 * pre-resolution needed, `hk-entity-picker` already resolves names/icons from raw ids through the
 * content index and its own `EngineFacade`.
 *
 * A single search-set-qty-tap flow: tapping a card in the picker closes the dialog immediately
 * with `{itemId, qty}` (the qty selected at that moment) — unlike the wizard equipment step
 * (which stays open across the whole step, adding item after item), this dialog is a one-shot
 * quick-add, closed by `PlayTabComponent` re-opening it for a second add if the player wants one.
 */
@Component({
  selector: 'app-add-item-dialog',
  imports: [
    TranslocoDirective,
    FormsModule,
    ButtonComponent,
    NumberFieldComponent,
    EntityPickerComponent,
  ],
  templateUrl: './add-item-dialog.component.html',
})
export class AddItemDialogComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly dialogRef = inject(DialogRef);

  protected readonly itemPickerLimit = ITEM_PICKER_LIMIT;
  protected readonly qty = signal(1);

  protected readonly itemIds = computed<string[]>(() =>
    this.engineFacade
      .index()
      .query({ type: 'item' })
      .map((e) => e.id),
  );

  protected onQtyChange(value: number | null): void {
    this.qty.set(value !== null && value >= 1 ? Math.floor(value) : 1);
  }

  protected onPick(itemId: string): void {
    this.dialogRef.close({ itemId, qty: this.qty() } satisfies AddItemDialogResult);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }
}
