import { Component, computed, inject, input, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import type {
  ChoiceCommitFn,
  ChoiceValidateFn,
} from '../../create-wizard/steps/choice-step-overrides';
import { ChoiceStepComponent } from '../../create-wizard/steps/choice-step.component';
import { sheetNames } from '../play/play-names';
import { BuildLockComponent } from './build-lock.component';
import { choiceRows, type ChoiceRow } from './build-view';

/**
 * Board B01, "Choices made": every decision the character has recorded, with its picks, the level
 * it was made at, and either Re-pick or a lock chip saying why not. Re-pick opens the SAME generic
 * `hk-choice-step` the wizard and the outstanding list use, seeded with the current picks; each
 * pick commits one replacing `decision.made` through the Build tab's own commit (so validation is
 * the engine's `validateSelection` and nothing else decides what may change).
 */
@Component({
  selector: 'app-build-choices-section',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkTagChipComponent,
    HkButtonComponent,
    BuildLockComponent,
    ChoiceStepComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-choices-section.component.html',
  styleUrls: ['./build-section.scss', './build-choices-section.component.scss'],
})
export class BuildChoicesSectionComponent {
  private readonly store = inject(CharacterStore);
  private readonly facade = inject(EngineFacade);
  private readonly names = sheetNames(this.facade);

  // Inputs
  /** The campaign edit lock: Re-pick is blocked, with the lock's reason as its hint. */
  readonly disabled = input(false);
  readonly disabledReason = input<string | null>(null);
  readonly validate = input.required<ChoiceValidateFn>();
  readonly commit = input.required<ChoiceCommitFn>();

  protected readonly sheet = this.store.sheet;
  protected readonly editing = signal<string | null>(null);

  protected readonly rows = computed<ChoiceRow[]>(() => {
    const facts = this.store.facts();
    const sheet = this.store.sheet();
    if (!facts || !sheet) return [];
    return choiceRows({
      facts,
      sheet,
      index: this.facade.index(),
      localizer: this.facade.localizer(),
      names: this.names,
    });
  });

  protected promptOf(row: ChoiceRow): string {
    return row.prompt;
  }

  protected toggle(row: ChoiceRow): void {
    this.editing.update((current) => (current === row.choiceId ? null : row.choiceId));
  }
}
