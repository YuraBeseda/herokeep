import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '@shared/icons/icon.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { DialogService } from '../../../ui/dialog/dialog.service';
import { FlowController } from '../../../ui/flow/flow-controller';
import { HkDescriptionDrawerComponent } from '../../../ui/description-drawer/description-drawer.component';
import { NavHistoryService } from '../../../ui/nav/nav-history.service';
import { phoneLayout } from '../../../ui/shell/viewport';
import { HkPickerCardComponent } from '../../../ui/picker-card/picker-card.component';
import { HkStepperComponent } from '../../../ui/stepper/stepper.component';
import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import { HkWaxSealComponent } from '../../../ui/wax-seal/wax-seal.component';
import type {
  ChoiceCommitFn,
  ChoiceValidateFn,
} from '../create-wizard/steps/choice-step-overrides';
import { ChoiceStepComponent } from '../create-wizard/steps/choice-step.component';
import { descriptionExcerpt, pickerMeta } from '../create-wizard/steps/picker-facts';
import { SpellsStepComponent } from '../create-wizard/steps/spells-step.component';
import { isRequiredLevelUpStep, levelUpComparator, type LevelUpStep } from '../flow/steps';
import { CancelLevelUpDialogComponent } from './cancel-level-up-dialog.component';
import { LevelUpFlowChrome } from './level-up.flow';
import { LevelUpState } from './level-up.state';
import { selectionText } from './level-up.summary';

const GENERIC_FAILURE_KEY = 'characters.levelUp.review.toast.failed';

// A level-up spellbook addition is one or two new spells, not a from-scratch spellbook (the
// creation wizard's own `SPELLBOOK_RECOMMENDED` of 6 — task-13-fix-report.md) — passed to
// `hk-spells-step`'s `recommendedCount` override below.
const LEVEL_UP_SPELLBOOK_RECOMMENDED = 2;

/** One option of the which-class step: the class being leveled, or a class to start. */
interface ClassCard {
  readonly classId: string;
  readonly name: string;
  readonly description: string | null;
  readonly meta: readonly string[];
  readonly isNewClass: boolean;
}

/** A line of the review: what changes, with the step to jump to for changing it. */
interface ReviewRow {
  readonly stepId: string;
  readonly prompt: string;
  readonly text: string;
}

/**
 * `/c/:id/level-up` — the per-level level-up flow (plan-5 task-13-brief.md; plan 17 boards L01–L04)
 * on the shared stepper. Hosts `LevelUpState` as a component provider (a fresh session per visit,
 * mirrors `CreateWizardComponent`'s own `CreateWizardState` provider) and walks its steps — which
 * class (only while a choice is needed, ADR-007), hit points, the level's pack choices, spells for a
 * caster, review — with the same `FlowController` the creation wizard uses. Next, Back, Cancel and
 * the review's Edit links go through it; the controls live in the action strap (Cancel · Back | Next,
 * which reads "Finish level up" on the review) rather than in a footer of this screen.
 *
 * It reuses `hk-choice-step` (with the T11 override trio — see `choice-step-overrides.ts`) and
 * `hk-spells-step` (with task-13's own override trio — see `spells-step.component.ts`) against
 * `LevelUpState` instead of `CreateWizardState`, exactly the way `BuildTabComponent` reuses
 * `hk-choice-step` against the live character (task-11-brief.md). Only the which-class cards, the HP
 * step and the review are implemented directly here — the rest is entirely engine-driven.
 *
 * `levelUpGuard` (`app.routes.ts`) has already refused to activate this route at all while
 * `CharacterStore.advancements()` is empty, redirecting to the sheet with a toast — this component
 * never has to render an empty-state itself.
 */
