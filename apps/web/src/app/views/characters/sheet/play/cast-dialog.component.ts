import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';

export interface CastDialogSlotOption {
  readonly level: number;
  readonly max: number;
  readonly used: number;
}

export interface CastDialogData {
  readonly spellName: string;
  readonly spellLevel: number;
  readonly spellConcentration: boolean;
  /** Slots at/above `spellLevel` that still have room — pre-filtered by the CALLER
   * (`PlayTabComponent.onCastLeveled`), never by this component. Never includes a "no slot"
   * option (task-3-brief.md: 1b leveled casts always consume a slot; only cantrips skip a slot,
   * and those never open this dialog at all — R-pf3, cast directly from their own button). */
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
 * Closes with the CHOSEN slot level (a `number`) on confirm — `PlayTabComponent` reads that
 * straight into `propose.cast`'s own `opts.level` — or `undefined` on cancel/ESC/backdrop.
 */
@Component({
  selector: 'app-cast-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  templateUrl: './cast-dialog.component.html',
})
export class CastDialogComponent {
  protected readonly data = inject<CastDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected readonly selectedLevel = signal<number | undefined>(this.data.availableSlots[0]?.level);

  protected readonly showsReplaceNote = computed(
    () => this.data.spellConcentration && this.data.alreadyConcentrating,
  );

  protected onSlotChange(value: string): void {
    const level = Number(value);
    this.selectedLevel.set(Number.isFinite(level) ? level : undefined);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    const level = this.selectedLevel();
    if (level === undefined) return;
    this.dialogRef.close(level);
  }
}
