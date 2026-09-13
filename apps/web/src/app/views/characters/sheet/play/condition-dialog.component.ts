import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';

/** One selectable condition entity, pre-resolved by the CALLER (`PlayTabComponent`) — never by
 * this component (same "resolve before opening" convention `CastDialogData.availableSlots`
 * documents). `name` is already localizer-resolved text; `levelBearing` is data-driven off the
 * entity itself (`ConditionEntitySchema.levels !== undefined`, `@hk/protocol`) — NEVER a
 * hardcoded exhaustion id. */
export interface ConditionDialogOption {
  readonly id: string;
  readonly name: string;
  readonly levelBearing: boolean;
}

export interface ConditionDialogData {
  readonly options: readonly ConditionDialogOption[];
}

export interface ConditionDialogResult {
  readonly conditionId: string;
  readonly level?: number;
}

/**
 * The condition-add dialog (task-4-brief.md) — `PlayTabComponent.onAddCondition` opens this via
 * `DialogService.open()`. Same "own injector, no inherited `provideTranslocoScope('characters')`,
 * full unscoped keys through its own `*transloco`" pattern as `CastDialogComponent`, safe for the
 * identical reason: the only caller has already loaded the `characters` scope.
 *
 * Level stepper (controller ruling, task-4-brief.md): shown only for a `levelBearing` option, a
 * FREE number field with `min="1"` and deliberately NO `max` — the pack's own `levels` field
 * (exhaustion = 6) exists only to mark a condition as level-bearing, never as a UI cap; the
 * reducer replaces-by-`conditionId`, so re-adding with a different level just overwrites it.
 *
 * Closes with a `ConditionDialogResult` on confirm, or `undefined` on cancel/ESC/backdrop.
 */
@Component({
  selector: 'app-condition-dialog',
  imports: [TranslocoDirective, FormsModule, ButtonComponent, NumberFieldComponent],
  templateUrl: './condition-dialog.component.html',
})
export class ConditionDialogComponent {
  protected readonly data = inject<ConditionDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected readonly selectedId = signal<string | undefined>(this.data.options[0]?.id);
  protected readonly level = signal<number | null>(1);

  protected readonly selectedOption = computed(() =>
    this.data.options.find((o) => o.id === this.selectedId()),
  );

  protected readonly showsLevel = computed(() => this.selectedOption()?.levelBearing ?? false);

  protected onConditionChange(value: string): void {
    this.selectedId.set(value || undefined);
  }

  protected onLevelChange(value: number | null): void {
    this.level.set(value);
  }

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected confirm(): void {
    const conditionId = this.selectedId();
    if (!conditionId) return;
    if (this.showsLevel() && (this.level() === null || this.level()! < 1)) return;
    const level = this.showsLevel() ? (this.level() ?? 1) : undefined;
    this.dialogRef.close({ conditionId, level } satisfies ConditionDialogResult);
  }
}
