import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { DIALOG_DATA, DialogRef } from '../../../../ui/dialog/dialog.service';
import { HkWaxSealComponent } from '../../../../ui/wax-seal/wax-seal.component';

export interface CastDialogSlotOption {
  readonly level: number;
  readonly max: number;
  readonly used: number;
  /** Task 12 (phase 4 plan 11): true for the (at most one) pact-lane option — a SEPARATE lane from
   * every regular slot-level option, never merged/deduped against one at the same `level` (a
   * Warlock's own pact slot level can coincide with a regular slot level on a multiclassed
   * character; both remain independently selectable). Omitted (falsy) for a regular option. */
  readonly pact?: boolean;
  /** Plan 13 task 4: set on a free-cast option (a `sheet.freeCasts` entry) — the resource id one
   * cast spends instead of a slot; `max`/`used` are that resource's, `level` the only level the
   * free lane casts at. `freeLabel` is the resource's already-localized name for the option text. */
  readonly freeResource?: string;
  readonly freeLabel?: string;
}

export interface CastDialogResult {
  readonly level: number;
  readonly pact?: boolean;
  readonly freeResource?: string;
}

export interface CastDialogData {
  readonly spellName: string;
  readonly spellLevel: number;
  readonly spellConcentration: boolean;
  /** Slots at/above `spellLevel` that still have room, PLUS (task 12) the pact-lane option when
   * eligible — pre-filtered by the CALLER (`PlayTabComponent.onCastLeveled`), never by this
   * component. Never includes a bare "no slot" option (task-3-brief.md: only cantrips skip a slot,
   * and those never open this dialog at all — R-pf3, cast directly from their own button); the only
   * slot-free options are plan 13 task 4's free-cast options, each paid by a named resource. */
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
 * disambiguate which one was picked, so a lane's identity is its array index).
 *
 * Board DL01: the options are "pay with" LANES (a radio group), each with its wax seals — one per
 * slot or resource use, the spent ones cooled — and a concentration warning above them.
 */
@Component({
  selector: 'app-cast-dialog',
  imports: [TranslocoDirective, HkButtonComponent, HkWaxSealComponent, IconComponent],
  templateUrl: './cast-dialog.component.html',
  styleUrl: './cast-dialog.component.scss',
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

  protected select(index: number): void {
    this.selectedIndex.set(index);
  }

  /** The lane's kind, which picks its seal glyph and styling: a regular slot, the pact slot, or a
   * free cast paid by a named resource. */
  protected kindOf(slot: CastDialogSlotOption): 'slot' | 'pact' | 'free' {
    return slot.freeResource !== undefined ? 'free' : slot.pact ? 'pact' : 'slot';
  }

  /** One seal per use: the ones left first, the spent ones after. */
  protected sealsOf(slot: CastDialogSlotOption): boolean[] {
    return Array.from({ length: Math.max(0, slot.max) }, (_, i) => i < slot.max - slot.used);
  }

  /** Radio-group keys: the arrows move the choice (wrapping) and focus follows it. */
  protected onLaneKey(event: KeyboardEvent, index: number): void {
    const count = this.data.availableSlots.length;
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step === 0 || count === 0) return;
    event.preventDefault();
    const next = (index + step + count) % count;
    this.selectedIndex.set(next);
    const lanes = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>(
      '[role="radio"]',
    );
    lanes?.[next]?.focus();
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
      ...(option.freeResource !== undefined ? { freeResource: option.freeResource } : {}),
    } satisfies CastDialogResult);
  }
}
