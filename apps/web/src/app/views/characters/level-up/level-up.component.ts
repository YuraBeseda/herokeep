import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StepperComponent, type HkStepperStep } from '@shared/components/stepper/stepper.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import type {
  ChoiceCommitFn,
  ChoiceValidateFn,
} from '../create-wizard/steps/choice-step-overrides';
import { ChoiceStepComponent } from '../create-wizard/steps/choice-step.component';
import { SpellsStepComponent } from '../create-wizard/steps/spells-step.component';
import { LevelUpState, type LevelUpStep } from './level-up.state';

const GENERIC_FAILURE_KEY = 'characters.levelUp.review.toast.failed';

// A level-up spellbook addition is one or two new spells, not a from-scratch spellbook (the
// creation wizard's own `SPELLBOOK_RECOMMENDED` of 6 — task-13-fix-report.md) — passed to
// `hk-spells-step`'s `recommendedCount` override below.
const LEVEL_UP_SPELLBOOK_RECOMMENDED = 2;

/**
 * `/c/:id/level-up` — the per-level level-up wizard (plan-5 task-13-brief.md). Hosts `LevelUpState`
 * as a component provider (a fresh session per visit, mirrors `CreateWizardComponent`'s own
 * `CreateWizardState` provider), wires its engine-derived `steps()` into `hk-stepper`, and reuses
 * `hk-choice-step` (with the T11 override trio — see `choice-step-overrides.ts`) and `hk-spells-step`
 * (with task-13's own override trio + `spellcasting`/`finish` — see `spells-step.component.ts`)
 * against `LevelUpState` instead of `CreateWizardState`, exactly the way `BuildTabComponent` reuses
 * `hk-choice-step` against the live character (task-11-brief.md). Only the HP step and the review/
 * commit step are implemented directly here — the rest is entirely engine-driven.
 *
 * `levelUpGuard` (`app.routes.ts`) has already refused to activate this route at all while
 * `CharacterStore.advancements()` is empty, redirecting to the sheet with a toast — this component
 * never has to render an empty-state itself.
 */
@Component({
  selector: 'app-level-up',
  imports: [
    TranslocoDirective,
    StepperComponent,
    ButtonComponent,
    ChoiceStepComponent,
    SpellsStepComponent,
  ],
  providers: [LevelUpState, provideTranslocoScope('characters')],
  templateUrl: './level-up.component.html',
  styleUrl: './level-up.component.scss',
})
export class LevelUpComponent {
  protected readonly state = inject(LevelUpState);
  private readonly characterStore = inject(CharacterStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);

  // The wizard's own navigation cursor — `hk-stepper` never derives this itself (mirrors
  // `CreateWizardComponent`'s own doc). Defaults to 'hp': `state.steps()` always starts with it
  // (`Advancement.hpChoice` is always true in 1b's XP-mode scope).
  protected readonly activeStepId = signal('hp');
  protected readonly committing = signal(false);

  protected readonly currentStep = computed<LevelUpStep | undefined>(() =>
    this.state.steps().find((s) => s.id === this.activeStepId()),
  );

  private readonly currentIndex = computed(() =>
    this.state.steps().findIndex((s) => s.id === this.activeStepId()),
  );

  protected readonly canGoBack = computed(() => this.currentIndex() > 0);

  protected readonly canGoNext = computed(() => {
    const idx = this.currentIndex();
    const steps = this.state.steps();
    if (idx < 0 || idx >= steps.length - 1) return false; // unknown position, or already last
    const step = steps[idx];
    return step?.kind !== 'hp' || this.state.hpRoll() !== undefined;
  });

