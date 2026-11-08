import { Component, computed, effect, inject, input } from '@angular/core';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * `hk-stat-tile` — a small sunken leather plate for one vital (initiative, speed, proficiency
 * bonus, hit dice, passive perception, inspiration): a gold label above, the value in the
 * display face with its glyph below (design-system StatTile). It shows the strings it is given.
 * `hint` is optional translated text (for example "Overridden by hand") shown as a tooltip.
 * `on` highlights the plate (inspiration while available).
 */
@Component({
  selector: 'hk-stat-tile',
  imports: [IconComponent],
  hostDirectives: [HkTooltipDirective],
  templateUrl: './stat-tile.component.html',
  styleUrl: './stat-tile.component.scss',
  host: {
    '[class.hk-stat-tile--on]': 'on()',
  },
})
export class HkStatTileComponent {
  private readonly tooltip = inject(HkTooltipDirective, { self: true });

  // Inputs
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  /** A sprite id (`ui:<name>` or `gi:<slug>`) drawn beside the value. */
  readonly icon = input<string | null>(null);
  readonly on = input(false);
  readonly hint = input<string | null>(null);

  protected readonly text = computed(() => String(this.value()));

  constructor() {
    effect(() => this.tooltip.text.set(this.hint() ?? ''));
  }
}
