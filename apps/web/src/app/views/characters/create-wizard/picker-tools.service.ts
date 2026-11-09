import { computed, Injectable, signal } from '@angular/core';

/**
 * The bridge between the action strap's zone 3 (Filter · Search) and the picker on screen. The
 * wizard provides one instance; every `hk-entity-picker` inside it registers while mounted, so the
 * strap shows the two actions exactly on picker steps, and a press reaches the picker.
 *
 * Outside the wizard (the add-item dialog, level-up) no instance is provided and pickers keep their
 * own search field and filter chips always visible.
 */
@Injectable()
export class PickerToolsService {
  private readonly pickers = signal(0);
  private readonly pickersWithFilters = signal(0);

  /** At least one picker is on screen. */
  readonly active = computed(() => this.pickers() > 0);
  /** At least one on-screen picker has filter chips to show. */
  readonly hasFilters = computed(() => this.pickersWithFilters() > 0);
  /** `null`: the layout decides (chips shown on desktop, folded on phones); a press overrides it. */
  readonly filterOpen = signal<boolean | null>(null);
  /** Bumped by every Search press; pickers focus their search field when it changes. */
  readonly searchRequests = signal(0);

  /** Returns the callback that unregisters the picker again. */
  register(): () => void {
    this.pickers.update((n) => n + 1);
    return () => this.pickers.update((n) => n - 1);
  }

  /** A picker reports whether it has chips; returns the callback that withdraws the report. */
  reportFilters(): () => void {
    this.pickersWithFilters.update((n) => n + 1);
    return () => this.pickersWithFilters.update((n) => n - 1);
  }

  toggleFilters(visibleNow: boolean): void {
    this.filterOpen.set(!visibleNow);
  }

  requestSearch(): void {
    this.searchRequests.update((n) => n + 1);
  }
}
