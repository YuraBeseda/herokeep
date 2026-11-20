import {
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import type { HkMenuItem } from '../context-menu/context-menu.types';
import { HkSplitActionComponent } from '../split-action/split-action.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/** Share of the track for `part`, as a percentage clamped to 0..100. */
function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/**
 * `hk-hp-gauge` — the hit points of a hero as a leather strap with a brass buckle (design-system
 * HpGauge): current HP as the biggest numeral on the board, "/ max" in brass, a gauge filled with
 * ember for current HP and a brass hatch for temporary HP, and Damage / Heal / Temp controls
 * working on one typed amount.
 *
 * It displays the numbers it is given and reports intent: `damage`, `heal` and `setTemp` emit the
 * typed positive whole amount (and clear the field). It never decides what damage does; the caller
 * dispatches the events. The gauge is `role="meter"` with a text alternative.
 */
@Component({
  selector: 'hk-hp-gauge',
  imports: [TranslocoDirective, HkSplitActionComponent, IconComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './hp-gauge.component.html',
  styleUrl: './hp-gauge.component.scss',
})
export class HkHpGaugeComponent {
  // Inputs
  readonly current = input.required<number>();
  readonly max = input.required<number>();
  readonly temp = input(0);
  /** Optional translated explanation of temporary hit points, a tooltip on the temp chip. */
  readonly tempHint = input<string | null>(null);

  // Outputs
  readonly damage = output<number>();
  readonly heal = output<number>();
  readonly setTemp = output<number>();

  protected readonly typed = signal('');
  /** The typed amount when it is a positive whole number, otherwise `null`. */
  protected readonly amount = computed(() => {
    const text = this.typed().trim();
    if (!/^\d+$/.test(text)) return null;
    const value = Number(text);
    return value > 0 ? value : null;
  });

  /** Coarse pointers (touch) get the 44px phone button, like the amount field. */
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly split = viewChild.required(HkSplitActionComponent);

  /** Damage / Heal / Temp HP as one split action; all disabled (with the reason) until an amount is typed. */
  protected readonly actions = computed<HkMenuItem[]>(() => {
    const disabledReasonKey = this.amount() === null ? 'shell.ui.hp.amount-needed' : undefined;
    const item = (
      id: 'damage' | 'heal' | 'setTemp',
      labelKey: string,
      icon: string,
    ): HkMenuItem => ({
      id,
      labelKey,
      icon,
      ...(disabledReasonKey ? { disabledReasonKey } : {}),
      run: () => this.emit(id),
    });
    return [
      item('damage', 'shell.ui.hp.damage', 'ui:damage'),
      item('heal', 'shell.ui.hp.heal', 'ui:heal'),
      item('setTemp', 'shell.ui.hp.temp', 'ui:temp-hp'),
    ];
  });

  /** Coarse pointers (touch) get the 44px phone button, like the amount field. */
  private readonly coarse = signal(
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  );
  protected readonly buttonSize = computed(() => (this.coarse() ? 'phone' : 'm'));
  /** A valid meter range even for max 0, and a value that never leaves it. */
  protected readonly rangeMax = computed(() => Math.max(1, this.max()));
  protected readonly now = computed(() => Math.min(this.rangeMax(), Math.max(0, this.current())));

  protected readonly total = computed(() => this.max() + this.temp());
  protected readonly hpWidth = computed(() => percent(this.current(), this.total()));
  protected readonly tempWidth = computed(() =>
    Math.min(100 - this.hpWidth(), percent(this.temp(), this.total())),
  );

  constructor() {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(pointer: coarse)');
    const onChange = (event: MediaQueryListEvent): void => this.coarse.set(event.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }

  protected onInput(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  /** Enter in the amount field applies the action the split button shows. */
  protected applyCurrent(): void {
    this.split().runCurrent();
  }

  private emit(kind: 'damage' | 'heal' | 'setTemp'): void {
    const amount = this.amount();
    if (amount === null) return;
    this[kind].emit(amount);
    this.field().nativeElement.value = '';
    this.typed.set('');
  }
}
