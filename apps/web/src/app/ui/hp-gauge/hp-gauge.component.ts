import { Component, computed, input, output, signal } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkButtonComponent } from '../button/button.component';

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
  imports: [TranslocoDirective, HkButtonComponent, IconComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './hp-gauge.component.html',
  styleUrl: './hp-gauge.component.scss',
})
export class HkHpGaugeComponent {
  // Inputs
  readonly current = input.required<number>();
  readonly max = input.required<number>();
  readonly temp = input(0);

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

  protected readonly total = computed(() => this.max() + this.temp());
  protected readonly hpWidth = computed(() => percent(this.current(), this.total()));
  protected readonly tempWidth = computed(() =>
    Math.min(100 - this.hpWidth(), percent(this.temp(), this.total())),
  );

  protected onInput(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  protected emit(kind: 'damage' | 'heal' | 'setTemp', field: HTMLInputElement): void {
    const amount = this.amount();
    if (amount === null) return;
    this[kind].emit(amount);
    field.value = '';
    this.typed.set('');
  }
}
