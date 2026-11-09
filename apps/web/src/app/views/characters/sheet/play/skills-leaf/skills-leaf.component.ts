import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { DerivedValue } from '@shared/directives/derived-popover.directive';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { IconComponent } from '../../../../../shared/icons/icon.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import {
  HkSkillRowComponent,
  type SkillProficiency,
} from '../../../../../ui/skill-row/skill-row.component';
import { HkTagChipComponent } from '../../../../../ui/tag-chip/tag-chip.component';
import { signed } from '../../../../../ui/format';
import { breakdownOpener } from '../open-breakdown';
import { PlayRollsService, type ScopedT } from '../play-rolls.service';
import { sheetNames } from '../play-names';

interface SkillRow {
  readonly id: string;
  readonly label: string;
  readonly total: number;
  readonly totalDerived: DerivedValue;
  readonly proficiency: SkillProficiency;
  /** Scope-relative i18n key of the dot's hint. */
  readonly hintKey: string;
}

// `system.skills[].proficiency` ('none' | 'proficient' | 'expertise' | 'half') -> the row's dot
// states; `half` has no dot of its own, so it draws as proficient and says so in its hint.
const DOT: Record<string, SkillProficiency> = {
  none: 'none',
  proficient: 'proficient',
  expertise: 'expertise',
  half: 'proficient',
};

/**
 * The skills list (spec §4.2): a proficiency dot with a hint (never a legend), the name, the
 * derived total and a Roll button per row — one column on the phone's Hero tab, two on the folio.
 * It replaces the old grid whose Proficient badges overlapped the Roll buttons (audit defect).
 */
@Component({
  selector: 'app-skills-leaf',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    IconComponent,
    HkLeafComponent,
    HkSkillRowComponent,
    HkTagChipComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './skills-leaf.component.html',
  styleUrl: './skills-leaf.component.scss',
})
export class SkillsLeafComponent {
  /** The Hero tab also shows the passive perception chip beside the title. */
  readonly showPassive = input(false);
  readonly phone = input(false);
  /** `leather` is the desktop folio's dark panel; `leaf` the parchment leaf of the Hero tab. */
  readonly surface = input<'leaf' | 'leather'>('leaf');

  private readonly rolls = inject(PlayRollsService);
  private readonly names = sheetNames(inject(EngineFacade));
  protected readonly sheet = inject(CharacterStore).sheet;
  protected readonly signed = signed;

  protected readonly rows = computed<SkillRow[]>(() =>
    Object.entries(this.sheet()?.skills ?? {})
      .map(([id, block]) => ({
        id,
        label: this.names.skillName(id),
        total: block.total.value,
        totalDerived: block.total,
        proficiency: DOT[block.proficiency] ?? 'none',
        hintKey:
          block.proficiency === 'none'
            ? 'sheet.skills.notProficient'
            : `sheet.skills.proficiencyLevel.${block.proficiency}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  protected readonly openBreakdown = breakdownOpener();

  protected roll(row: SkillRow, t: ScopedT): void {
    this.rolls.rollSkill(row.label, row.total, t);
  }
}
