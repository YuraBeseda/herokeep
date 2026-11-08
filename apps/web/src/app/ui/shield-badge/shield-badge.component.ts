import { Component, computed, effect, inject, input } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

let nextShieldId = 0;

/**
 * `hk-shield-badge` — armor class drawn as a brass heater shield with the number on a dark plate
 * (design-system ShieldBadge). Sizes: `m` 82x96 (sheet), `s` 56x66 (party cards, phone header).
 *
 * The shield is an image named "Armor class N". Pass `hint` (translated) to say more — "Armor class
 * 20, +2 from Shield of Faith" — it replaces the name and is shown as the tooltip. The component
 * only displays the value it is given.
 */
@Component({
  selector: 'hk-shield-badge',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('shell')],
  hostDirectives: [HkTooltipDirective],
  templateUrl: './shield-badge.component.html',
  styleUrl: './shield-badge.component.scss',
})
export class HkShieldBadgeComponent {
  private readonly tooltip = inject(HkTooltipDirective, { self: true });

  // Inputs
  readonly value = input.required<number>();
  readonly size = input<'s' | 'm'>('m');
  readonly hint = input<string | null>(null);

  protected readonly gradientId = `hkShieldBrass${nextShieldId++}`;
  protected readonly width = computed(() => (this.size() === 's' ? 56 : 82));
  protected readonly height = computed(() => (this.size() === 's' ? 66 : 96));

  constructor() {
    effect(() => this.tooltip.text.set(this.hint() ?? ''));
  }
}
