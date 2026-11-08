import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { signed, uniqueId } from '../format';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

export type SkillProficiency = 'none' | 'proficient' | 'expertise';

/**
 * `hk-skill-row` — one skill: a proficiency dot, the name, an optional disadvantage mark, the
 * signed modifier in Forum and a small roll button (design-system SkillRow).
 *
 * Every mark explains itself through its hint and accessible name, never through a legend or an
 * inline reason: the dot's `proficiencyHint` ("Proficient (+3)"), the disadvantage mark's cause
 * ("Disadvantage: chain mail"). The roll button reads "Roll <name>". All hint inputs are
 * already-translated text; the row only displays what it is given and emits `roll`.
 */
@Component({
  selector: 'hk-skill-row',
  imports: [TranslocoDirective, IconComponent, HkIconButtonComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './skill-row.component.html',
  styleUrl: './skill-row.component.scss',
  host: {
    '[class.hk-sk--comfortable]': 'density() === "comfortable"',
    '[class.hk-sk--leather]': 'surface() === "leather"',
  },
})
export class HkSkillRowComponent {
  // Inputs
  readonly name = input.required<string>();
  readonly modifier = input.required<number>();
  readonly proficiency = input<SkillProficiency>('none');
  /** Translated hint of the proficiency dot, such as "Expertise (+6)". */
  readonly proficiencyHint = input.required<string>();
  /** Translated cause of a disadvantage ("Disadvantage: chain mail"); `null` for none. */
  readonly disadvantage = input<string | null>(null);
  readonly density = input<'compact' | 'comfortable'>('compact');
  /** `leather` on the dark folio, `leaf` on parchment. */
  readonly surface = input<'leaf' | 'leather'>('leaf');

  // Outputs
  readonly roll = output<void>();

  protected readonly modifierText = computed(() => signed(this.modifier()));
  protected readonly nameId = uniqueId('hk-sk-name');
  protected readonly rollId = uniqueId('hk-sk-roll');
  protected readonly rollLabelledBy = `${this.rollId} ${this.nameId}`;
}
