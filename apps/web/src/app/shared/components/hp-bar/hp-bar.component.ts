import { Component, computed, input } from '@angular/core';

// `value/max` -> a clamped [0, 100] percentage; `max <= 0` (a still-loading sheet, or content data
// that hasn't resolved a max yet) reads as an empty bar rather than dividing by zero.
function widthPct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/**
 * Pure presentational HP bar (task-2-brief.md): a track filled to `current / max`, with a `temp`
 * overlay segment starting where that fill ends. Does no HP arithmetic beyond the width-percentage
 * formatting above — clamping/reachability rules (what `current` and `temp` actually ARE) belong
 * to `propose.damage`/`heal`/`tempHp` (`packages/engine/src/propose/vitals.ts`), never here.
 * Decorative only (`aria-hidden`, mirrors `hk-skeleton`'s own convention): the numeric current/max/
 * temp values are already rendered as accessible text alongside this bar (`play-tab.component.html`'s
 * `hk-stat-tile` trio), so this would otherwise double-announce the same numbers.
 */
@Component({
  selector: 'hk-hp-bar',
  templateUrl: './hp-bar.component.html',
  styleUrl: './hp-bar.component.scss',
  host: {
    'aria-hidden': 'true',
  },
})
export class HpBarComponent {
  // Inputs
  readonly current = input.required<number>();
  readonly max = input.required<number>();
  readonly temp = input(0);

  // Derived
  protected readonly currentPct = computed(() => widthPct(this.current(), this.max()));
  protected readonly tempPct = computed(() => widthPct(this.temp(), this.max()));
}
