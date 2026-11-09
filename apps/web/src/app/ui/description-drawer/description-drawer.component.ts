import {
  Component,
  computed,
  effect,
  inject,
  Injector,
  input,
  model,
  Renderer2,
  resource,
  viewChild,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Sheet } from '@hk/engine';
import type { Choice, Entity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { needsSheet, optionsForChoice } from '@shared/services/engine/choice-options';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharacterEngineScope } from '@shared/stores/character-engine-scope';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { CreateWizardState } from '../../views/characters/create-wizard/create-wizard.state';
import { EntityFactsComponent } from '../../views/library/detail/entity-facts.component';
import { HkDrawerComponent } from '../drawer/drawer.component';
import {
  HkOptionsChipComponent,
  type OptionsChipOption,
} from '../options-chip/options-chip.component';
import { HkTagChipComponent } from '../tag-chip/tag-chip.component';

type Opener = ElementRef<HTMLElement> | HTMLElement | null | undefined;

interface Section {
  /** Granted-feature name; absent for the entity's own text. */
  readonly name?: string;
  readonly text: string;
}

/** Feature ids an entity hands out: its own grants, plus a class's level-1 grants. */
function grantedFeatureIds(entity: Entity): readonly string[] {
  const grants = 'grants' in entity ? entity.grants : [];
  const first = entity.type === 'class' ? (entity.levels?.[0]?.grants ?? []) : [];
  const ids: string[] = [];
  for (const grant of [...grants, ...first]) {
    if ('feature' in grant && !ids.includes(grant.feature)) ids.push(grant.feature);
  }
  return ids;
}

/** A choice the entity (or, for a class, one of its level rows) offers, with its options. */
interface ChoiceRow {
  readonly id: string;
  readonly prompt: string;
  /** The class level the choice is made at; absent for an entity-level choice. */
  readonly level?: number;
  readonly count: number;
  readonly options: readonly OptionsChipOption[];
}

/** A choice's popover lists this many options; the chip's count is the whole set. */
const POPOVER_OPTION_LIMIT = 24;

/**
 * `hk-description-drawer` — the one place every pack description opens (design-system
 * DescriptionDrawer): species, class, background, feat, spell, item, condition, mastery. A caller
 * passes only the entity id (and, for a context action, a `[hkDrawerAction]` button).
 *
 * It resolves the id exactly as the library detail page does: `EngineFacade.index()` /
 * `.localizer()` for the entity, its name and its text, and `MarkdownService.render(markdown,
 * localizer)` for the sanitised body. Because `EngineFacade` is scoped by the ELEMENT injector
 * (`provideEngineScope`), a drawer rendered inside the character sheet or the wizard reads the
 * character's own pack set and localizer without being told which character it is; elsewhere it
 * reads the core's.
 *
 * An entity without text of its own (a species, a class) shows the text of the features it grants,
 * each under its name. An unknown id renders a "not found" note, never a blank drawer.
 */
