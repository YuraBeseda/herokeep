import { Component, computed, input } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { HkWaxSealComponent } from '../wax-seal/wax-seal.component';

/** A bonus as text: "+3", and a real minus sign ("−1") for negatives. */
function signed(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`;
}

/**
 * `hk-ability-seal` — one of the six abilities as a large wax seal with the modifier embossed in
 * it, the ability name beneath, and two small plates: the score on brass, and the saving throw on
 * leather with a shield glyph and, when proficient, a star (design-system AbilitySeal).
 *
 * `ability` is the already-translated ability name. The component displays the numbers it is
 * given; it never derives a modifier or a save. Glyphs carry hints, not words: the shield and star
 * are explained by tooltips and accessible names ("Saving throw +6", "Proficient saving throw").
 * `compact` is the phone size (46px seal).
 */
@Component({
  selector: 'hk-ability-seal',
  imports: [TranslocoDirective, IconComponent, HkWaxSealComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './ability-seal.component.html',
  styleUrl: './ability-seal.component.scss',
  host: {
    '[class.hk-ability--compact]': 'compact()',
  },
})
export class HkAbilitySealComponent {
  // Inputs
  readonly ability = input.required<string>();
  readonly score = input.required<number>();
  readonly modifier = input.required<number>();
  readonly save = input.required<number>();
  readonly saveProficient = input(false);
  readonly compact = input(false);

  protected readonly modifierText = computed(() => signed(this.modifier()));
  protected readonly saveText = computed(() => signed(this.save()));
}