  // Mirrors `CreateWizardComponent.stepperSteps`'s own doc: 'current' for the active step;
  // 'blocked' for a choice step whose recorded decision is currently invalid (clickable, so the
  // user can revisit and fix it); 'done' once the step's own condition is met (hp rolled/averaged,
  // a choice step's id no longer outstanding, spells explicitly continued past); 'todo' otherwise.
  protected readonly stepperSteps = computed<HkStepperStep[]>(() => {
    const active = this.activeStepId();
    const invalidDecisions = this.state.invalidDecisions();
    const outstandingIds = new Set(this.state.outstanding().map((r) => r.choiceId));
    const hpDone = this.state.hpRoll() !== undefined;
    const spellsDone = this.state.doneSteps().has('spells');
    return this.state.steps().map((step): HkStepperStep => {
      if (step.id === active) return { id: step.id, labelKey: step.labelKey, state: 'current' };
      if (
        step.kind === 'choice' &&
        step.choiceId !== undefined &&
        invalidDecisions.has(step.choiceId)
      ) {
        return { id: step.id, labelKey: step.labelKey, state: 'blocked' };
      }
      const done =
        (step.kind === 'hp' && hpDone) ||
        (step.kind === 'choice' &&
          step.choiceId !== undefined &&
          !outstandingIds.has(step.choiceId)) ||
        (step.kind === 'spells' && spellsDone);
      return { id: step.id, labelKey: step.labelKey, state: done ? 'done' : 'todo' };
    });
  });

  // `hk-choice-step`'s override trio, driven against `LevelUpState` (mirrors
  // `BuildTabComponent.validateChoice`/`commitChoice` exactly — see `choice-step-overrides.ts`'s
  // class doc).
  protected readonly validateChoice: ChoiceValidateFn = (choiceId, selection) =>
    this.state.validate(choiceId, selection);

  protected readonly commitChoice: ChoiceCommitFn = (choiceId, selection, context) => {
    this.state.setDecision(choiceId, selection, context);
  };

  // `hk-spells-step`'s override set (task-13-brief.md — see `spells-step.component.ts`'s class doc).
  protected readonly spellcastingBlock = computed(() => {
    const classId = this.state.advancement()?.classId;
    return this.state.draftSheet()?.spellcasting.find((b) => b.classId === classId);
  });

  protected readonly levelUpSpellbookRecommended = LEVEL_UP_SPELLBOOK_RECOMMENDED;

  protected readonly learnSpell = (spellId: string, classId: string): void => {
    this.state.addSpellLearned(spellId, classId);
  };

  protected readonly unlearnSpell = (spellId: string, classId: string): void => {
    this.state.removeSpellLearned(spellId, classId);
  };

  protected readonly prepareSpell = (spellId: string, classId: string): void => {
    this.state.addSpellPrepared(spellId, classId);
  };

  protected readonly unprepareSpell = (spellId: string, classId: string): void => {
    this.state.removeSpellPrepared(spellId, classId);
  };

  protected readonly finishSpells = (): void => {
    this.state.markStepDone('spells');
  };

  // Re-homes `activeStepId` whenever it stops appearing in `state.steps()` (a choice step
  // vanishing the moment its decision resolves) — verbatim port of `CreateWizardComponent`'s own
  // `reHomeActiveStep` effect; see its doc for the full reasoning.
  private previousSteps: LevelUpStep[] = [];
  private readonly reHomeActiveStep = effect(() => {
    const steps = this.state.steps();
    const activeId = untracked(() => this.activeStepId());
    if (!steps.some((s) => s.id === activeId)) {
      const formerIndex = this.previousSteps.findIndex((s) => s.id === activeId);
      const targetIndex =
        formerIndex === -1 ? steps.length - 1 : Math.min(formerIndex, steps.length - 1);
      const target = steps[targetIndex] ?? steps.at(-1);
      if (target) this.activeStepId.set(target.id);
    }
    this.previousSteps = steps;
  });

  protected onStepSelected(id: string): void {
    this.activeStepId.set(id);
  }

  protected back(): void {
    const idx = this.currentIndex();
    const steps = this.state.steps();
    if (idx > 0) this.activeStepId.set(steps[idx - 1].id);
  }

  protected next(): void {
    const idx = this.currentIndex();
    const steps = this.state.steps();
    if (idx >= 0 && idx < steps.length - 1) this.activeStepId.set(steps[idx + 1].id);
  }

  protected onRollHp(): void {
    this.state.rollHp();
  }

  protected async onFinish(): Promise<void> {
    if (!this.state.complete() || this.committing()) return;
    this.committing.set(true);
    try {
      await this.characterStore.appendTx(this.state.buildTransaction());
      await this.router.navigate(['..', 'play'], { relativeTo: this.route });
    } catch (error) {
      const key = error instanceof CharacterStoreNotLeaderError ? error.code : GENERIC_FAILURE_KEY;
      this.toastService.show(key);
    } finally {
      this.committing.set(false);
    }
  }
}
