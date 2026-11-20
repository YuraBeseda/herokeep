import { Component, computed, inject, Injector, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { parseEntityId } from '@hk/protocol';
import { classColumnKeys, hasProse } from '@shared/services/engine/class-columns';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import {
  featureOrigins,
  groupFeaturesBySource,
  type FeatureGroup,
  type FeatureOrigin,
} from '@shared/services/engine/feature-groups';
import { PeekService } from '../../../../../ui/description-drawer/peek.service';
import { HkFeatureRowComponent } from '../../../../../ui/feature-row/feature-row.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { summaryOf } from '../../../../library/detail/class-entry/summary-text';
import { HkTooltipDirective } from '../../../../../ui/tooltip/tooltip.directive';
import { sheetNames } from '../play-names';

interface LeafView {
  readonly id: string;
  readonly source: string;
  readonly name: string;
  readonly icon: string;
  readonly resource: string | null;
  readonly hasEntity: boolean;
  /** First sentence of the pack description; empty when the feature has no prose. */
  readonly summary: string;
  readonly origin: FeatureOrigin | null;
  /** Localized name of the entity the feature comes from (null without provenance). */
  readonly sourceName: string | null;
}

type LeafGroup = FeatureGroup<LeafView> & { readonly headingName: string | null };

/**
 * Features (spec §4.2): every feature the character holds, grouped by source (class — one group
 * per class, in class order —, subclass, species, background, feats, chosen options, then any
 * without provenance), read from the pack's own grant structure. A feature with an `action.define`
 * effect keeps its action row (source glyph, the linked resource as a chip); any other feature is
 * listed with its name and a one-sentence summary. Class and subclass rows carry the level gained as
 * a badge; a Details button opens the pack's description in the shared description drawer. A grant
 * that is class-table data with no prose of its own (a column) is not a feature to read and is left
 * out, as in the library's class entry.
 */
@Component({
  selector: 'app-features-leaf',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkFeatureRowComponent,
    HkTooltipDirective,
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
    const actions = this.sheet()?.actions ?? [];
    const sourceNameOf = (origin: FeatureOrigin | null): string | null =>
      origin ? localizer.name(origin.entityId) : null;
    const summaryOfFeature = (id: string): string => {
      const text = localizer.text(id, 'description').text;
      return hasProse(text) ? summaryOf(text) : '';
    };
    const classColumns = new Map<string, ReadonlySet<string>>();
    const columnsOf = (classId: string): ReadonlySet<string> => {
      let keys = classColumns.get(classId);
      if (!keys) {
        const entity = index.get(classId);
        keys = entity?.type === 'class' ? classColumnKeys(entity, index) : new Set<string>();
        classColumns.set(classId, keys);
      }
      return keys;
    };

    const views: LeafView[] = [];
    const emittedActions = new Set<string>();
    const actionView = (
      action: (typeof actions)[number],
      origin: FeatureOrigin | null,
    ): LeafView => ({
      id: action.id,
      source: action.source,
      name: this.names.actionLabel(action),
      icon: this.names.iconOf(action.source, 'ui:features'),
      resource: action.resource ? this.resourceName(action.resource) : null,
      hasEntity: index.has(action.source),
      summary: summaryOfFeature(action.source),
      origin,
      sourceName: sourceNameOf(origin),
    });

    // Every granted feature, in grant order (class rows by level): an action feature keeps its
    // action row(s); any other is listed with its name and summary unless it is class-table data.
    for (const [id, origin] of origins) {
      const type = index.get(id)?.type;
      if (type !== 'feature' && type !== 'feat') continue;
      const own = actions.filter((action) => action.source === id);
      if (own.length > 0) {
        for (const action of own) {
          views.push(actionView(action, origin));
          emittedActions.add(action.id);
        }
        continue;
      }
      const summary = summaryOfFeature(id);
      const slug = parseEntityId(id)?.slug ?? '';
      if (origin.kind === 'class' && columnsOf(origin.entityId).has(slug) && summary === '') {
        continue;
      }
      views.push({
        id: `feature:${id}`,
        source: id,
        name: localizer.name(id),
        icon: this.names.iconOf(id, 'ui:features'),
        resource: null,
        hasEntity: true,
        summary,
        origin,
        sourceName: sourceNameOf(origin),
      });
    }
    // An action whose source is not a granted feature (a root entity, an unknown id) is never dropped.
    for (const action of actions) {
      if (emittedActions.has(action.id)) continue;
      views.push(actionView(action, origins.get(action.source) ?? null));
    }
    return groupFeaturesBySource(views).map((group) => ({
      ...group,
      headingName: group.entityId ? localizer.name(group.entityId) : null,
    }));
  });

  private readonly peek = inject(PeekService);
  private readonly injector = inject(Injector);

  protected openDetails(sourceId: string): void {
    const active = document.activeElement;
    this.peek.open(sourceId, active instanceof HTMLElement ? active : undefined, {
      injector: this.injector,
    });
  }
}
