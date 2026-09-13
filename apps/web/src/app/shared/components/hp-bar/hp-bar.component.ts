import { Component, computed, input } from '@angular/core';

// `value/base` -> a clamped [0, 100] percentage; `base <= 0` (a still-loading sheet, or content
// data that hasn't resolved a max yet) reads as an empty bar rather than dividing by zero.
function widthPct(value: number, base: number): number {
  if (base <= 0) return 0;
  return Math.max(0, Math.min(100, (value / base) * 100));
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

  // Fix-round-1 (code review): the percentage base is normally `max`, but widens to
  // `current + temp` whenever that's larger — otherwise, at full HP (`current === max`),
  // `currentPct` clamps to 100 and the temp overlay (positioned at `left: 100%`) sits entirely
  // past the track's right edge, clipped by `overflow: hidden` in the SCSS — invisible exactly
  // when a full-HP character gains temp HP (False Life, Aid, …). Widening the base instead
  // shrinks BOTH segments proportionally so fill+temp always share the track and nothing clips.
  private readonly displayMax = computed(() => Math.max(this.max(), this.current() + this.temp()));

  // Derived
  protected readonly currentPct = computed(() => widthPct(this.current(), this.displayMax()));
  protected readonly tempPct = computed(() => widthPct(this.temp(), this.displayMax()));
}
