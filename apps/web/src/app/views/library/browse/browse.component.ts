import { Component, DestroyRef, ElementRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { Entity, EntityType } from '@hk/protocol';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { VirtualListComponent } from '@shared/components/virtual-list/virtual-list.component';
import { IconComponent } from '@shared/icons/icon.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import {
  countByType,
  highlightSegments,
  rankLibraryHits,
  type NameSegment,
} from '@shared/services/library/library-search';
import { PackStore } from '@shared/stores/pack.store';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import {
  HkFilterChipsComponent,
  type FilterChipOption,
} from '../../../ui/filter-chips/filter-chips.component';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { HkSearchFieldComponent } from '../../../ui/search-field/search-field.component';
import { HkTagChipComponent } from '../../../ui/tag-chip/tag-chip.component';
import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import { HkSelectComponent, type SelectOption } from '../../../ui/select/select.component';
import { FactValueComponent } from '../detail/fact-value.component';
import type { FactValue } from '../../../ui/entity-facts/entity-facts.formatters';
import { levelOf, subLineFor, type LibrarySort } from './library-row';
import { buildLibraryStrap } from './library-strap';

// Fixed type-filter order — matches the `library` scope's `type.<t>` keys, not alphabetical.
const LIBRARY_TYPES: readonly EntityType[] = [
  'class',
  'subclass',
  'species',
  'background',
  'feat',
  'spell',
  'item',
  'feature',
  'condition',
  'skill',
  'language',
  'rule',
];

// A glyph per type chip (board LB01); every slug is already in the icon sprite.
const TYPE_ICONS: Readonly<Record<string, string>> = {
  class: 'gi:templar-shield',
  subclass: 'gi:holy-symbol',
  species: 'gi:person',
  background: 'gi:medal',
  feat: 'gi:laurel-crown',
  spell: 'gi:spell-book',
  item: 'gi:swap-bag',
  feature: 'gi:laurels',
  condition: 'gi:skull',
  skill: 'gi:acrobatic',
  language: 'gi:conversation',
  rule: 'gi:scroll-unfurled',
};

/** Until the person picks a chip, browsing a list shows spells (the first thing most look up). */
const DEFAULT_BROWSE_TYPES: readonly string[] = ['spell'];

const SKELETON_ROW_COUNT = 6;
// Search results are capped (browse-mode lists are not): the first 100 ranked hits are plenty and
// keep the summary a bounded number.
const SEARCH_RESULT_LIMIT = 100;

interface LibraryRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly fallback: boolean;
  readonly type: EntityType;
  /** The short line under the name (level and school, category and cost, ...). */
  readonly sub: readonly FactValue[];
  /** The name split into plain and matched runs for the query. */
  readonly segments: readonly NameSegment[];
}

