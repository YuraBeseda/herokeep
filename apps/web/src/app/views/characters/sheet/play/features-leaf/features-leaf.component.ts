import { Component, computed, inject, input, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HkDescriptionDrawerComponent } from '../../../../../ui/description-drawer/description-drawer.component';
import { HkFeatureRowComponent } from '../../../../../ui/feature-row/feature-row.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { sheetNames } from '../play-names';

/**
 * Features (spec §4.2): `hk-feature-row` per feature the character can act with — the sheet's
 * `actions` (the features whose `action.define` effect is active), each with its source glyph,
 * the linked resource as a chip, and a Details button that opens the pack's description in the
 * shared description drawer. B13 groups the rows by source (species / class / subclass /
 * background) once the engine exposes the granting source per feature; until then the list is flat.
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

  protected readonly features = computed(() =>
    (this.sheet()?.actions ?? []).map((action) => ({
      id: action.id,
      source: action.source,
      name: this.names.actionLabel(action),
      icon: this.names.iconOf(action.source, 'ui:features'),
      resource: action.resource ? this.names.resolve(action.resource) : null,
      hasEntity: this.engineFacade.index().has(action.source),
    })),
  );

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
