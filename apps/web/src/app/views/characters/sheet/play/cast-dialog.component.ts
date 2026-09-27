import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';

export interface CastDialogSlotOption {
  readonly level: number;
  readonly max: number;
  readonly used: number;
  /** Task 12 (phase 4 plan 11): true for the (at most one) pact-lane option — a SEPARATE lane from
   * every regular slot-level option, never merged/deduped against one at the same `level` (a
   * Warlock's own pact slot level can coincide with a regular slot level on a multiclassed
   * character; both remain independently selectable). Omitted (falsy) for a regular option. */
  readonly pact?: boolean;
}

export interface CastDialogResult {
  readonly level: number;
  readonly pact?: boolean;
}

export interface CastDialogData {
  readonly spellName: string;
  readonly spellLevel: number;
  readonly spellConcentration: boolean;
  /** Slots at/above `spellLevel` that still have room, PLUS (task 12) the pact-lane option when
   * eligible — pre-filtered by the CALLER (`PlayTabComponent.onCastLeveled`), never by this
   * component. Never includes a "no slot" option (task-3-brief.md: 1b leveled casts always
   * consume a slot; only cantrips skip a slot, and those never open this dialog at all — R-pf3,
   * cast directly from their own button). */
  readonly availableSlots: readonly CastDialogSlotOption[];
  readonly alreadyConcentrating: boolean;
}

/**
 * The leveled-spell cast dialog (task-3-brief.md) — `PlayTabComponent.onCastLeveled` opens this
 * via `DialogService.open()`. Same "own injector, no inherited `provideTranslocoScope('characters')`,
 * full unscoped keys through its own `*transloco`" pattern as `TimelineRevertConfirmComponent`
 * (`timeline-tab.component.ts`), safe for the identical reason: the only caller has already
 * loaded the `characters` scope by the time this can ever open.
 *
 * Closes with a `CastDialogResult` (task 12 — was a bare chosen level before this task) on
 * confirm, or `undefined` on cancel/ESC/backdrop. Selection is by INDEX into `data.availableSlots`
 * (task 12's own fix — two options can legitimately share the same `level`, e.g. a pact slot and a
 * regular slot both at level 3 on a multiclassed character; a bare `level` value could no longer
 * disambiguate which one was picked, so the `<select>`'s own `value` is the option's array index).
 */
@Component({
  selector: 'app-cast-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  templateUrl: './cast-dialog.component.html',
})
export class CastDialogComponent {
  protected readonly data = inject<CastDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected readonly selectedIndex = signal<number | undefined>(
    this.data.availableSlots.length > 0 ? 0 : undefined,
  );

  protected readonly showsReplaceNote = computed(
    () => this.data.spellConcentration && this.data.alreadyConcentrating,
  );

  protected onSlotChange(value: string): void {
    const index = Number(value);
    this.selectedIndex.set(Number.isInteger(index) ? index : undefined);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    const index = this.selectedIndex();
    const option = index === undefined ? undefined : this.data.availableSlots[index];
    if (!option) return;
    this.dialogRef.close({
      level: option.level,
      ...(option.pact ? { pact: true } : {}),
    } satisfies CastDialogResult);
  }
}
