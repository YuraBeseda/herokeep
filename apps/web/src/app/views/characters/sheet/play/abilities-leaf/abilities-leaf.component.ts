import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { IconComponent } from '../../../../../shared/icons/icon.component';
import { HkAbilitySealComponent } from '../../../../../ui/ability-seal/ability-seal.component';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { PlayRollsService, type ScopedT } from '../play-rolls.service';
import { sheetNames } from '../play-names';

const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * The six ability seals with score plate and saving throw (spec §4.2). `mode="full"` is the
 * desktop folio's and the Hero tab's block: every seal has a Check and a Save roll button.
 * `mode="saves"` is the Combat tab's block: the compact seals, one Save roll each.
 */
@Component({
  selector: 'app-abilities-leaf',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    IconComponent,
    HkAbilitySealComponent,
    HkButtonComponent,
    HkLeafComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './abilities-leaf.component.html',
  styleUrl: './abilities-leaf.component.scss',
})
export class AbilitiesLeafComponent {
  /** `phone` pads the leaf for a 390 px column. */
  readonly mode = input<'full' | 'saves'>('full');
  readonly phone = input(false);
  /** `leather` is the desktop folio's dark panel (the seals are made for leather); `leaf` is the
   * parchment leaf of the phone's tabs. */
  readonly surface = input<'leaf' | 'leather'>('leaf');

  private readonly rolls = inject(PlayRollsService);
  private readonly names = sheetNames(inject(EngineFacade));
  private readonly sheet = inject(CharacterStore).sheet;

  protected readonly rows = computed(() => {
    const abilities = this.sheet()?.abilities ?? {};
    return ABILITY_ORDER.filter((id) => id in abilities).map((id) => {
      const block = abilities[id];
      return {
        id,
        label: this.names.abilityName(id),
        score: block.score.value,
        mod: block.mod,
        save: block.save.value,
        saveProficient: block.saveProficient,
      };
    });
  });

  protected rollCheck(row: { label: string; mod: number }, t: ScopedT): void {
    this.rolls.rollAbilityCheck(row.label, row.mod, t);
  }

  protected rollSave(row: { label: string; save: number }, t: ScopedT): void {
    this.rolls.rollAbilitySave(row.label, row.save, t);
  }
}
