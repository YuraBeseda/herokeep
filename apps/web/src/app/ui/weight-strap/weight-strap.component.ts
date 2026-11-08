import { Component, computed, input } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Where the load stands. `loaded` is for the plain mode (no variant encumbrance), where the only
 * states are carrying and over capacity.
 */
export type WeightState = 'loaded' | 'light' | 'encumbered' | 'heavy' | 'over';

/**
 * `hk-weight-strap` — carried weight as a leather strap gauge (design-system WeightStrap): a
 * label, a status chip, a brass fill that turns ember when over capacity, and "108 / 240 lb".
 *
 * It displays the numbers and the state it is given; deciding the state (the thresholds, the
 * variant encumbrance option) is the caller's. `unit` is translated text (lb / kg).
 * `stateHint` is the effect text for the chip's hint ("Encumbered: speed −10 ft"); without it the
 * hint is the state word. The gauge is an image named with the numbers and the state word, and
 * the state is never colour alone: the chip carries the word and a glyph.
 */
@Component({
  selector: 'hk-weight-strap',
  imports: [TranslocoDirective, IconComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './weight-strap.component.html',
  styleUrl: './weight-strap.component.scss',
})
export class HkWeightStrapComponent {
  // Inputs
  readonly current = input.required<number>();
  readonly capacity = input.required<number>();
  readonly unit = input.required<string>();
  readonly state = input.required<WeightState>();
  readonly stateHint = input<string | null>(null);

  protected readonly fillWidth = computed(() => {
    if (this.state() === 'over') return 100;
    const capacity = this.capacity();
    if (capacity <= 0) return 0;
    return Math.min(100, Math.max(0, (this.current() / capacity) * 100));
  });
}
