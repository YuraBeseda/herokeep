import { Component, computed, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import { sheetNames } from '../play/play-names';
import { proficiencyGroups, type ProficiencyGroup } from './build-view';

/**
 * Board B01, "Proficiencies and languages": armor, weapons, tools, saving throws, skills and
 * languages as chip rows. Names come from the pack through the localizer; a weapon or armor
 * category the pack does not declare as an entity (`martial`, `heavy`) shows its slug.
 */
@Component({
  selector: 'app-build-proficiencies-section',
  imports: [TranslocoDirective, HkLeafComponent, HkTagChipComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-proficiencies-section.component.html',
  styleUrls: ['./build-section.scss', './build-proficiencies-section.component.scss'],
})
export class BuildProficienciesSectionComponent {
  private readonly store = inject(CharacterStore);
  private readonly facade = inject(EngineFacade);
  private readonly names = sheetNames(this.facade);

  protected readonly groups = computed<ProficiencyGroup[]>(() => {
    const facts = this.store.facts();
    const sheet = this.store.sheet();
    if (!facts || !sheet) return [];
    return proficiencyGroups({
      facts,
      sheet,
      index: this.facade.index(),
      localizer: this.facade.localizer(),
      names: this.names,
    });
  });
}