@Component({
  selector: 'app-library-browse',
  imports: [
    TranslocoDirective,
    HkFilterChipsComponent,
    HkLeafComponent,
    HkSearchFieldComponent,
    HkSelectComponent,
    FactValueComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    SkeletonComponent,
    VirtualListComponent,
    IconComponent,
  ],
  providers: [provideTranslocoScope('library')],
  templateUrl: './browse.component.html',
  styleUrl: './browse.component.scss',
})
export class LibraryBrowseComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);
  private readonly packStore = inject(PackStore);
  private readonly router = inject(Router);
  private readonly strap = inject(ActionStrapService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Template-facing state
  protected readonly ready = this.packStore.ready;
  protected readonly query = signal('');
  protected readonly skeletonRows: readonly number[] = Array.from(
    { length: SKELETON_ROW_COUNT },
    (_, index) => index,
  );

  // Non-empty (trimmed) query switches the list from "browse the chosen types" to "search across
  // all types" — drives both `rows` below and the results-summary line in the template.
  protected readonly searching = computed(() => this.query().trim().length > 0);

  // The person's own chip choice; `null` until they touch a chip. An EXPLICIT empty list means
  // "every type".
  private readonly chosenTypes = signal<readonly string[] | null>(null);

  // Untouched, browsing shows spells and searching shows hits of every type (a search should find
  // the item "Wand of Fireballs" even while the spell chip is the browse default); once a chip is
  // pressed the choice holds in both modes.
  protected readonly selectedTypes = computed<readonly string[]>(
    () => this.chosenTypes() ?? (this.searching() ? [] : DEFAULT_BROWSE_TYPES),
  );

  // `Intl.Collator` construction is the expensive part; recreate it only when the locale changes.
  private readonly collator = computed(() => new Intl.Collator(this.localeService.locale()));

  // Every ranked hit for the query, before the type chips narrow it: the chips' counts come from
  // here, so a count is "how many of this type match the query".
  private readonly rankedHits = computed(() => {
    const text = this.query().trim();
    if (!text) return [];
    const index = this.engineFacade.index();
    const hits = this.engineFacade.search().query(text);
    return rankLibraryHits(hits, text, (id) => index.get(id)?.name, this.collator());
  });

  // Per-type counts: how many entries each chip would show. While searching, the hits per type;
  // while browsing, every type's size.
  protected readonly typeCounts = computed<ReadonlyMap<string, number>>(() => {
    if (this.searching()) return countByType(this.rankedHits());
    const index = this.engineFacade.index();
    return new Map(LIBRARY_TYPES.map((type) => [type, index.byType(type).length]));
  });

  // The list order. `match` is the search ranking while searching and name order while browsing.
  protected readonly sort = signal<LibrarySort>('match');

  // The total the "All" chip counts: every hit while searching, every entry while browsing.
  protected readonly allCount = computed(() => {
    let total = 0;
    for (const count of this.typeCounts().values()) total += count;
    return total;
  });

  protected readonly rows = computed<LibraryRow[]>(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const locale = this.localeService.locale();
    const collator = this.collator();
    const text = this.query().trim();
    const chosen = this.selectedTypes();
    const narrow = (type: EntityType): boolean => chosen.length === 0 || chosen.includes(type);

    interface Base {
      readonly entity: Entity;
      readonly name: string;
    }
    let bases: Base[];
    if (this.searching()) {
      bases = this.rankedHits()
        .filter((hit) => narrow(hit.type))
        .map((hit) => {
          const entity = index.get(hit.id);
          if (!entity) throw new Error(`search hit references unknown entity "${hit.id}"`);
          return { entity, name: hit.name };
        });
    } else {
      bases = LIBRARY_TYPES.filter((type) => narrow(type)).flatMap((type) =>
        index
          .byType(type)
          .map((entity) => ({ entity, name: localizer.text(entity.id, 'name').text })),
      );
    }

    const byName = (a: Base, b: Base): number => collator.compare(a.name, b.name);
    const mode = this.sort();
    if (mode === 'name' || (mode === 'match' && !this.searching())) {
      bases.sort(byName);
    } else if (mode === 'type') {
      bases.sort(
        (a, b) =>
          LIBRARY_TYPES.indexOf(a.entity.type) - LIBRARY_TYPES.indexOf(b.entity.type) ||
          byName(a, b),
      );
    } else if (mode === 'level') {
      bases.sort(
        (a, b) =>
          (levelOf(a.entity) ?? Number.POSITIVE_INFINITY) -
            (levelOf(b.entity) ?? Number.POSITIVE_INFINITY) || byName(a, b),
      );
    }
    // Search results are capped; a browsed list is not.
    const shown = this.searching() ? bases.slice(0, SEARCH_RESULT_LIMIT) : bases;

    return shown.map(({ entity, name }): LibraryRow => {
      const localizedName = localizer.text(entity.id, 'name');
      return {
        id: entity.id,
        name,
        icon: this.engineFacade.iconFor(entity),
        fallback: localizedName.isFallback && locale !== 'en',
        type: entity.type,
        sub: subLineFor(entity, index, localizer),
        segments: this.searching() ? highlightSegments(name, text) : [{ text: name, hit: false }],
      };
    });
  });

  constructor() {
    // Zone 2/3 of the strap; released when the library closes.
    effect(() =>
      this.strap.set(
        buildLibraryStrap({
          newHomebrew: () => void this.router.navigate(['/packs', 'homebrew']),
          importPack: () => void this.router.navigate(['/packs']),
          focusFilter: () => this.focus('.hk-filter-chips__chip'),
          focusSearch: () => this.focus('input[type="search"]'),
        }),
      ),
    );
    inject(DestroyRef).onDestroy(() => this.strap.clear());
  }

  // The chips' options, memoized on what they show so `hk-filter-chips` does not see a new array
  // on every change detection pass.
  private optionsMemo: readonly FilterChipOption[] = [];
  protected typeOptions(
    t: (key: string, params?: Record<string, unknown>) => string,
  ): readonly FilterChipOption[] {
    const counts = this.typeCounts();
    const text = this.query().trim();
    const next = LIBRARY_TYPES.map((type): FilterChipOption => {
      const count = counts.get(type) ?? 0;
      const label = t('type.' + type);
      return {
        id: type,
        label,
        icon: TYPE_ICONS[type],
        count,
        ...(this.searching() && count === 0
          ? { disabledReason: t('search.no-type-match', { type: label, query: text }) }
          : {}),
      };
    });
    const same =
      next.length === this.optionsMemo.length &&
      next.every((option, i) => {
        const prior = this.optionsMemo[i];
        return (
          prior?.label === option.label &&
          prior.count === option.count &&
          prior.disabledReason === option.disabledReason
        );
      });
    return same ? this.optionsMemo : (this.optionsMemo = next);
  }

  private sortOptionsMemo: readonly SelectOption[] = [];
  protected sortOptions(t: (key: string) => string): readonly SelectOption[] {
    const next = (['match', 'name', 'type', 'level'] as const).map((value) => ({
      value,
      label: t('sort.' + value),
    }));
    const same =
      next.length === this.sortOptionsMemo.length &&
      next.every((option, i) => option.label === this.sortOptionsMemo[i]?.label);
    return same ? this.sortOptionsMemo : (this.sortOptionsMemo = next);
  }

  protected setSort(value: string | null): void {
    if (value === 'match' || value === 'name' || value === 'type' || value === 'level') {
      this.sort.set(value);
    }
  }

  // Methods
  /** The whole summary line as plain text: the row ellipsises it, so this is its hint. */
  protected subText(
    parts: readonly FactValue[],
    t: (key: string, params?: Record<string, unknown>) => string,
  ): string {
    return parts
      .map((part) => (part.kind === 'key' ? t(part.key, part.params) : part.text))
      .join(' · ');
  }

  protected typeIcon(type: EntityType): string | null {
    return TYPE_ICONS[type] ?? null;
  }

  // The chips behave as one choice: pressing a chip shows that type alone, pressing the pressed
  // chip (or "Clear filters") shows every type. `hk-filter-chips` reports a toggled set, so the
  // chip that was just switched ON is the one that wins.
  protected setTypes(types: readonly string[]): void {
    const current = this.selectedTypes();
    const added = types.find((type) => !current.includes(type));
    this.chosenTypes.set(added === undefined ? [] : [added]);
  }

  // Passes the raw (unencoded) entity id straight through as its own router command segment.
  // Angular's own URL serializer already escapes an embedded `/` as `%2F` (keeping the id a
  // single path segment) and leaves `:` untouched (a valid path-segment character), decoding
  // both back to the exact original string when the URL is parsed again — verified empirically
  // (see the regression test in browse.component.spec.ts). Calling `encodeURIComponent` here
  // first would double-encode, breaking the round trip — so this deliberately does NOT pre-encode.
  protected onRowClick(id: string): void {
    void this.router.navigate(['/library', id]);
  }

  private focus(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
