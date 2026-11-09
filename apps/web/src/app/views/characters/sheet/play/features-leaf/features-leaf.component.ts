import { Component, computed, inject, input, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import {
  featureOrigins,
  groupFeaturesBySource,
  type FeatureGroup,
  type FeatureOrigin,
} from '@shared/services/engine/feature-groups';
import { HkDescriptionDrawerComponent } from '../../../../../ui/description-drawer/description-drawer.component';
import { HkFeatureRowComponent } from '../../../../../ui/feature-row/feature-row.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { sheetNames } from '../play-names';

interface LeafView {
  readonly id: string;
  readonly source: string;
  readonly name: string;
  readonly icon: string;
  readonly resource: string | null;
  readonly hasEntity: boolean;
  readonly origin: FeatureOrigin | null;
  /** Localized name of the entity the feature comes from (null without provenance). */
  readonly sourceName: string | null;
}

type LeafGroup = FeatureGroup<LeafView> & { readonly headingName: string | null };

/**
 * Features (spec §4.2): `hk-feature-row` per feature the character can act with — the sheet's
 * `actions` (the features whose `action.define` effect is active), each with its source glyph,
 * the linked resource as a chip, and a Details button that opens the pack's description in the
 * shared description drawer. The rows are grouped by source
 * (class, subclass, species, background, feats, chosen options, then any without provenance), read
 * from the pack's own grant structure; class and subclass rows carry the level gained as a badge.
 */
@Component({
  selector: 'app-features-leaf',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkFeatureRowComponent,
    HkDescriptionDrawerComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './features-leaf.component.html',
  styleUrl: './features-leaf.component.scss',
})
export class FeaturesLeafComponent {
  readonly phone = input(false);

  private readonly engineFacade = inject(EngineFacade);
  private readonly names = sheetNames(this.engineFacade);
  private readonly sheet = inject(CharacterStore).sheet;

  private readonly facts = inject(CharacterStore).facts;

  /** The localized name of the resource an action spends (its id is a bare slug, not an entity). */
  private resourceName(resourceId: string): string {
    const view = this.sheet()?.resources.find((resource) => resource.id === resourceId);
    return view ? this.names.resourceLabel(view) : this.names.resolve(resourceId);
  }

  protected readonly groups = computed<readonly LeafGroup[]>(() => {
    const facts = this.facts();
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const origins = facts ? featureOrigins(facts, index) : new Map<string, FeatureOrigin>();
    const views: LeafView[] = (this.sheet()?.actions ?? []).map((action) => {
      const origin = origins.get(action.source) ?? null;
      return {
        id: action.id,
        source: action.source,
        name: this.names.actionLabel(action),
        icon: this.names.iconOf(action.source, 'ui:features'),
        resource: action.resource ? this.resourceName(action.resource) : null,
        hasEntity: index.has(action.source),
        origin,
        sourceName: origin ? localizer.name(origin.entityId) : null,
      };
    });
    return groupFeaturesBySource(views).map((group) => ({
      ...group,
      headingName: group.entityId ? localizer.name(group.entityId) : null,
    }));
  });

  protected readonly detailsId = signal<string | undefined>(undefined);
  protected readonly detailsOpen = signal(false);
  protected readonly detailsOpener = signal<HTMLElement | null>(null);

  protected openDetails(sourceId: string): void {
    const active = document.activeElement;
    this.detailsOpener.set(active instanceof HTMLElement ? active : null);
    this.detailsId.set(sourceId);
    this.detailsOpen.set(true);
  }
}
