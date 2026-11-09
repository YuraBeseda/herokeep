import { DOCUMENT } from '@angular/common';
import { Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '@shared/icons/icon.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { HkDescriptionDrawerComponent } from '../../../../ui/description-drawer/description-drawer.component';
import { HkFilterChipsComponent } from '../../../../ui/filter-chips/filter-chips.component';
import { HkPickerCardComponent } from '../../../../ui/picker-card/picker-card.component';
import { HkSearchFieldComponent } from '../../../../ui/search-field/search-field.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { HkWaxSealComponent } from '../../../../ui/wax-seal/wax-seal.component';
import { formatCost, formatWeight } from '../../../library/detail/entity-facts.formatters';
import type { FactValue } from '../../../library/detail/entity-facts.formatters';
import { FactValueComponent } from '../../../library/detail/fact-value.component';
import { bindPickerTools } from '../picker-tools.service';
import { descriptionExcerpt, pickerFacet, pickerFacts, pickerMeta } from './picker-facts';

interface EntityRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly description: string | null;
  readonly meta: string[];
  /** An item's weight and cost, formatted by the library's own formatters (`showItemDetails`). */
  readonly detail: FactValue[];
  /** The facts' values, for the filter chips. */
  readonly facts: ReadonlySet<string>;
  // Scope-relative i18n key of the reason this option can't be picked (see `gates`), if any.
  readonly gate: string | undefined;
}

const NO_GATES: ReadonlyMap<string, string> = new Map();

/** A search box earns its place once the list is longer than this. */
const SEARCH_THRESHOLD = 8;

/**
 * Picker for `query`/`static` pick forms (task-6-brief.md), as the plan-17 grid: a search field and
 * filter chips on top, then every option on the page (no inner scroll box) as `hk-picker-card`s
 * (`layout: 'cards'`) or as compact selectable rows with a tick seal (`layout: 'rows'`, long lists
 * such as weapons or skills). A card's body (rows: the info button) opens the option's description in
 * the shared `hk-description-drawer`, whose action slot carries the same Choose / Chosen button.
 *
 * A dumb, presentational component: it never talks to `CreateWizardState`; `ids`/`selectedIds` are
 * supplied by the caller (`ChoiceStepComponent`, the spells and equipment steps, the add-item
 * dialog) and every choice re-emits `toggled` with the id, leaving "is this a valid selection" to
 * the caller's `state.validate`.
 *
 * Inside the creation wizard the picker registers with `PickerToolsService`: the action strap's
 * Filter and Search buttons then fold the chips away and focus the search field. Without one (a
 * dialog) both stay on screen.
 *
 * `limit` (controller ruling, task-6 fix round): when the search-filtered result count exceeds it,
 * only the first `limit` options render, followed by a hint naming how many more are hidden.
 *
 * `gates` (plan 13 task 8, ruling 10): option id -> scope-relative i18n key of the reason the
 * caller's validation refuses that option. A gated option stays LISTED (discoverability) with its
 * choose control disabled and the reason as its hint; its details stay openable. A gated option that
 * is already SELECTED keeps its control enabled — the gate only blocks ADDING an option.
 */
