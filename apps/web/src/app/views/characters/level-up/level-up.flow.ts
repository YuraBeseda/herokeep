import { computed, DestroyRef, effect, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { combineLatest, switchMap } from 'rxjs';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import type { FlowController } from '../../../ui/flow/flow-controller';
import type { StepItem } from '../../../ui/stepper/stepper.component';
import type { LevelUpStep } from '../flow/steps';
import { LevelUpState } from './level-up.state';

const GENERIC_CHOICE_LABEL_KEY = 'characters.levelUp.steps.choice';
const CLASS_STEP_ID = 'class';

export interface LevelUpFlowChromeOptions {
  readonly flow: FlowController<LevelUpStep>;
  /** The answer of each already-decided choice as short text, keyed by choice id. */
  readonly summaries: Signal<ReadonlyMap<string, string>>;
  /** Already-translated name of the class being leveled (`undefined` until it is known). */
  readonly className: Signal<string | undefined>;
  readonly committing: Signal<boolean>;
  /** Runs the review's "Finish level up". */
  readonly finish: () => void;
}

/**
 * Everything the level-up shows around its steps: the stepper's items and the action strap
 * (Cancel · Back | Next, which reads "Finish level up" on the review). A plain class built in the
 * component's injection context so its effects and cleanup belong to the component; it never
 * navigates (the `FlowController` does) and holds no draft state of its own.
 *
 * The sheet shell's own strap, tab bar and top bar stay as they are: the shell dims its tabs while
 * this screen is open and drops its strap, which comes back when the level-up closes.
 */
export class LevelUpFlowChrome {
  private readonly state = inject(LevelUpState);
  private readonly engineFacade = inject(EngineFacade);
  private readonly transloco = inject(TranslocoService);
  private readonly strap = inject(ActionStrapService);
  /** The sheet's id (`/c/:id`): the strap stays valid under `/c/:id/level-up` and clears outside it. */
  private readonly sheetId = inject(ActivatedRoute).parent?.snapshot.paramMap.get('id') ?? '';

  /** Emits once the `characters` and `shell` bundles for the active language are loaded, so the
   * labels computed below (which read `translate` synchronously) re-run after the load. */
  private readonly translationsReady = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap(() =>
        combineLatest([
          this.transloco.selectTranslate('levelUp.steps.hp', {}, 'characters'),
          this.transloco.selectTranslate('ui.stepper.label', {}, 'shell'),
        ]),
      ),
    ),
    { initialValue: null },
  );

  constructor(private readonly options: LevelUpFlowChromeOptions) {
    // Set from an effect, not eagerly: a predecessor screen's destroy-time clear can run after this
    // constructor, and would wipe a strap set eagerly.
    effect(() => this.setStrap());
    inject(DestroyRef).onDestroy(() => this.strap.clear());
  }

  /** What the step is called: a generic choice step takes its choice's own label from the pack. */
  label(step: LevelUpStep): string {
    this.translationsReady();
    if (step.kind === 'choice' && step.labelKey === GENERIC_CHOICE_LABEL_KEY && step.choiceId) {
      const prompt = this.engineFacade.localizer().choicePrompt(step.choiceId).text;
      if (prompt) return prompt;
    }
    return this.tr(step.labelKey);
  }

  // The steps as the stepper shows them. The which-class step comes first: while the class is
  // undecided it is the current one, followed by locked rows for what the class decides; once picked
  // it stays as a locked, answered row (the class cannot change after the first answer — Cancel
  // starts over). Then the current step is 'current'; a choice with an unacceptable decision is a
  // reachable, `invalid` to-do; hit points are done once rolled or averaged; a choice is done once
  // decided; the spells step once explicitly continued past.
  readonly stepItems = computed<StepItem[]>(() => {
    this.translationsReady();
    const current = this.options.flow.currentId();
    const className = this.options.className();
    const steps = this.state.allSteps();
    const open = new Set(this.state.steps().flatMap((s) => (s.choiceId ? [s.choiceId] : [])));
    const invalid = this.state.invalidDecisions();
    const hpDone = this.state.hpRoll() !== undefined;
    const spellsDone = this.state.doneSteps().has('spells');
    const summaries = this.options.summaries();
    const classLabel = this.tr('characters.levelUp.steps.class');

    if (!this.state.advancement()) {
      const afterClass = this.tr('characters.levelUp.stepper.afterClass');
      const locked = (id: string, key: string): StepItem => ({
        id,
        label: this.tr(key),
        state: 'locked',
        hint: afterClass,
      });
      return [
        {
          id: CLASS_STEP_ID,
          label: classLabel,
          state: current === CLASS_STEP_ID ? 'current' : 'todo',
        },
        locked('hp', 'characters.levelUp.steps.hp'),
        locked('class-choices', 'characters.levelUp.steps.classChoices'),
        locked('review', 'characters.levelUp.steps.review'),
      ];
    }

    const items: StepItem[] = [
      {
        id: CLASS_STEP_ID,
        label: classLabel,
        state: 'locked',
        ...(className ? { summary: className } : {}),
        hint: this.state.multiclassFiltered()
          ? this.tr('characters.levelUp.stepper.multiclassOff', {
              campaign: this.state.campaignName,
            })
          : this.tr('characters.levelUp.stepper.classChosen'),
      },
    ];
    for (const step of steps) {
      const label = this.label(step);
      if (step.id === current) {
        items.push({ id: step.id, label, state: 'current' });
        continue;
      }
      if (step.kind === 'choice' && step.choiceId !== undefined && invalid.has(step.choiceId)) {
        items.push({
          id: step.id,
          label,
          state: 'todo',
          invalid: true,
          hint: this.tr('characters.levelUp.stepper.needsAttention'),
        });
        continue;
      }
      const done =
        (step.kind === 'hp' && hpDone) ||
        (step.kind === 'choice' && step.choiceId !== undefined && !open.has(step.choiceId)) ||
        (step.kind === 'spells' && spellsDone);
      const summary = step.choiceId ? summaries.get(step.choiceId) : undefined;
      items.push({
        id: step.id,
        label,
        state: done ? 'done' : 'todo',
        ...(done && summary ? { summary } : {}),
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

  /** Cancel · Back | Next (Finish level up on the review) — the slot never changes, only its label. */
  private setStrap(): void {
    const { flow, finish, committing } = this.options;
    const step = flow.current();
    const onReview = step?.kind === 'review';
    const blocked = onReview ? !this.state.complete() || committing() : !flow.canNext();
    const reason = onReview
      ? 'shell.strap.reason-incomplete'
      : step?.kind === 'class'
        ? 'shell.strap.reason-class'
        : step?.kind === 'hp'
          ? 'shell.strap.reason-hp'
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
          label: onReview ? 'shell.strap.finish-level-up' : 'shell.strap.next',
          icon: 'done',
          kind: 'primary',
          disabled: blocked,
          ...(blocked && !committing() ? { disabledReason: reason } : {}),
          run: () => (onReview ? finish() : this.advance()),
        },
      ],
      status: this.statusText(),
      scope: ['/c', this.sheetId, 'level-up'],
    });
  }

  /** Next: the spells step has no answer of its own, so leaving it is what marks it done. */
  private advance(): void {
    if (this.options.flow.current()?.kind === 'spells') this.state.markStepDone('spells');
    this.options.flow.next();
  }

  /** A translation read synchronously; re-evaluated when the bundles load or the language changes. */
  tr(key: string, params?: Record<string, unknown>): string {
    this.translationsReady();
    return this.transloco.translate(key, params);
  }
}
