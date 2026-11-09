import { Component, computed, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import { sheetNames } from '../play/play-names';
import { abilityTable, type AbilityTable } from './build-view';

/** Generation method -> its label key (the wizard's own, static so the key check sees them). */
const METHOD_KEYS: Readonly<Record<string, string>> = {
  standardArray: 'wizard.abilityScores.method.standardArray',
  pointBuy: 'wizard.abilityScores.method.pointBuy',
  manual: 'wizard.abilityScores.method.manual',
  roll: 'wizard.abilityScores.method.roll',
};

/**
 * Board B01, "Ability scores": a table of base, bonus tags (each naming where it came from in its
 * hint), final score and modifier, with the creation method as a chip. The final scores keep their
 * `hkDerived` provenance on the Play tab's ability seals; this table shows the same numbers split.
 */
@Component({
  selector: 'app-build-abilities-section',
  imports: [TranslocoDirective, HkLeafComponent, HkTagChipComponent, IconComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-abilities-section.component.html',
  styleUrls: ['./build-section.scss', './build-abilities-section.component.scss'],
})
export class BuildAbilitiesSectionComponent {
  private readonly store = inject(CharacterStore);
  private readonly facade = inject(EngineFacade);
  private readonly names = sheetNames(this.facade);

  protected readonly table = computed<AbilityTable>(() => {
    const facts = this.store.facts();
    const sheet = this.store.sheet();
    if (!facts || !sheet) return { rows: [] };
    return abilityTable({
      facts,
      sheet,
      index: this.facade.index(),
      localizer: this.facade.localizer(),
      names: this.names,
    });
  });

  protected methodKey(method: string): string {
    return METHOD_KEYS[method] ?? METHOD_KEYS['manual'];
  }

  protected signed(value: number): string {
    return value >= 0 ? `+${value}` : `\u2212${-value}`;
  }
}