@Component({
  selector: 'hk-entity-picker',
  imports: [
    TranslocoDirective,
    FactValueComponent,
    HkButtonComponent,
    HkDescriptionDrawerComponent,
    HkFilterChipsComponent,
    HkPickerCardComponent,
    HkSearchFieldComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    HkWaxSealComponent,
    IconComponent,
  ],
  providers: [provideTranslocoScope('characters'), provideTranslocoScope('library')],
  templateUrl: './entity-picker.component.html',
  styleUrl: './entity-picker.component.scss',
})
export class EntityPickerComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  // Inputs / Outputs
  readonly ids = input.required<readonly string[]>();
  readonly selectedIds = input<readonly string[]>([]);
  readonly limit = input<number | undefined>(undefined);
  readonly gates = input<ReadonlyMap<string, string>>(NO_GATES);
  readonly layout = input<'cards' | 'rows'>('cards');
  /** Rows show an item's weight and cost beside its name (the add-item dialog turns this on). */
  readonly showItemDetails = input(false);
  /** The whole list is read-only (another member holds the campaign edit lock). */
  readonly disabled = input(false);
  readonly toggled = output<string>();

  // Template-facing state
  protected readonly query = signal('');
  protected readonly activeFilters = signal<readonly string[]>([]);
  /** The option whose description the drawer shows (kept after closing, so the drawer can animate out). */
  protected readonly detailsId = signal<string | undefined>(undefined);
  protected readonly detailsOpen = signal(false);
  protected readonly detailsOpener = signal<HTMLElement | null>(null);

  // `Intl.Collator` construction is the expensive part; recreate only when the locale changes
  // (mirrors `LibraryBrowseComponent`'s own `collator` computed).
  private readonly collator = computed(() => new Intl.Collator(this.localeService.locale()));

  private readonly entities = computed(() => {
    const index = this.engineFacade.index();
    return this.ids().flatMap((id) => {
      const entity = index.get(id);
      return entity ? [entity] : [];
    });
  });

  /** The fact that splits the options into chips, if one does. */
  private readonly facet = computed(() => pickerFacet(this.entities()));

  protected readonly filterOptions = computed(() => {
    const facet = this.facet();
    if (!facet) return [];
    const counts = new Map<string, number>();
    for (const entity of this.entities()) {
      for (const fact of pickerFacts(entity)) {
        if (fact.key === facet.key) counts.set(fact.value, (counts.get(fact.value) ?? 0) + 1);
      }
    }
    const collator = this.collator();
    return facet.values
      .map((value) => ({ id: value, label: value, count: counts.get(value) ?? 0 }))
      .sort((a, b) => collator.compare(a.label, b.label));
  });

  protected readonly showSearch = computed(() => this.ids().length > SEARCH_THRESHOLD);
  protected readonly filtersVisible = bindPickerTools({
    host: this.host,
    hasFilters: computed(() => this.filterOptions().length > 0),
    onFold: () => this.activeFilters.set([]),
  }).filtersVisible;

  // The full search-filtered, sorted row set — BEFORE `limit` truncates it. `rows`/`hiddenCount`
  // below both derive from this so the hint's count and the rendered slice always agree.
  private readonly allRows = computed<EntityRow[]>(() => {
    const localizer = this.engineFacade.localizer();
    const text = this.query().trim().toLowerCase();
    const filters = this.activeFilters();
    const collator = this.collator();
    const gates = this.gates();
    const facetKey = this.facet()?.key;
    const details = this.showItemDetails();

    const mapped = this.entities()
      .map((entity): EntityRow => {
        const facts = pickerFacts(entity);
        return {
          id: entity.id,
          name: localizer.name(entity.id),
          icon: this.engineFacade.iconFor(entity),
          description: descriptionExcerpt(localizer.text(entity.id, 'description').text),
          meta: pickerMeta(entity, details ? ['fact.cost', 'fact.weight'] : []),
          detail:
            details && entity.type === 'item'
              ? [
                  ...(entity.weight !== undefined ? [formatWeight(entity.weight)] : []),
                  ...(entity.cost ? [formatCost(entity.cost)] : []),
                ]
              : [],
          facts: new Set(facts.filter((f) => f.key === facetKey).map((f) => f.value)),
          gate: gates.get(entity.id),
        };
      })
      .filter((row) => !text || row.name.toLowerCase().includes(text))
      .filter((row) => filters.length === 0 || filters.some((value) => row.facts.has(value)));
    return mapped.sort((a, b) => collator.compare(a.name, b.name));
  });

  protected readonly rows = computed<EntityRow[]>(() => {
    const all = this.allRows();
    const limit = this.limit();
    return limit !== undefined && all.length > limit ? all.slice(0, limit) : all;
  });

  // How many rows `limit` is hiding — `0` (no hint rendered) whenever `limit` is unset or the
  // (search-filtered) result count is already at or under it.
  protected readonly hiddenCount = computed<number>(() => {
    const all = this.allRows();
    const limit = this.limit();
    return limit !== undefined && all.length > limit ? all.length - limit : 0;
  });

  /** The row the open drawer is about, for its Choose button. */
  protected readonly detailsRow = computed(() => {
    const id = this.detailsId();
    return id === undefined ? undefined : this.allRows().find((row) => row.id === id);
  });

  // Methods
  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected onToggle(id: string): void {
    if (this.disabled()) return;
    this.toggled.emit(id);
  }

  /** A gated option cannot be added; one that is already picked can always be un-picked. */
  protected blocked(row: EntityRow): boolean {
    return this.disabled() || (!!row.gate && !this.isSelected(row.id));
  }

  // The description opens in the shared description drawer, which resolves the entity against this
  // picker's own pack scope.
  protected onDetails(id: string, event?: Event): void {
    const opener = (event?.currentTarget as HTMLElement | null) ?? this.document.activeElement;
    this.detailsOpener.set(opener instanceof HTMLElement ? opener : null);
    this.detailsId.set(id);
    this.detailsOpen.set(true);
  }
}