@Component({
  selector: 'hk-description-drawer',
  imports: [
    TranslocoDirective,
    RouterLink,
    HkDrawerComponent,
    HkTagChipComponent,
    HkOptionsChipComponent,
    EntityFactsComponent,
  ],
  providers: [provideTranslocoScope('library')],
  templateUrl: './description-drawer.component.html',
  styleUrl: './description-drawer.component.scss',
})
export class HkDescriptionDrawerComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly markdownService = inject(MarkdownService);
  private readonly packStore = inject(PackStore);
  private readonly router = inject(Router);
  private readonly renderer = inject(Renderer2);
  private readonly injector = inject(Injector);
  // Present only under a hero's own sheet (or one of its dialogs).
  private readonly heroScope = inject(CharacterEngineScope, { optional: true });
  // Present only inside the creation wizard: its draft sheet is the hero a proficiency-gated pick is counted for.
  private readonly wizardState = inject(CreateWizardState, { optional: true });

  // Inputs
  /** A pack entity id, e.g. `srd-5e-2024:spell/fireball`. */
  readonly entity = input.required<string>();
  readonly open = model(false);
  /** The control that opened the drawer (focus returns to it). */
  readonly opener = input<Opener>(null);

  protected readonly ready = this.packStore.ready;
  /** Opened from a hero's sheet, the library entry is opened for that hero (`?for=`), so it can
   * offer "Add to hero"; elsewhere the entry opens plain. */
  protected readonly libraryQuery = computed<{ for?: string }>(() => {
    const heroId = this.heroScope ? this.injector.get(CharacterStore).streamId() : undefined;
    return heroId ? { for: heroId } : {};
  });
  protected readonly resolved = computed(() => this.engineFacade.index().get(this.entity()));
  protected readonly name = computed(() => this.engineFacade.localizer().name(this.entity()));

  /** The hero the entry is read for: the sheet under a hero, or the wizard's draft; none elsewhere. */
  private heroSheet(): Sheet | undefined {
    if (this.heroScope) return this.injector.get(CharacterStore).sheet();
    return this.wizardState?.draftSheet();
  }

  /** The library root, keeping the hero context (the chips' "See all in library" link). */
  protected readonly libraryRootHref = computed(() =>
    this.router.serializeUrl(
      this.router.createUrlTree(['/library'], { queryParams: this.libraryQuery() }),
    ),
  );

  /**
   * The choices the entry offers — a class's level-row choices, or an entity's own — each with
   * the options chip, counted by the same candidate evaluation the wizard pickers use. A choice with
   * no option list (ability scores, free text) is not listed.
   */
  protected readonly choices = computed<readonly ChoiceRow[]>(() => {
    const entity = this.resolved();
    if (!entity) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const href = (id: string): string =>
      this.router.serializeUrl(
        this.router.createUrlTree(['/library', id], { queryParams: this.libraryQuery() }),
      );
    const rows: ChoiceRow[] = [];
    const add = (choice: Choice, level?: number): void => {
      const offer = optionsForChoice(choice, index, {
        ownerId: entity.id,
        localizer,
        href,
        sheet: needsSheet(choice) ? this.heroSheet() : undefined,
        limit: POPOVER_OPTION_LIMIT,
      });
      if (offer.count === 0) return;
      rows.push({
        id: choice.id,
        prompt: localizer.choicePrompt(choice.id).text || choice.prompt,
        level,
        count: offer.count,
        options: offer.options,
      });
    };
    for (const choice of entity.choices) add(choice);
    if (entity.type === 'class') {
      for (const row of entity.levels) for (const choice of row.choices) add(choice, row.level);
    }
    return rows;
  });

  private readonly sections = computed<readonly Section[]>(() => {
    const entity = this.resolved();
    if (!entity) return [];
    const localizer = this.engineFacade.localizer();
    const index = this.engineFacade.index();
    const own = localizer.text(entity.id, 'description').text;
    const sections: Section[] = own ? [{ text: own }] : [];
    for (const featureId of grantedFeatureIds(entity)) {
      if (!index.get(featureId)) continue;
      const text = localizer.text(featureId, 'description').text;
      if (text) sections.push({ name: localizer.name(featureId), text });
    }
    return sections;
  });

  protected readonly body = resource({
    params: () => this.sections(),
    loader: async ({ params }) =>
      Promise.all(
        params.map(async (section) => ({
          name: section.name,
          html: await this.markdownService.render(section.text, this.engineFacade.localizer()),
        })),
      ),
  });

  private readonly bodyContainer = viewChild<ElementRef<HTMLElement>>('bodyContainer');

  constructor() {
    // One delegated listener for the cross-link anchors in the rendered markup (no `href`, only
    // `data-entity-id`), as the library detail page does; re-attached when the container is rebuilt.
    effect((onCleanup) => {
      const container = this.bodyContainer();
      if (!container) return;
      onCleanup(
        this.renderer.listen(container.nativeElement, 'click', (event: MouseEvent) => {
          const anchor = (event.target as Element | null)?.closest('a[data-entity-id]');
          const id = anchor?.getAttribute('data-entity-id');
          if (!id) return;
          event.preventDefault();
          const query = this.libraryQuery();
          void (query.for
            ? this.router.navigate(['/library', id], { queryParams: query })
            : this.router.navigate(['/library', id]));
        }),
      );
    });
  }
}
