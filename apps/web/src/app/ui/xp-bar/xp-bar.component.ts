import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService, provideTranslocoScope } from '@jsverse/transloco';

/**
 * `hk-xp-bar` — a thin brass gauge showing XP toward the next level, with the count in the display
 * face (design-system XpBar). `floor` is the XP at which the current level starts and `next` the
 * XP of the next level; the caller supplies both (the thresholds are rules data, not component
 * knowledge). `surface="leaf"` swaps the ink for use on parchment instead of the leather folio.
 *
 * `role="progressbar"` with min/max/now and a label that states the numbers. Numbers are grouped
 * for the active language.
 */
@Component({
  selector: 'hk-xp-bar',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './xp-bar.component.html',
  styleUrl: './xp-bar.component.scss',
  host: {
    '[class.hk-xp-bar--leaf]': "surface() === 'leaf'",
  },
})
export class HkXpBarComponent {
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  // Inputs
  readonly xp = input.required<number>();
  readonly floor = input.required<number>();
  readonly next = input.required<number>();
  readonly surface = input<'folio' | 'leaf'>('folio');

  protected readonly now = computed(() => Math.min(this.next(), Math.max(this.floor(), this.xp())));
  protected readonly width = computed(() => {
    const span = this.next() - this.floor();
    return span > 0 ? ((this.now() - this.floor()) / span) * 100 : 0;
  });
  private readonly format = computed(() => new Intl.NumberFormat(this.lang()));
  protected readonly xpText = computed(() => this.format().format(this.xp()));
  protected readonly nextText = computed(() => this.format().format(this.next()));
}