@Component({
  selector: 'app-level-up',
  imports: [
    TranslocoDirective,
    HkButtonComponent,
    HkStepperComponent,
    HkPickerCardComponent,
    HkDescriptionDrawerComponent,
    HkTooltipDirective,
    HkWaxSealComponent,
    IconComponent,
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
  private readonly engineFacade = inject(EngineFacade);
  private readonly dialog = inject(DialogService);
  private readonly navHistory = inject(NavHistoryService);
  private readonly document = inject(DOCUMENT);

  protected readonly phone = phoneLayout();
  protected readonly committing = signal(false);

  /** Where Cancel returns to when the user has no earlier screen in this session (a deep link). */
  private readonly cancelFallback = [
    '/c',
    this.route.parent?.snapshot.paramMap.get('id') ?? '',
    'play',
  ] as const;

  /** The choice ids that still need an answer (outstanding, or decided but not acceptable yet). */
  private readonly openChoiceIds = computed(
    () => new Set(this.state.steps().flatMap((step) => (step.choiceId ? [step.choiceId] : []))),
  );

  /**
   * Walks the steps for Next / Back / Edit. `allSteps` is the whole flow (answered choices keep
   * their place), `steps` what is still to do. A choice answered while open moves the flow on to the
   * next step still to do; the hit point step stays open when rolled so the player sees the result
   * and confirms it with Next. Cancel asks first only when something has been chosen.
   */
  protected readonly flow = new FlowController<LevelUpStep>({
    all: this.state.allSteps,
    remaining: this.state.steps,
    compare: levelUpComparator((choiceId) => this.state.choiceRank(choiceId)),
    isRequired: isRequiredLevelUpStep,
    canAdvance: (step) => this.isStepFinished(step),
    dirty: this.state.dirty,
    confirmLeave: async () =>
      (await this.dialog.open(CancelLevelUpDialogComponent).closed) === true,
    leave: () => this.navHistory.back(this.cancelFallback),
  });

  protected readonly currentStep = this.flow.current;

  /** Next may leave a step once it is answered: hit points rolled or averaged, a choice with an
   * acceptable decision. The class step is left by picking a class, the others are never blocking. */
  private isStepFinished(step: LevelUpStep): boolean {
    if (step.kind === 'class') return false;
    if (step.kind === 'hp') return this.state.hpRoll() !== undefined;
    if (step.kind === 'choice' && step.choiceId !== undefined) {
      return !this.openChoiceIds().has(step.choiceId);
    }
    return true;
  }

  // --- Names and summaries ------------------------------------------------------------------------

  private className(classId: string): string {
    const index = this.engineFacade.index();
    return index.has(classId) ? this.engineFacade.localizer().name(classId) : classId;
  }

  protected readonly levelClassName = computed(() => {
    const classId = this.state.advancement()?.classId;
    return classId === undefined ? undefined : this.className(classId);
  });

  /** Each decided choice's answer as short text (the stepper's summaries and the review's rows). */
  private readonly decisionTexts = computed(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const texts = new Map<string, string>();
    for (const [choiceId, selection] of this.state.decisions()) {
      const text = selectionText(choiceId, selection, index, localizer);
      if (text) texts.set(choiceId, text);
    }
    return texts;
  });

  /** The stepper's items, the strap and the action wiring (see `LevelUpFlowChrome`). */
  private readonly chrome = new LevelUpFlowChrome({
    flow: this.flow,
    summaries: this.decisionTexts,
    className: this.levelClassName,
    committing: this.committing,
    finish: () => void this.onFinish(),
  });

  protected readonly stepItems = this.chrome.stepItems;

  // --- Which class (L01) -------------------------------------------------------------------------

  protected readonly classCards = computed<ClassCard[]>(() => {
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    return this.state.classChoices().map((option) => {
      const entity = index.get(option.classId);
      const level = this.chrome.tr('characters.levelUp.classPicker.toLevel', {
        level: option.toLevel,
      });
      return {
        classId: option.classId,
        name: this.className(option.classId),
        description: descriptionExcerpt(localizer.text(option.classId, 'description').text),
        meta: [level, ...(entity ? pickerMeta(entity) : [])],
        isNewClass: option.isNewClass,
      };
    });
  });

  protected readonly ownClassCards = computed(() =>
    this.classCards().filter((card) => !card.isNewClass),
  );
  protected readonly newClassCards = computed(() =>
    this.classCards().filter((card) => card.isNewClass),
  );

  protected readonly detailsId = signal<string | undefined>(undefined);
  protected readonly detailsOpen = signal(false);
  protected readonly detailsOpener = signal<HTMLElement | null>(null);

  protected onClassDetails(classId: string): void {
    const opener = this.document.activeElement;
    this.detailsOpener.set(opener instanceof HTMLElement ? opener : null);
    this.detailsId.set(classId);
    this.detailsOpen.set(true);
  }

  protected onChooseClass(classId: string): void {
    this.state.chooseClass(classId);
  }

  // --- Hit points (L02) ---------------------------------------------------------------------------

  protected onRollHp(): void {
    this.state.rollHp();
  }

  protected readonly hpMaxAfter = computed(() => this.state.draftSheet()?.hp.max.value);

  /** The character's level once this level up is taken (the "level 6" of the headings), which is not
   * the class level when a second class is started. */
  protected readonly characterLevel = computed(
    () => this.state.draftSheet()?.level ?? this.state.advancement()?.toLevel,
  );

  // --- Class choices and spells (L03) ------------------------------------------------------------

  // `hk-choice-step`'s override trio, driven against `LevelUpState` (mirrors
  // `BuildTabComponent.validateChoice`/`commitChoice` exactly — see `choice-step-overrides.ts`'s
  // class doc).
  protected readonly validateChoice: ChoiceValidateFn = (choiceId, selection) =>
    this.state.validate(choiceId, selection);

  protected readonly commitChoice: ChoiceCommitFn = (choiceId, selection, context) => {
    this.state.setDecision(choiceId, selection, context);
  };

  // Plan 13 task 9: the current choice step's opening selection (see `LevelUpState.priorSelection`
  // and `ChoiceStepComponent.initialSelection`) — pre-selects a grown choice's recorded picks.
  protected readonly choiceSeed = computed(() => {
    const choiceId = this.currentStep()?.choiceId;
    return choiceId === undefined ? undefined : this.state.priorSelection(choiceId);
  });

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

  // --- Review (L04) -----------------------------------------------------------------------------

  /** The features the class row for the new level grants outright (a grant with a condition is left
   * to the sheet to evaluate), by name. Pack data only; no rule is decided here. */
  protected readonly newFeatureNames = computed<string[]>(() => {
    const advancement = this.state.advancement();
    if (!advancement) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const entity = index.get(advancement.classId);
    if (entity?.type !== 'class') return [];
    const row = entity.levels.find((r) => r.level === advancement.toLevel);
    const names = (row?.grants ?? [])
      .filter((grant) => grant.when === undefined && index.has(grant.feature))
      .map((grant) => localizer.name(grant.feature));
    return [...new Set(names)];
  });

  /** The choices made this session, in step order, each with the step that edits it. */
  protected readonly choiceRows = computed<ReviewRow[]>(() => {
    const localizer = this.engineFacade.localizer();
    const texts = this.decisionTexts();
    return this.state.allSteps().flatMap((step) => {
      const text = step.choiceId ? texts.get(step.choiceId) : undefined;
      if (step.kind !== 'choice' || !step.choiceId || !text) return [];
      return [
        {
          stepId: step.id,
          prompt: localizer.choicePrompt(step.choiceId).text || this.chrome.label(step),
          text,
        },
      ];
    });
  });

  /** The spells learned or prepared this session, by name. */
  protected readonly spellRows = computed<ReviewRow[]>(() => {
    const localizer = this.engineFacade.localizer();
    const names = (type: string): string =>
      this.state
        .extraDrafts()
        .filter((draft) => draft.type === type)
        .map((draft) => localizer.name((draft.payload as { spellId: string }).spellId))
        .join(', ');
    const rows: ReviewRow[] = [];
    const learned = names('spell.learned');
    const prepared = names('spell.prepared');
    if (learned) {
      rows.push({
        stepId: 'spells',
        prompt: this.chrome.tr('characters.levelUp.review.learned'),
        text: learned,
      });
    }
    if (prepared) {
      rows.push({
        stepId: 'spells',
        prompt: this.chrome.tr('characters.levelUp.review.prepared'),
        text: prepared,
      });
    }
    return rows;
  });

  /** Edit on a review row: jump to the step, and Next brings the user back to the review. */
  protected onEdit(stepId: string): void {
    this.flow.go(stepId, { returnTo: 'review' });
  }

  protected hasStep(stepId: string): boolean {
    return this.state.allSteps().some((step) => step.id === stepId);
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
