import { Component, computed, effect, inject, input } from '@angular/core';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { romanNumeral, waxBlobPath } from './wax-seal-geometry';

export type WaxSealState = 'filled' | 'spent' | 'disabled' | 'selected';
export type WaxSealSize = 's' | 'm' | 'l';

let nextGradientId = 0;

/**
 * `hk-wax-seal` — the signature mark of the system and the ONLY pip renderer in the app (death
 * saves, spell slots, resource pips, selection marks, ability modifiers): a hand-pressed blob of
 * red wax with an embossed glyph, level numeral or short text. Filled wax means available, a pale
 * cooled ring means spent.
 *
 * `hint` is required and is already-translated text ("Spell slot, level 1 — 3 of 4 left"): it is
 * the seal's accessible name and its tooltip. To make a seal a control, wrap it in a `<button>`
 * that carries its own `aria-label`; the seal itself never takes focus.
 *
 * It shows values it is given: it knows nothing about slots, charges or abilities.
 */
@Component({
  selector: 'hk-wax-seal',
  hostDirectives: [HkTooltipDirective],
  templateUrl: './wax-seal.component.html',
  styleUrl: './wax-seal.component.scss',
  host: {
    '[class]': 'classes()',
  },
})
export class HkWaxSealComponent {
  private readonly tooltip = inject(HkTooltipDirective, { self: true });

  // Inputs
  readonly state = input<WaxSealState>('filled');
  readonly size = input<WaxSealSize>('m');
  /** A sprite id (`gi:<slug>` or `ui:<name>`) embossed in the wax. */
  readonly glyph = input<string | null>(null);
  /** A spell-slot level 1..9, embossed as I..IX. */
  readonly numeral = input<number | null>(null);
  /** Short embossed text, such as an ability modifier ("+3", "−1"). */
  readonly text = input<string | null>(null);
  /** Translated accessible name and tooltip. Required. */
  readonly hint = input.required<string>();
  /** Varies the outline of the blob so a row of seals does not look stamped. */
  readonly seed = input(0);

  protected readonly gradientId = `hkSealGrad${nextGradientId++}`;

  protected readonly spent = computed(() => this.state() === 'spent');
  protected readonly blob = computed(() => waxBlobPath(this.seed()));
  protected readonly label = computed(() => {
    const numeral = this.numeral();
    return this.text() ?? (numeral === null ? null : romanNumeral(numeral));
  });
  protected readonly symbol = computed(() => {
    const glyph = this.glyph();
    if (glyph === null) return null;
    const colon = glyph.indexOf(':');
    return `assets/icons/sprite.svg#${glyph.slice(0, colon) === 'ui' ? 'ui' : 'gi'}-${glyph.slice(colon + 1)}`;
  });
  protected readonly rimRadius = computed(() => (this.size() === 'l' && this.label() ? 22 : 20));
  protected readonly fontSize = computed(() => (this.size() === 'l' ? 23 : 18));
  protected readonly classes = computed(
    () => `hk-wax-seal hk-wax-seal--${this.size()} hk-wax-seal--${this.state()}`,
  );

  constructor() {
    effect(() => this.tooltip.text.set(this.hint()));
  }
}
