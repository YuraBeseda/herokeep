import { Component, computed, inject, signal } from '@angular/core';
import { ShortTextSchema, type GrammaticalGender } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '@shared/icons/icon.component';
import { HkTextFieldComponent } from '../../../../ui/text-field/text-field.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { CreateWizardState } from '../create-wizard.state';

/** The grammatical forms a name can take (scope-relative label keys). */
export const GENDER_OPTIONS: readonly { value: GrammaticalGender; labelKey: string }[] = [
  { value: 'masculine', labelKey: 'wizard.name.genderMasculine' },
  { value: 'feminine', labelKey: 'wizard.name.genderFeminine' },
  { value: 'neuter', labelKey: 'wizard.name.genderNeuter' },
];

/**
 * The wizard's first step: the hero's name, the grammatical form (a brass segmented control over
 * real radios) and, when content packs are installed, one pin per pack with the always-on core
 * pack shown first and locked. Reads and writes the draft on `CreateWizardState` directly.
 */
@Component({
  selector: 'hk-name-step',
  imports: [TranslocoDirective, HkTextFieldComponent, HkTooltipDirective, IconComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './name-step.component.html',
  styleUrl: './name-step.component.scss',
})
export class NameStepComponent {
  protected readonly state = inject(CreateWizardState);
  protected readonly genderOptions = GENDER_OPTIONS;
  /** The error shows once the field has been left, not while the first character is typed. */
  protected readonly touched = signal(false);
  protected readonly nameValid = computed(
    () => ShortTextSchema.safeParse(this.state.name().trim()).success,
  );
  // Reused straight off the protocol's own schema (task-5-brief.md) rather than a copied literal.
  protected readonly nameMaxLength = ShortTextSchema.maxLength ?? null;
}
