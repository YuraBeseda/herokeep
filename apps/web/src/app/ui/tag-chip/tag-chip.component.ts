import { Component, computed, effect, inject, input } from '@angular/core';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { damageInk, type DamageInk } from './damage-type';

export type TagChipTone = 'neutral' | 'arcane' | 'ember' | 'moss' | 'warning' | 'dark' | 'damage';

/**
 * `hk-tag-chip` — the small read-only chip of the design system (`hk-chip`): a property
 * ("versatile 1d10"), a mastery, an "equipped" or "ritual" mark, or a damage-type tag. A damage
 * tag always carries the word beside its ink dot; colour is never the only signal.
 *
 * `label` and `hint` are already-translated text. The hint defaults to the full label, so a name
 * that ellipsises stays readable; an explicit hint also makes the chip a tab stop, since it then
 * carries information the label does not.
 */
@Component({
  selector: 'hk-tag-chip',
  imports: [IconComponent],
  hostDirectives: [HkTooltipDirective],
  templateUrl: './tag-chip.component.html',
  styleUrl: './tag-chip.component.scss',
  host: {
    '[class]': 'classes()',
    '[style.--dmg]': 'ink()',
    '[attr.tabindex]': 'hint() ? "0" : null',
  },
})
export class HkTagChipComponent {
  private readonly tooltip = inject(HkTooltipDirective, { self: true });

  // Inputs
  readonly label = input.required<string>();
  readonly tone = input<TagChipTone>('neutral');
  /** A sprite id (`gi:<slug>` or `ui:<name>`) drawn before the label. */
  readonly icon = input<string | null>(null);
  /** Names the damage-type ink; implies the `damage` tone. */
  readonly damage = input<DamageInk | null>(null);
  /** Translated hint; defaults to the label. */
  readonly hint = input<string | null>(null);

  protected readonly ink = computed(() => damageInk(this.damage()));
  protected readonly classes = computed(
    () => `hk-tag-chip hk-tag-chip--${this.damage() ? 'damage' : this.tone()}`,
  );

  constructor() {
    effect(() => this.tooltip.text.set(this.hint() ?? this.label()));
  }
}
