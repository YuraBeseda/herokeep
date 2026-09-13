import { Component, computed, inject, input, output, resource, signal } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CardComponent } from '@shared/components/card/card.component';
import { SearchFieldComponent } from '@shared/components/search-field/search-field.component';
import { IconComponent } from '@shared/icons/icon.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';

interface EntityRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
}

/**
 * Card-grid picker for `query`/`static` pick forms (task-6-brief.md). A dumb, presentational
 * component: it never talks to `CreateWizardState` itself — `ids`/`selectedIds` are supplied by
 * the caller (`ChoiceStepComponent`), and every tap just re-emits `toggle` with the tapped id,
 * leaving the "is this a valid selection" question entirely to the caller's `state.validate`.
 *
 * Deliberately NOT `hk-virtual-list`-backed (unlike `library`'s browse list): a card here can
 * expand in place to show its full markdown description, and `hk-virtual-list`'s fixed-size CDK
 * strategy assumes every row is the same height (see its SKILL.md) — an expanded row would
 * overflow its allotted band. Creation-choice option counts (species/background/class/feats) are
 * small (single/low-double digits in the SRD pack), so a plain scrollable list is both simpler and
 * correct; a future large-option-count choice (e.g. spells) can revisit this.
 */
@Component({
  selector: 'hk-entity-picker',
  imports: [TranslocoDirective, CardComponent, SearchFieldComponent, IconComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './entity-picker.component.html',
  styleUrl: './entity-picker.component.scss',
})
export class EntityPickerComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);
  private readonly markdownService = inject(MarkdownService);

  // Inputs / Outputs
  readonly ids = input.required<readonly string[]>();
  readonly selectedIds = input<readonly string[]>([]);
  readonly toggled = output<string>();

  // Template-facing state
  protected readonly query = signal('');
  protected readonly expandedId = signal<string | undefined>(undefined);

  // `Intl.Collator` construction is the expensive part; recreate only when the locale changes
  // (mirrors `LibraryBrowseComponent`'s own `collator` computed).
  private readonly collator = computed(() => new Intl.Collator(this.localeService.locale()));

  protected readonly rows = computed<EntityRow[]>(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const text = this.query().trim().toLowerCase();
    const collator = this.collator();

    const mapped = this.ids()
      .map((id): EntityRow | undefined => {
        const entity = index.get(id);
        if (!entity) return undefined;
        return { id, name: localizer.name(id), icon: this.engineFacade.iconFor(entity) };
      })
      .filter((row): row is EntityRow => row !== undefined)
      .filter((row) => !text || row.name.toLowerCase().includes(text));
    return mapped.sort((a, b) => collator.compare(a.name, b.name));
  });

  // Re-renders the currently-expanded card's `description` field as sanitized markdown, reusing
  // the library detail page's own `MarkdownService` (task-6-brief.md: "reuse, do not
  // re-implement sanitization"). `resource()` skips the loader entirely while `expandedId` is
  // `undefined` (nothing expanded) and cancels a still-in-flight render when the expanded card
  // changes.
  protected readonly descriptionHtml = resource({
    params: () => this.expandedId(),
    loader: ({ params }): Promise<SafeHtml | undefined> => {
      if (!params) return Promise.resolve(undefined);
      const description = this.engineFacade.localizer().text(params, 'description').text;
      return description ? this.markdownService.render(description) : Promise.resolve(undefined);
    },
  });

  // Methods
  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected onToggle(id: string): void {
    this.toggled.emit(id);
  }

  // Expansion is a secondary affordance nested inside the same card as the selection button;
  // `stopPropagation` keeps it from also toggling selection.
  protected onExpand(id: string, event: Event): void {
    event.stopPropagation();
    this.expandedId.set(this.expandedId() === id ? undefined : id);
  }
}
