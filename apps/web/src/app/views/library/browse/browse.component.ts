import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { EntityType } from '@hk/protocol';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { SearchFieldComponent } from '@shared/components/search-field/search-field.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { VirtualListComponent } from '@shared/components/virtual-list/virtual-list.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { IconComponent } from '@shared/icons/icon.component';
import { PackStore } from '@shared/stores/pack.store';

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

const SKELETON_ROW_COUNT = 6;

interface LibraryRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly fallback: boolean;
}

@Component({
  selector: 'app-library-browse',
  imports: [
    TranslocoDirective,
    ChipComponent,
    SearchFieldComponent,
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

  // Template-facing state
  protected readonly types = LIBRARY_TYPES;
  protected readonly ready = this.packStore.ready;
  protected readonly selectedType = signal<EntityType>('spell');
  // Rendered inert this task — Task 11 reads this signal to drive search-mode rows.
  protected readonly query = signal('');
  protected readonly skeletonRows: readonly number[] = Array.from(
    { length: SKELETON_ROW_COUNT },
    (_, index) => index,
  );

  // `Intl.Collator` construction is the expensive part; recreate it only when the locale
  // changes (a `computed` keyed on `locale()`) rather than once per `.compare()` call below.
  private readonly collator = computed(() => new Intl.Collator(this.localeService.locale()));

  protected readonly rows = computed<LibraryRow[]>(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const locale = this.localeService.locale();
    const collator = this.collator();

    const mapped = index.byType(this.selectedType()).map((entity): LibraryRow => {
      const localizedName = localizer.text(entity.id, 'name');
      return {
        id: entity.id,
        name: localizedName.text,
        icon: this.engineFacade.iconFor(entity),
        fallback: localizedName.isFallback && locale !== 'en',
      };
    });
    return mapped.sort((a, b) => collator.compare(a.name, b.name));
  });

  // Methods
  protected selectType(type: EntityType): void {
    this.selectedType.set(type);
  }

  // Passes the raw (unencoded) entity id straight through as its own router command segment.
  // Angular's own URL serializer already escapes an embedded `/` as `%2F` (keeping the id a
  // single path segment) and leaves `:` untouched (a valid path-segment character), decoding
  // both back to the exact original string when the URL is parsed again — verified empirically
  // (see the regression test in browse.component.spec.ts and task-10-report.md). Calling
  // `encodeURIComponent` here first would double-encode (the router would then also escape the
  // `%` it introduces), breaking the round trip — so this deliberately does NOT pre-encode.
  protected onRowClick(id: string): void {
    void this.router.navigate(['/library', id]);
  }
}
