import { Component, computed, inject, input, output, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CardComponent } from '@shared/components/card/card.component';
import { SearchFieldComponent } from '@shared/components/search-field/search-field.component';
import { IconComponent } from '@shared/icons/icon.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { HkDescriptionDrawerComponent } from '../../../../ui/description-drawer/description-drawer.component';

interface EntityRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  // Scope-relative i18n key of the reason this option can't be picked (see `gates`), if any.
  readonly gate: string | undefined;
}

const NO_GATES: ReadonlyMap<string, string> = new Map();

// Per-instance prefix for the gate-reason element ids (`aria-describedby` targets): several pickers
// can render on one page (the build tab's outstanding list), each listing the same entity ids.
let nextEntityPickerId = 0;

/**
 * Card-grid picker for `query`/`static` pick forms (task-6-brief.md). A dumb, presentational
 * component: it never talks to `CreateWizardState` itself — `ids`/`selectedIds` are supplied by
 * the caller (`ChoiceStepComponent`), and every tap just re-emits `toggle` with the tapped id,
 * leaving the "is this a valid selection" question entirely to the caller's `state.validate`.
 *
 * Deliberately NOT `hk-virtual-list`-backed (unlike `library`'s browse list): `hk-virtual-list`'s
 * fixed-size CDK strategy assumes every row is the same height (see its SKILL.md). A card's Details
 * button opens the entity's description in the shared `hk-description-drawer` (one place every pack
 * description opens), not inline. Creation-choice option counts (species/background/class/feats) are
 * small (single/low-double digits in the SRD pack), so a plain scrollable list is both simpler and
 * correct. For a genuinely large option count (e.g. task 8's 339-spell picker), the caller instead
 * passes `limit` (controller ruling, task-6 fix round): when the search-filtered result count
 * exceeds it, only the first `limit` cards render, followed by a non-interactive hint row naming
 * how many more are hidden — narrowing the search below `limit` removes the hint. `undefined`
 * (the default) keeps today's unlimited behavior.
 *
 * `gates` (plan 13 task 8, ruling 10): option id -> scope-relative i18n key of the reason the
 * caller's validation refuses that option. A gated card stays LISTED (discoverability) but its
 * select button is `disabled`, with the reason rendered visibly and wired to the button via
 * `aria-describedby` (the plan-12 always-prepared disabled-with-reason pattern); its Details
 * button stays usable. A gated card that is already SELECTED (e.g. a pre-seeded pick the current
 * validation now refuses) keeps its select button enabled — the gate only blocks ADDING an option,
 * never undoing a pick — and still shows its reason.
 */
@Component({
  selector: 'hk-entity-picker',
  imports: [
    TranslocoDirective,
    CardComponent,
    SearchFieldComponent,
    IconComponent,
    HkDescriptionDrawerComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './entity-picker.component.html',
  styleUrl: './entity-picker.component.scss',
})
export class EntityPickerComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);

  // Inputs / Outputs
  readonly ids = input.required<readonly string[]>();
  readonly selectedIds = input<readonly string[]>([]);
  readonly limit = input<number | undefined>(undefined);
  readonly gates = input<ReadonlyMap<string, string>>(NO_GATES);
  readonly toggled = output<string>();

  // Template-facing state
  protected readonly query = signal('');
  /** The option whose description the drawer shows (kept after closing, so the drawer can animate out). */
  protected readonly detailsId = signal<string | undefined>(undefined);
  protected readonly detailsOpen = signal(false);
  protected readonly detailsOpener = signal<HTMLElement | null>(null);
  protected readonly gateIdPrefix = `hk-entity-picker-${nextEntityPickerId++}-gate-`;

  // `Intl.Collator` construction is the expensive part; recreate only when the locale changes
  // (mirrors `LibraryBrowseComponent`'s own `collator` computed).
  private readonly collator = computed(() => new Intl.Collator(this.localeService.locale()));

  // The full search-filtered, sorted row set — BEFORE `limit` truncates it. `rows`/`hiddenCount`
  // below both derive from this so the hint's count and the rendered slice always agree.
  private readonly allRows = computed<EntityRow[]>(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const text = this.query().trim().toLowerCase();
    const collator = this.collator();
    const gates = this.gates();

    const mapped = this.ids()
      .map((id): EntityRow | undefined => {
        const entity = index.get(id);
        if (!entity) return undefined;
        return {
          id,
          name: localizer.name(id),
          icon: this.engineFacade.iconFor(entity),
          gate: gates.get(id),
        };
      })
      .filter((row): row is EntityRow => row !== undefined)
      .filter((row) => !text || row.name.toLowerCase().includes(text));
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

  // Methods
  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected onToggle(id: string): void {
    this.toggled.emit(id);
  }

  // The description is a secondary affordance nested inside the same card as the selection button;
  // `stopPropagation` keeps it from also toggling selection. It opens in the shared description
  // drawer, which resolves the entity against this picker's own pack scope.
  protected onDetails(id: string, event: Event): void {
    event.stopPropagation();
    this.detailsOpener.set(event.currentTarget as HTMLElement);
    this.detailsId.set(id);
    this.detailsOpen.set(true);
  }
}
