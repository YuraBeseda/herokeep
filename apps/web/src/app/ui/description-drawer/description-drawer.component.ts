import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  Renderer2,
  resource,
  viewChild,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Entity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { PackStore } from '@shared/stores/pack.store';
import { EntityFactsComponent } from '../../views/library/detail/entity-facts.component';
import { HkDrawerComponent } from '../drawer/drawer.component';
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

  // Inputs
  /** A pack entity id, e.g. `srd-5e-2024:spell/fireball`. */
  readonly entity = input.required<string>();
  readonly open = model(false);
  /** The control that opened the drawer (focus returns to it). */
  readonly opener = input<Opener>(null);

  protected readonly ready = this.packStore.ready;
  protected readonly resolved = computed(() => this.engineFacade.index().get(this.entity()));
  protected readonly name = computed(() => this.engineFacade.localizer().name(this.entity()));

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
          void this.router.navigate(['/library', id]);
        }),
      );
    });
  }
}
