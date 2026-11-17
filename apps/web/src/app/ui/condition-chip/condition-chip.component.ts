import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * `hk-condition-chip` — an active condition as an ember chip (design-system ConditionChip): glyph,
 * name and a small badge. The badge shows `duration` (already-translated text such as "3 rounds"),
 * or else a numeral `level` (exhaustion); with neither it is not rendered at all. Plan slice 2
 * fills the duration; this component only displays what it is given.
 *
 * `hint` is the whole story ("Poisoned, 3 rounds left, from Giant Spider") and is both the tooltip
 * and the accessible name of the chip; it defaults to the name. A `removable` chip carries an End
 * button that emits `remove`. A `locked` chip shows the lock glyph in its place, explained only by
 * its hint, and is never removable. `tone="arcane"` is for beneficial magical effects.
 */
@Component({
  selector: 'hk-condition-chip',
  imports: [TranslocoDirective, IconComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './condition-chip.component.html',
  styleUrl: './condition-chip.component.scss',
  host: {
    '[class.hk-cond--arcane]': 'tone() === "arcane"',
    '[class.hk-cond--plain]': '!locked() && !removable()',
  },
})
export class HkConditionChipComponent {
  // Inputs
  readonly name = input.required<string>();
  /** A sprite id; the pack may name another glyph than the default skull. */
  readonly icon = input('ui:condition');
  readonly level = input<number | null>(null);
  /** Translated duration text; renders nothing when absent. */
  readonly duration = input<string | null>(null);
  readonly tone = input<'danger' | 'arcane'>('danger');
  readonly removable = input(false);
  readonly locked = input(false);
  /** Translated reason for the lock (a house rule); the plain "Locked" hint when absent. */
  readonly lockReason = input<string | null>(null);
  /** Translated full story; defaults to the name. */
  readonly hint = input<string | null>(null);

  // Outputs
  readonly remove = output<void>();

  protected readonly badge = computed(() => {
    const duration = this.duration();
    if (duration) return duration;
    const level = this.level();
    return level === null ? null : String(level);
  });
}
