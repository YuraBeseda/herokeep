import { Component, DestroyRef, ElementRef, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { Entity, EntityType } from '@hk/protocol';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { VirtualListComponent } from '@shared/components/virtual-list/virtual-list.component';
import { IconComponent } from '@shared/icons/icon.component';
import { hasProse } from '@shared/services/engine/class-columns';
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

const SORTS: readonly LibrarySort[] = ['match', 'name', 'type', 'level'];

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
  private readonly route = inject(ActivatedRoute);
  private readonly strap = inject(ActionStrapService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Template-facing state
  protected readonly ready = this.packStore.ready;
  // The list state lives in the URL (`?type=&q=&sort=`, all optional) so leaving for an entry and
  // coming back keeps the chip, the search text and the sort.
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });
  protected readonly query = computed(() => this.params().get('q') ?? '');
  protected readonly skeletonRows: readonly number[] = Array.from(
    { length: SKELETON_ROW_COUNT },
    (_, index) => index,
  );

  // Non-empty (trimmed) query switches the list from "browse the chosen types" to "search across
  // all types" — drives both `rows` below and the results-summary line in the template.
  protected readonly searching = computed(() => this.query().trim().length > 0);

  // One chip at a time; no (or an unknown) `type` means every type.
  protected readonly selectedTypes = computed<readonly string[]>(() => {
    const type = this.params().get('type');
    return LIBRARY_TYPES.find((known) => known === type) ? [type!] : [];
  });

  // `Intl.Collator` construction is the expensive part; recreate it only when the locale changes.
  private readonly collator = computed(() => new Intl.Collator(this.localeService.locale()));

  // Class-table column features ("[Column data]") stay in the pack but are not library entries.
  private readonly listed = computed(() => {
    const localizer = this.engineFacade.localizer();
    return (entity: Entity): boolean =>
      entity.type !== 'feature' || hasProse(localizer.text(entity.id, 'description').text);
  });

  // Every ranked hit for the query, before the type chips narrow it: the chips' counts come from
  // here, so a count is "how many of this type match the query".
  private readonly rankedHits = computed(() => {
    const text = this.query().trim();
    if (!text) return [];
    const index = this.engineFacade.index();
    const hits = this.engineFacade.search().query(text);
    const listed = this.listed();
    return rankLibraryHits(hits, text, (id) => index.get(id)?.name, this.collator()).filter(
      (hit) => {
        const entity = index.get(hit.id);
        return !entity || listed(entity);
      },
    );
  });

  // Per-type counts: how many entries each chip would show. While searching, the hits per type;
  // while browsing, every type's size.
  protected readonly typeCounts = computed<ReadonlyMap<string, number>>(() => {
    if (this.searching()) return countByType(this.rankedHits());
    const index = this.engineFacade.index();
    const listed = this.listed();
    return new Map(
      LIBRARY_TYPES.map((type) => [type, index.byType(type).filter(listed).length]),
    );
  });

  // The list order. `match` is the search ranking while searching and name order while browsing.
  protected readonly sort = computed<LibrarySort>(() => {
    const value = this.params().get('sort');
    return SORTS.find((mode) => mode === value) ?? 'match';
  });

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
          .filter(this.listed())
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
    const mode = SORTS.find((known) => known === value);
    if (mode) this.write({ sort: mode });
  }

  protected setQuery(text: string): void {
    this.write({ q: text || null });
  }

  // Replaces the history entry (one Back leaves the library, not each keystroke); `null` drops a param.
  private write(queryParams: Record<string, string | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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
    this.write({ type: types.find((type) => !current.includes(type)) ?? null });
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
