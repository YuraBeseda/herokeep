import { Location } from '@angular/common';
import { computed, DestroyRef, effect, inject, untracked, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { combineLatest, switchMap } from 'rxjs';
import {
  ActionStrapService,
  type StrapAction,
} from '../../../ui/action-strap/action-strap.service';
import type { FlowController } from '../../../ui/flow/flow-controller';
import { TopBarService } from '../../../ui/shell/top-bar.service';
import { phoneLayout } from '../../../ui/shell/viewport';
import type { StepItem } from '../../../ui/stepper/stepper.component';
import { KNOWN_STEP_ORDER, type KnownStepId, type WizardStep } from '../flow/steps';
import { CreateWizardState } from './create-wizard.state';
import { PickerToolsService } from './picker-tools.service';

/** The route this screen lives under: its strap and top bar clear when navigation leaves it. */
export const SCREEN_SCOPE = ['/characters', 'new'] as const;

/** The stepper row that stands in for the class's own choice steps until a class is chosen. */
const CLASS_CHOICES_ID = 'class-choices';
const GENERIC_CHOICE_LABEL_KEY = 'characters.wizard.steps.choice';

export interface WizardFlowChromeOptions {
  readonly flow: FlowController<WizardStep>;
  /** The answer of each already-decided choice as short text, keyed by choice id. */
  readonly summaries: Signal<ReadonlyMap<string, string>>;
  readonly complete: Signal<boolean>;
  readonly creating: Signal<boolean>;
  /** Runs the review's "Create hero". */
  readonly create: () => void;
}

/**
 * Everything the creation wizard shows around its steps: the stepper's items, the action strap
 * (Cancel · Back | Next, Filter · Search on pickers), the top bar and the `?step=` URL mirror.
 * A plain class built in the component's injection context so its effects and cleanup belong to the
 * component; it never navigates (the `FlowController` does) and holds no draft state of its own.
 */
export class WizardFlowChrome {
  private readonly state = inject(CreateWizardState);
  private readonly engineFacade = inject(EngineFacade);
  private readonly transloco = inject(TranslocoService);
  private readonly strap = inject(ActionStrapService);
  private readonly topBar = inject(TopBarService);
  private readonly location = inject(Location);
  private readonly tools = inject(PickerToolsService);
  private readonly phone = phoneLayout();

  /** Emits once the `characters` and `shell` bundles for the active language are loaded, so the
   * labels computed below (which read `translate` synchronously) re-run after the load. */
  private readonly translationsReady = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap(() =>
        combineLatest([
          this.transloco.selectTranslate('wizard.steps.name', {}, 'characters'),
          this.transloco.selectTranslate('ui.stepper.label', {}, 'shell'),
        ]),
      ),
    ),
    { initialValue: null },
  );

  constructor(private readonly options: WizardFlowChromeOptions) {
    // Set from an effect, not eagerly: a predecessor screen's destroy-time clear can run after this
    // constructor, and would wipe a strap set eagerly.
    effect(() => this.setStrap());
    effect(() =>
      this.topBar.set({ title: this.tr('characters.wizard.title'), scope: SCREEN_SCOPE }),
    );
    effect(() => {
      const id = this.options.flow.currentId();
      if (id) untracked(() => this.writeStepToUrl(id));
    });
    inject(DestroyRef).onDestroy(() => {
      this.strap.clear();
      this.topBar.clear();
    });
  }

  /**
   * What the step is called: a generic choice step takes its choice's own label from the pack
   * ("Fighting Style", "Weapon Masteries"), every other step its fixed name.
   */
  label(step: WizardStep): string {
    this.translationsReady();
    if (step.kind === 'choice' && step.labelKey === GENERIC_CHOICE_LABEL_KEY && step.choiceId) {
      const prompt = this.engineFacade.localizer().choicePrompt(step.choiceId).text;
      if (prompt) return prompt;
    }
    return this.tr(step.labelKey);
  }

  // The steps as the stepper shows them. The current one is 'current' (highest priority — even an
  // invalid decision's step is just 'current' while you are fixing it); a choice step whose decision
  // is invalid is a reachable, `invalid` to-do; otherwise 'done' once the draft actually records it:
  // the name once non-empty, a choice step once its choiceId has a recorded (valid) decision, the
  // free-form 'spells' step once `state.spellsAutoDone()` (>=1 cantrip learned) OR the user
  // explicitly continued past it (`state.doneSteps()`), and 'equipment' likewise but marked-only
  // (task-8-brief.md: no auto-done rule for it); otherwise 'todo'. Until the class is chosen one
  // locked "Class choices" row holds the place of the class's own steps, so the strip's "Step N of
  // M" does not jump by the whole class's worth of steps at once (how many there are is the class's
  // data, so the total can still change once it is known).
  readonly stepItems = computed<StepItem[]>(() => {
    const current = this.options.flow.currentId();
    const decisions = this.state.decisions();
    const invalidDecisions = this.state.invalidDecisions();
    const name = this.state.name().trim();
    const spellsDone = this.state.spellsAutoDone() || this.state.doneSteps().has('spells');
    const equipmentDone = this.state.doneSteps().has('equipment');
    const summaries = this.options.summaries();
    const steps = this.state.allSteps();
    const items = steps.map((step): StepItem => {
      const label = this.label(step);
      if (step.id === current) return { id: step.id, label, state: 'current' };
      if (
        step.kind === 'choice' &&
        step.choiceId !== undefined &&
        invalidDecisions.has(step.choiceId)
      ) {
        return {
          id: step.id,
          label,
          state: 'todo',
          invalid: true,
          hint: this.tr('characters.wizard.stepper.needsAttention'),
        };
      }
      const done =
        (step.kind === 'name' && name.length > 0) ||
        (step.kind === 'choice' && step.choiceId !== undefined && decisions.has(step.choiceId)) ||
        (step.kind === 'spells' && spellsDone) ||
        (step.kind === 'equipment' && equipmentDone);
      const summary =
        step.kind === 'name' ? name : step.choiceId ? summaries.get(step.choiceId) : undefined;
      return {
        id: step.id,
        label,
        state: done ? 'done' : 'todo',
        ...(done && summary ? { summary } : {}),
      };
    });
    const placeholderAt = this.classChoicesPlaceholderIndex(steps);
    if (placeholderAt >= 0) {
      items.splice(placeholderAt, 0, {
        id: CLASS_CHOICES_ID,
        label: this.tr('characters.wizard.steps.classChoices'),
        state: 'locked',
        hint: this.tr('characters.wizard.stepper.afterClass'),
      });
    }
    return items;
  });

  /** "Step N of M · name", the strap's status note. */
  readonly statusText = computed(() => {
    const items = this.stepItems();
    const index = items.findIndex((item) => item.id === this.options.flow.currentId());
    if (index < 0) return '';
    return this.tr('shell.ui.stepper.position', {
      current: index + 1,
      total: items.length,
      name: items[index].label,
    });
  });

  /** Where the "Class choices" placeholder goes: before the first step that is not the name or one of
   * the fixed creation choices, and only while the class is still undecided. -1: no placeholder. */
  private classChoicesPlaceholderIndex(steps: readonly WizardStep[]): number {
    const classStep = steps.find((step) => step.id === 'class');
    if (!classStep?.choiceId || this.state.decisions().has(classStep.choiceId)) return -1;
    return steps.findIndex(
      (step) =>
        step.kind !== 'name' &&
        !(step.kind === 'choice' && KNOWN_STEP_ORDER.includes(step.id as KnownStepId)),
    );
  }

  /** Cancel · Back | Next (Create hero on the review) — the slot never changes, only its label. */
  private setStrap(): void {
    const { flow, complete, creating, create } = this.options;
    const step = flow.current();
    const onReview = step?.kind === 'review';
    const blocked = onReview ? !complete() || creating() : !flow.canNext();
    const reason = onReview
      ? 'shell.strap.reason-incomplete'
      : step?.kind === 'name'
        ? 'shell.strap.reason-name'
        : 'shell.strap.reason-step';
    this.strap.set({
      exit: [
        {
          id: 'cancel',
          label: 'shell.strap.cancel',
          icon: 'close',
          kind: 'ghost',
          run: () => void flow.cancel(),
        },
        {
          id: 'back',
          label: 'shell.strap.back',
          icon: 'leave',
          kind: 'parchment',
          disabled: !flow.canBack(),
          run: () => flow.back(),
        },
      ],
      primary: [
        {
          id: 'next',
          label: onReview ? 'shell.strap.create-hero' : 'shell.strap.next',
          icon: 'done',
          kind: 'primary',
          disabled: blocked,
          ...(blocked && !creating() ? { disabledReason: reason } : {}),
          run: () => (onReview ? create() : this.advance()),
        },
      ],
      ...(this.tools.active() ? { secondary: this.pickerActions() } : {}),
      status: this.statusText(),
      scope: SCREEN_SCOPE,
    });
  }

  /** Next: the free-form steps (spells, equipment) have no answer of their own, so leaving them is what
   * marks them done in the stepper. */
  private advance(): void {
    const step = this.options.flow.current();
    if (step?.kind === 'spells' || step?.kind === 'equipment') this.state.markStepDone(step.kind);
    this.options.flow.next();
  }

  /** Zone 3 on a picker step: fold the filter chips in or out, and jump to the search field. */
  private pickerActions(): StrapAction[] {
    const chipsShown = this.tools.filterOpen() ?? !this.phone();
    return [
      {
        id: 'filter',
        label: 'shell.icon.filter',
        icon: 'filter',
        kind: 'icon',
        disabled: !this.tools.hasFilters(),
        disabledReason: 'shell.strap.reason-no-filters',
        run: () => this.tools.toggleFilters(chipsShown),
      },
      {
        id: 'search',
        label: 'shell.icon.search',
        icon: 'search',
        kind: 'icon',
        run: () => this.tools.requestSearch(),
      },
    ];
  }

  /** Mirrors the step into `?step=` (replacing the history entry, keeping other params such as
   * `returnUrl`). Not a router navigation: that would clear the strap and close an open drawer. */
  private writeStepToUrl(id: string): void {
    const [path, query = ''] = this.location.path().split('?');
    const params = new URLSearchParams(query);
    params.set('step', id);
    this.location.replaceState(path, params.toString());
  }

  /** A translation read synchronously; re-evaluated when the bundles load or the language changes. */
  tr(key: string, params?: Record<string, unknown>): string {
    this.translationsReady();
    return this.transloco.translate(key, params);
  }
}
