import { computed, signal, type Signal } from '@angular/core';
import type { Localizer } from '@hk/engine';
import type { Entity } from '@hk/protocol';
import { pickerFacet, pickerFacts } from './picker-facts';

/** Rows rendered before "Show more": a class's list can be long (level-up reuses the step). */
export const SPELL_ROWS_PER_PAGE = 60;
/** A search box earns its place once the list is longer than this. */
const SEARCH_THRESHOLD = 8;

/**
 * The search, filter chips and paging of one spell list on the spells step. Searches the localized
 * name, filters by the fact that best splits the list (the school), and renders at most one page of
 * rows (the rest behind "Show more"), so a large list is never rendered unbounded and never needs
 * an inner scroll box. Pure presentation over pack data.
 */
export class SpellListView {
  readonly query = signal('');
  readonly filters = signal<readonly string[]>([]);
  private readonly shown = signal(SPELL_ROWS_PER_PAGE);

  private readonly entities = computed(() => this.ids().map((id) => this.entityOf(id)));

  private readonly facet = computed(() =>
    pickerFacet(this.entities().flatMap((e) => (e ? [e] : []))),
  );

  readonly filterOptions = computed(() => {
    const facet = this.facet();
    if (!facet) return [];
    const counts = new Map<string, number>();
    for (const entity of this.entities()) {
      for (const fact of entity ? pickerFacts(entity) : []) {
        if (fact.key === facet.key) counts.set(fact.value, (counts.get(fact.value) ?? 0) + 1);
      }
    }
    return facet.values
      .map((value) => ({ id: value, label: value, count: counts.get(value) ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly showSearch = computed(() => this.ids().length > SEARCH_THRESHOLD);

  /** Every id that passes the search and the chips, in list order. */
  readonly matching = computed(() => {
    const text = this.query().trim().toLowerCase();
    const filters = this.filters();
    const facetKey = this.facet()?.key;
    const entities = this.entities();
    const localizer = this.localizer();
    return this.ids().filter((id, i) => {
      if (text && !localizer.name(id).toLowerCase().includes(text)) return false;
      if (filters.length === 0) return true;
      const entity = entities[i];
      return (
        !!entity && pickerFacts(entity).some((f) => f.key === facetKey && filters.includes(f.value))
      );
    });
  });

  readonly rows = computed(() => this.matching().slice(0, this.shown()));
  readonly hidden = computed(() => Math.max(0, this.matching().length - this.shown()));

  constructor(
    private readonly ids: Signal<string[]>,
    private readonly entityOf: (id: string) => Entity | undefined,
    private readonly localizer: Signal<Localizer>,
  ) {}

  showMore(): void {
    this.shown.update((n) => n + SPELL_ROWS_PER_PAGE);
  }
}
