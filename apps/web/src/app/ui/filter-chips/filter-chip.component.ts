import { Component, effect, inject, input } from '@angular/core';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { damageInk, type DamageInk } from '../tag-chip/damage-type';

export interface FilterChipOption {
  readonly id: string;
  /** Translated label. */
  readonly label: string;
  /** A sprite id drawn before the label. */
  readonly icon?: string;
  readonly count?: number;
  readonly damage?: DamageInk;
  /** Translated reason the filter is unavailable; shown only as a hint. */
  readonly disabledReason?: string;
}

/** One toggle chip of `hk-filter-chips`; a child so each chip owns its own hint. */
@Component({
  selector: 'button[hk-filter-chip]',
  imports: [IconComponent],
  hostDirectives: [HkTooltipDirective],
  template: `
    @if (option().icon; as glyph) {
      <hk-icon [icon]="glyph" />
    }
    <span class="hk-filter-chips__label">{{ option().label }}</span>
    @if (option().count !== undefined) {
      <span class="hk-filter-chips__count">{{ option().count }}</span>
    }
  `,
  styleUrl: './filter-chip.component.scss',
  host: {
    type: 'button',
    class: 'hk-filter-chips__chip',
    '[class.hk-filter-chips__chip--selected]': 'pressed()',
    '[class.hk-filter-chips__chip--damage]': 'option().damage !== undefined',
    '[style.--dmg]': 'ink()',
    '[attr.aria-pressed]': 'pressed()',
    '[attr.aria-disabled]': 'option().disabledReason ? "true" : null',
  },
})
export class HkFilterChipComponent {
  private readonly tooltip = inject(HkTooltipDirective, { self: true });

  readonly option = input.required<FilterChipOption>();
  readonly pressed = input(false);

  protected ink(): string | null {
    return damageInk(this.option().damage);
  }

  constructor() {
    effect(() => {
      // The full label always (it ellipsises); an unavailable chip adds its reason after it.
      const { label, disabledReason } = this.option();
      this.tooltip.text.set(disabledReason ? `${label}: ${disabledReason}` : label);
    });
  }
}
