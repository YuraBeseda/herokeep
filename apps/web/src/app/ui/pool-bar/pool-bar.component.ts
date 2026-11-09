import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkWaxSealComponent } from '../wax-seal/wax-seal.component';

/**
 * `hk-pool-bar` — a resource block (design-system PoolBar): the resource name with its glyph ring,
 * an action slot, the pool as a brass gauge (`kind="points"`, e.g. Lay on Hands) or a row of
 * wax-seal pips (`kind="pips"`, uses and charges), the count, and the recharge hint.
 *
 * It displays the numbers it is given. Strings that vary (`label`, `unit`, `recharge`, `pipHint`)
 * are already-translated text. Project the Spend / Use button into `[hkPoolAction]`, with its
 * `disabledReason` when the pool is empty. Pips are wax seals (the only pip renderer): s for five
 * or more, m for four or fewer; filled while available, spent after.
 */
@Component({
  selector: 'hk-pool-bar',
  imports: [TranslocoDirective, IconComponent, HkWaxSealComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './pool-bar.component.html',
  styleUrl: './pool-bar.component.scss',
})
export class HkPoolBarComponent {
  // Inputs
  readonly kind = input<'points' | 'pips'>('points');
  readonly value = input.required<number>();
  readonly max = input.required<number>();
  readonly label = input.required<string>();
  /** A sprite id (`gi:<slug>` or `ui:<name>`) for the glyph ring beside the name. */
  readonly glyph = input<string | null>(null);
  /** Unit text after the count ("points"). */
  readonly unit = input<string | null>(null);
  /** Recharge hint text ("long rest", "dawn · 1d6+1"). */
  readonly recharge = input<string | null>(null);
  readonly rechargeGlyph = input<string | null>(null);
  /** Translated hint every pip carries ("Channel Divinity use"). */
  readonly pipHint = input('');
  /** The "n / max" count becomes activatable (keyboard too) so a caller can show how the maximum is built. */
  readonly inspectable = input(false);
  readonly inspect = output<void>();

  protected press(event: Event): void {
    if (!this.inspectable()) return;
    event.preventDefault();
    this.inspect.emit();
  }
  /** The sprite id embossed on each pip. */
  readonly pipGlyph = input('ui:use');

  protected readonly clamped = computed(() =>
    Math.min(Math.max(0, this.max()), Math.max(0, this.value())),
  );
  protected readonly width = computed(() =>
    this.max() > 0 ? (this.clamped() / this.max()) * 100 : 0,
  );
  protected readonly pips = computed(() =>
    Array.from({ length: Math.max(0, Math.min(this.max(), 99)) }, (_, index) => index),
  );
  protected readonly pipSize = computed(() => (this.max() >= 5 ? 's' : 'm'));
}
