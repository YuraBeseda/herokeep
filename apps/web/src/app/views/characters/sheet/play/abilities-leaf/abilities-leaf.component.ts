import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { DerivedValue } from '@shared/directives/derived-popover.directive';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { IconComponent } from '../../../../../shared/icons/icon.component';
import { HkAbilitySealComponent } from '../../../../../ui/ability-seal/ability-seal.component';
import { HkContextMenuDirective } from '../../../../../ui/context-menu/context-menu.directive';
import type { HkMenuItem } from '../../../../../ui/context-menu/context-menu.types';
import { HkMenuButtonComponent } from '../../../../../ui/context-menu/menu-button.component';
import {
  HkSkillRowComponent,
  type SkillProficiency,
} from '../../../../../ui/skill-row/skill-row.component';
import { HkTagChipComponent } from '../../../../../ui/tag-chip/tag-chip.component';
import { HkTooltipDirective } from '../../../../../ui/tooltip/tooltip.directive';
import { HkWaxSealComponent } from '../../../../../ui/wax-seal/wax-seal.component';
import { signed } from '../../../../../ui/format';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { breakdownText } from '../breakdown-hint';
import { breakdownOpener } from '../open-breakdown';
import { PlayRollsService, type ScopedT } from '../play-rolls.service';
import { sheetNames } from '../play-names';

// `system.skills[].proficiency` ('none' | 'proficient' | 'expertise' | 'half') -> the row's dot
// states; `half` has no dot of its own, so it draws as proficient and says so in its hint.
const DOT: Record<string, SkillProficiency> = {
  none: 'none',
  proficient: 'proficient',
  expertise: 'expertise',
  half: 'proficient',
};

interface SkillRow {
  readonly id: string;
  readonly label: string;
  readonly total: number;
  readonly totalDerived: DerivedValue;
  readonly proficiency: SkillProficiency;
  /** Scope-relative i18n key of the dot's hint. */
  readonly hintKey: string;
}

interface AbilityRow {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly scoreDerived: DerivedValue;
  readonly saveDerived: DerivedValue;
  readonly mod: number;
  readonly save: number;
  readonly saveProficient: boolean;
  readonly skills: readonly SkillRow[];
}

/**
 * The ability seals with score plate and saving throw (spec §4.2), in the system entity's order.
 * `mode="full"` is the desktop folio's and the Hero tab's block: every ability carries its skills
 * (skill -> ability from the pack's skill entities) and one dice menu holding the check and the
 * save, each with a hint saying when to use it. `mode="saves"` is the Combat tab's block: the
 * compact seals, one Save roll each.
 */
@Component({
  selector: 'app-abilities-leaf',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    IconComponent,
    HkAbilitySealComponent,
    HkContextMenuDirective,
    HkLeafComponent,
    HkMenuButtonComponent,
    HkSkillRowComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    HkWaxSealComponent,
  ],
  providers: [provideTranslocoScope('characters'), provideTranslocoScope('shell')],
  templateUrl: './abilities-leaf.component.html',
  styleUrl: './abilities-leaf.component.scss',
})
export class AbilitiesLeafComponent {
  /** `phone` pads the leaf for a 390 px column. */
  readonly mode = input<'full' | 'saves'>('full');
  readonly phone = input(false);
  /** The Hero tab also shows the passive perception and proficiency chips beside the title. */
  readonly showPassive = input(false);
  /** `leather` is the desktop folio's dark panel (the seals are made for leather); `leaf` is the
   * parchment leaf of the phone's tabs. */
  readonly surface = input<'leaf' | 'leather'>('leaf');

  private readonly rolls = inject(PlayRollsService);
  private readonly engine = inject(EngineFacade);
  private readonly names = sheetNames(this.engine);
  protected readonly sheet = inject(CharacterStore).sheet;
  /** Per ability, the skill whose proficiency dot is the block's one tab stop (roving focus). */
  private readonly activeDot = signal<Record<string, string>>({});

