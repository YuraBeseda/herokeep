import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
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
import { askOnce } from '../../../ui/nav/ask-once';
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
import {
  choiceReviewRows,
  newFeatureNames,
  selectionText,
  sheetChanges,
  spellReviewRows,
  type ReviewRow,
} from './level-up.summary';

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
  /** A class the character may not start yet: listed, with its reason, but not choosable. */
  readonly gated: boolean;
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
    NgTemplateOutlet,
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
    leave: () => {
      // Cancel has already asked (when something was chosen): the route guard must not ask again.
      this.exitApproved = true;
      this.navHistory.back(this.cancelFallback);
    },
  });

  protected readonly currentStep = this.flow.current;

  /** Set once the player has confirmed leaving (Cancel) or the level up is committed, so the route's
   * `canDeactivate` lets the navigation through without asking. */
  private exitApproved = false;

  /**
   * The route's `canDeactivate` (`app.routes.ts`): any way out of the level-up other than Cancel or
   * Finish — a tab link, the rail, browser Back — asks first while something has been chosen, with
   * the same dialog Cancel uses. A clean level-up leaves without asking.
   */
  private readonly askLeave = askOnce(() =>
    this.dialog.open(CancelLevelUpDialogComponent).closed.then((leave) => leave === true),
  );

  canLeave(): boolean | Promise<boolean> {
    if (this.exitApproved || !this.state.dirty()) return true;
    return this.askLeave();
  }

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
    const card = (classId: string, toLevel: number, isNewClass: boolean, gated: boolean) => {
      const entity = index.get(classId);
      const level = this.chrome.tr('characters.levelUp.classPicker.toLevel', { level: toLevel });
      return {
        classId,
        name: this.className(classId),
        description: descriptionExcerpt(localizer.text(classId, 'description').text),
        meta: [level, ...(entity ? pickerMeta(entity) : [])],
        isNewClass,
        gated,
      };
    };
    return [
      ...this.state.classChoices().map((o) => card(o.classId, o.toLevel, o.isNewClass, false)),
      // Classes the engine says the character does not qualify for stay listed, gated, after the
      // ones it may start.
      ...this.state.gatedClassIds().map((classId) => card(classId, 1, true, true)),
    ];
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

  protected readonly newFeatureNames = computed(() =>
    newFeatureNames(
      this.state.advancement(),
      this.engineFacade.index(),
      this.engineFacade.localizer(),
    ),
  );

  protected readonly choiceRows = computed<ReviewRow[]>(() =>
    choiceReviewRows(
      this.state.allSteps(),
      this.decisionTexts(),
      this.engineFacade.localizer(),
      (step) => this.chrome.label(step as LevelUpStep),
    ),
  );

  protected readonly spellRows = computed<ReviewRow[]>(() =>
    spellReviewRows(this.state.extraDrafts(), this.engineFacade.localizer(), {
      learned: this.chrome.tr('characters.levelUp.review.learned'),
      prepared: this.chrome.tr('characters.levelUp.review.prepared'),
    }),
  );

  /** Hit dice, current hit points, spell slots and the proficiency bonus: changed as before to
   * after, unchanged as such (empty until a draft exists). */
  protected readonly sheetChanges = computed(() => {
    const before = this.characterStore.sheet();
    const after = this.state.draftSheet();
    return before && after ? sheetChanges(before, after) : [];
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
      this.exitApproved = true;
      await this.router.navigate(['..', 'play'], { relativeTo: this.route });
    } catch (error) {
      const key = error instanceof CharacterStoreNotLeaderError ? error.code : GENERIC_FAILURE_KEY;
      this.toastService.show(key);
    } finally {
      this.committing.set(false);
    }
  }
}
