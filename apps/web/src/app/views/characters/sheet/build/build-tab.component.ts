import { Component, computed, inject } from '@angular/core';
import { validateSelection } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CampaignEditLockBannerComponent } from '@shared/components/campaign-edit-lock-banner/campaign-edit-lock-banner.component';
import { CampaignEditLockService } from '@shared/services/campaigns/campaign-edit-lock';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import type {
  ChoiceCommitFn,
  ChoiceValidateFn,
} from '../../create-wizard/steps/choice-step-overrides';
import { ChoiceStepComponent } from '../../create-wizard/steps/choice-step.component';
import { BuildAbilitiesSectionComponent } from './build-abilities-section.component';
import { BuildChoicesSectionComponent } from './build-choices-section.component';
import { BuildIdentitySectionComponent } from './build-identity-section.component';
import { BuildOptionsSectionComponent } from './build-options-section.component';
import { BuildOriginSectionComponent } from './build-origin-section.component';
import { BuildPacksSectionComponent } from './build-packs-section.component';
import { BuildProficienciesSectionComponent } from './build-proficiencies-section.component';

/**
 * `/c/:id/build` — the sheet's Build tab (board `B01`): the build as the character has it — origin
 * and class, ability scores, choices made (Re-pick or a lock hint), proficiencies and languages,
 * rule options, content packs, and the identity fields behind one Save — plus, above them, the
 * choices still outstanding (the wizard's own `hk-choice-step` against the LIVE character via
 * `validateChoice`/`commitChoice` below). Each section is its own component under this folder; this
 * shell holds what they share: the campaign edit lock and the choice validate/commit pair.
 *
 * `decision.made`, `character.renamed`/`character.gender_set`/`character.appearance_set`,
 * `character.options.set` and the pack pins are each appended through `CharacterStore.appendTx` the
 * moment the user commits them — there is no draft layer here beyond the identity form's own, since
 * `CharacterStore.sheet`/`facts` are already the live read model.
 */
@Component({
  selector: 'app-build-tab',
  imports: [
    TranslocoDirective,
    CampaignEditLockBannerComponent,
    HkLeafComponent,
    ChoiceStepComponent,
    BuildOriginSectionComponent,
    BuildAbilitiesSectionComponent,
    BuildChoicesSectionComponent,
    BuildProficienciesSectionComponent,
    BuildOptionsSectionComponent,
    BuildPacksSectionComponent,
    BuildIdentitySectionComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-tab.component.html',
  styleUrl: './build-tab.component.scss',
})
export class BuildTabComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);

  // --- Campaign edit lock (plan-10 task-14-brief.md, ruling 7) ----------------------------------
  private readonly campaignEditLockService = inject(CampaignEditLockService);
  /** See the Play leaves' `PlayActionsService` for the full design doc (staleness bounds, DM/solo
   * exemptions): every mutating control on this tab gates on `editLocked`. */
  protected readonly editLock = this.campaignEditLockService.editLockFor(
    this.characterStore.events,
  );
  protected readonly editLocked = computed(() => this.editLock().locked);

  protected readonly sheet = this.characterStore.sheet;
  protected readonly outstanding = this.characterStore.outstanding;

  // `hk-choice-step` override trio (task-11-brief.md; see `choice-step-overrides.ts`): drives the
  // SAME generic choice-step UI the wizard uses, but against the live character — `validateSelection`
  // is the engine function `CreateWizardState.validate` itself wraps, called here over
  // `CharacterStore.sheet`/`facts` instead of a draft.
  protected readonly validateChoice: ChoiceValidateFn = (choiceId, selection) => {
    const sheet = this.characterStore.sheet();
    const facts = this.characterStore.facts();
    if (!sheet || !facts) return [];
    return validateSelection(sheet, facts, this.engineFacade.index(), choiceId, selection);
  };

  protected readonly commitChoice: ChoiceCommitFn = (choiceId, selection, context) => {
    void this.characterStore.appendTx([
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId, selection, ...(context ? { context } : {}) },
      },
    ]);
  };
}
