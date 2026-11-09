import { Component, computed, inject, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { DisplayPrefsService } from '../../shared/services/theme/display-prefs.service';
import { HkButtonComponent } from '../button/button.component';
import { coarsePointer } from '../coarse-pointer';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { HkWaxSealComponent } from '../wax-seal/wax-seal.component';

/**
 * `hk-spell-row` — one spell (design-system SpellRow): an optional level seal, the spell's glyph,
 * its name, optional marks and a Cast button that emits `cast`.
 *
 * Marks explain themselves through hint and accessible name only, with no legend: the
 * always-prepared fleur-de-lys (`alwaysPrepared`) and the concentration orb (`concentrating`)
 * each take their translated hint; `null` hides them. The level seal is a `hk-wax-seal` with a
 * roman numeral and `levelHint`. A chosen spell (pick lists) shows ONE tick: a selected
 * `hk-wax-seal`; set `castable` to false there to drop the Cast button. When Cast is unavailable,
 * `castDisabledReason` (translated) is its hint, never printed beside the row.
 *
 * It displays what it is given: whether a slot is left, what is prepared and what concentrates
 * are decided by the caller.
 */
@Component({
  selector: 'hk-spell-row',
  imports: [
    TranslocoDirective,
    IconComponent,
    HkButtonComponent,
    HkTooltipDirective,
    HkWaxSealComponent,
  ],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './spell-row.component.html',
  styleUrl: './spell-row.component.scss',
  host: {
    '[class.hk-srow--unprepared]': '!prepared()',
    '[class.hk-srow--comfortable]': 'effectiveDensity() === "comfortable"',
  },
})
export class HkSpellRowComponent {
  // Inputs
  readonly name = input.required<string>();
  /** The spell's glyph (`gi:<slug>`). */
  readonly icon = input.required<string>();
  /** Spell level 1..9 for the level seal; `null` (cantrip) draws none. */
  readonly level = input<number | null>(null);
  readonly levelHint = input<string | null>(null);
  readonly prepared = input(true);
  /** Translated hint of the always-prepared mark; `null` for none. */
  readonly alwaysPrepared = input<string | null>(null);
  /** Translated hint of the concentration orb; `null` when not concentrating. */
  readonly concentrating = input<string | null>(null);
  readonly chosen = input(false);
  readonly chosenHint = input<string | null>(null);
  readonly castable = input(true);
  /** Translated reason Cast is unavailable; `null` when it is available. */
  readonly castDisabledReason = input<string | null>(null);
  /** `null` follows the saved Settings preference; a caller can pin a density (the phone sheet pins comfortable). */
  readonly density = input<'compact' | 'comfortable' | null>(null);
  private readonly prefs = inject(DisplayPrefsService);
  protected readonly effectiveDensity = computed(() => this.density() ?? this.prefs.density());

  // Outputs
  readonly cast = output<void>();

  private readonly coarse = coarsePointer();
  protected readonly buttonSize = computed(() => (this.coarse() ? 'phone' : 'm'));
}