  protected readonly rows = computed<AbilityRow[]>(() => {
    const abilities = this.sheet()?.abilities ?? {};
    const skills = Object.entries(this.sheet()?.skills ?? {});
    const order = this.engine
      .index()
      .system()
      .abilities.map((a) => a.id);
    return order
      .filter((id) => id in abilities)
      .map((id) => {
        const block = abilities[id];
        return {
          id,
          label: this.names.abilityName(id),
          score: block.score.value,
          scoreDerived: block.score,
          saveDerived: block.save,
          mod: block.mod,
          save: block.save.value,
          saveProficient: block.saveProficient,
          skills: skills
            .filter(([slug]) => this.names.skillAbility(slug) === id)
            .map(([slug, skill]) => ({
              id: slug,
              label: this.names.skillName(slug),
              total: skill.total.value,
              totalDerived: skill.total,
              proficiency: DOT[skill.proficiency] ?? 'none',
              hintKey:
                skill.proficiency === 'none'
                  ? 'sheet.skills.notProficient'
                  : `sheet.skills.proficiencyLevel.${skill.proficiency}`,
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        };
      });
  });

  protected readonly signed = signed;
  protected readonly openBreakdown = breakdownOpener();

  protected inspect(row: AbilityRow, kind: 'score' | 'save'): void {
    this.openBreakdown(kind === 'score' ? row.scoreDerived : row.saveDerived);
  }

  /** The ability's dice: check and save, each with its value and a hint saying when to use it. */
  protected menuOf(row: AbilityRow, t: ScopedT): () => HkMenuItem[] {
    return () => [
      {
        id: 'check',
        labelKey: 'characters.sheet.roll.menu.check',
        icon: 'ui:roll',
        detail: signed(row.mod),
        hintKey: 'characters.sheet.explain.abilityCheck',
        run: () => this.rolls.rollAbilityCheck(row.label, row.mod, t),
      },
      {
        id: 'save',
        labelKey: row.saveProficient
          ? 'characters.sheet.roll.menu.saveProficient'
          : 'characters.sheet.roll.menu.save',
        icon: row.saveProficient ? 'gi:star' : 'ui:save',
        detail: signed(row.save),
        hintKey: 'characters.sheet.explain.savingThrow',
        run: () => this.rolls.rollAbilitySave(row.label, row.save, t),
      },
    ];
  }

  /** "Dexterity +2, proficiency +2": the skill total's parts, as the sheet derived them. */
  protected breakdownHint(value: DerivedValue, t: ScopedT): string {
    return breakdownText(value, t, this.names);
  }

  protected dotTabindex(row: AbilityRow, skillId: string): number {
    return (this.activeDot()[row.id] ?? row.skills[0]?.id) === skillId ? 0 : -1;
  }

  /** Roving focus over one block's proficiency dots: arrow keys move, Home/End jump. */
  protected moveDot(row: AbilityRow, event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('hk-dot')) return;
    const dots = Array.from(
      target.closest('.abilities__skills')?.querySelectorAll<HTMLElement>('.hk-dot') ?? [],
    );
    const at = dots.indexOf(target);
    const steps: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowRight: at + 1,
      ArrowUp: at - 1,
      ArrowLeft: at - 1,
      Home: 0,
      End: dots.length - 1,
    };
    const next = steps[event.key];
    if (next === undefined || !dots[next] || !row.skills[next]) return;
    event.preventDefault();
    this.activeDot.update((m) => ({ ...m, [row.id]: row.skills[next].id }));
    // Set now as well: focus moves before the next render applies the binding.
    dots[next].tabIndex = 0;
    target.tabIndex = -1;
    dots[next].focus();
  }

  protected rollSkill(skill: SkillRow, t: ScopedT): void {
    this.rolls.rollSkill(skill.label, skill.total, t);
  }

  protected rollSave(row: AbilityRow, t: ScopedT): void {
    this.rolls.rollAbilitySave(row.label, row.save, t);
  }
}
