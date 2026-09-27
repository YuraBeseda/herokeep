import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * A clickable pip row for a bounded `[0, max]` counter (spell slots, limited-use resources):
 * `used` of `max` pips render filled/`aria-pressed="true"`. Clicking a FILLED pip emits
 * `restore`; clicking an EMPTY one emits `spend` — no index/count payload, every click is worth
 * exactly one unit. What "one unit" actually does to the underlying event (`slot.restored`'s own
 * default single-slot decrement vs. `resource.restored`'s own full-reset-to-0 default — see
 * `play-tab.component.ts`'s `onRestoreResource` comment) is entirely the CALLER's concern, never
 * this component's — it only ever counts pips.
 *
 * Unlike `hk-hp-bar` (purely decorative, `aria-hidden`, paired with separately-accessible text),
 * this component IS the only click surface for spend/restore, so every pip needs a real
 * accessible name — `labelKey` is a full (unscoped) Transloco key resolved through this
 * component's OWN `*transloco="let t"` (same "no scope of its own" convention `hk-number-field`/
 * `hk-toast` already use), interpolated with `{index, max}` (this pip's 1-based position and the
 * row's total) plus whatever extra `labelParams` the caller supplies (e.g. `{level}` for a spell
 * slot row, `{name}` for a resource).
 *
 * `viewReadonly` (plan-10 task-9-brief.md, the DM party-sheet drill-in's readonly-input refactor —
 * `[viewReadonly]` in a template, never aliased to a bare `readonly` attribute:
 * `@angular-eslint/no-input-rename` disallows that): defaults to `false`, byte-identical to every
 * pre-existing consumer (`play-tab.component.ts`'s own spell-slot/resource rows never set it).
 * `true` renders every pip permanently `disabled`
 * (fill state still visible via `aria-pressed`/the `--filled` class — a read-only viewer still
 * needs to SEE what's spent, just never click) and makes `onPipClick` itself a defensive no-op —
 * belt-and-braces alongside the disabled attribute, which already suppresses native click/keyboard
 * activation in every browser and in jsdom.
 */
@Component({
  selector: 'hk-pips',
  imports: [TranslocoDirective],
  templateUrl: './pips.component.html',
  styleUrl: './pips.component.scss',
})
export class PipsComponent {
  // Inputs / Outputs
  readonly max = input.required<number>();
  readonly used = input.required<number>();
  readonly labelKey = input.required<string>();
  readonly labelParams = input<Record<string, unknown>>({});
  readonly viewReadonly = input(false);

  readonly spend = output<void>();
  readonly restore = output<void>();

  // Derived
  protected readonly indexes = computed(() =>
    Array.from({ length: Math.max(0, this.max()) }, (_, i) => i),
  );

  // Methods

  protected filled(i: number): boolean {
    return i < this.used();
  }

  // Structurally unreachable under a well-formed `[0, max]` `used` (a filled pip always implies
  // `used >= 1`; an empty one always implies `used < max`) — kept as an explicit bounds guard
  // rather than relied-upon dead code, so a caller passing a transiently out-of-range `used`
  // (e.g. mid-flight between a click and the store's async `appendTx` resolving, or a stale
  // `max`/`used` pair) can never double-fire past either bound.
  protected disabled(i: number): boolean {
    return this.filled(i) ? this.used() <= 0 : this.used() >= this.max();
  }

  protected pipParams(i: number): Record<string, unknown> {
    return { ...this.labelParams(), index: i + 1, max: this.max() };
  }

  protected onPipClick(i: number): void {
    if (this.viewReadonly() || this.disabled(i)) return;
    if (this.filled(i)) {
      this.restore.emit();
    } else {
      this.spend.emit();
    }
  }
}
