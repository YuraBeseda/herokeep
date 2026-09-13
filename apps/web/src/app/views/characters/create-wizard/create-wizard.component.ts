import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ShortTextSchema, type GrammaticalGender } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StepperComponent, type HkStepperStep } from '@shared/components/stepper/stepper.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import { CreateWizardState, type WizardStep } from './create-wizard.state';
import { ChoiceStepComponent } from './steps/choice-step.component';

// Relative to the 'characters' scope (this component's own template reads `t()` scoped via
// `*transloco="let t; read: 'characters'"` — unlike `WizardStep.labelKey`, which is read by
// `hk-stepper`'s own UNSCOPED template and therefore needs the full `characters.` prefix).
const GENDER_OPTIONS: { value: GrammaticalGender; labelKey: string }[] = [
  { value: 'masculine', labelKey: 'wizard.name.genderMasculine' },
  { value: 'feminine', labelKey: 'wizard.name.genderFeminine' },
  { value: 'neuter', labelKey: 'wizard.name.genderNeuter' },
];

/**
 * `/characters/new` — the creation wizard's shell (plan-5 task-5-brief.md). Hosts
 * `CreateWizardState` as a COMPONENT provider (a fresh draft per visit, never shared/root), wires
 * its engine-derived `steps()` into `hk-stepper`, and implements the 'name' step and the 'review'
 * step's skeleton itself — T6-9 plug in 'choice'/'spells'/'equipment' step bodies (rendered as a
 * placeholder here in the meantime; the step derivation and navigation shell around them is this
 * task's whole job).
 */
@Component({
  selector: 'app-create-wizard',
  imports: [TranslocoDirective, StepperComponent, ButtonComponent, ChoiceStepComponent],
  providers: [CreateWizardState, provideTranslocoScope('characters')],
  templateUrl: './create-wizard.component.html',
  styleUrl: './create-wizard.component.scss',
})
export class CreateWizardComponent {
  protected readonly state = inject(CreateWizardState);
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly router = inject(Router);

  protected readonly genderOptions = GENDER_OPTIONS;

  // The wizard's own navigation cursor — `hk-stepper` never derives this itself (see its
  // SKILL.md's "Do / Don't"). Defaults to 'name': `state.steps()` always starts with it.
  protected readonly activeStepId = signal('name');
  protected readonly nameTouched = signal(false);
  protected readonly creating = signal(false);

  protected readonly nameValid = computed(
    () => ShortTextSchema.safeParse(this.state.name().trim()).success,
  );
  // Reused straight off the protocol's own schema (task-5-brief.md) rather than a copied literal.
  protected readonly nameMaxLength = ShortTextSchema.maxLength ?? undefined;

  protected readonly currentStep = computed<WizardStep | undefined>(() =>
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
    return steps[idx]?.kind !== 'name' || this.nameValid();
  });

  // A step is 'done' once the draft actually records it: the name once non-empty, a choice step
  // once its choiceId has a recorded decision. Every other step is 'todo' until it becomes
  // current — this task never emits 'blocked' (nothing here gates a step on another one yet).
  protected readonly stepperSteps = computed<HkStepperStep[]>(() => {
    const active = this.activeStepId();
    const decisions = this.state.decisions();
    const nameDone = this.state.name().trim().length > 0;
    return this.state.steps().map((step) => ({
      id: step.id,
      labelKey: step.labelKey,
      state:
        step.id === active
          ? 'current'
          : (step.kind === 'name' && nameDone) ||
              (step.kind === 'choice' &&
                step.choiceId !== undefined &&
                decisions.has(step.choiceId))
            ? 'done'
            : 'todo',
    }));
  });

  protected readonly complete = computed(
    () => this.state.outstanding().length === 0 && this.state.name().trim().length > 0,
  );

  protected readonly genderLabelKey = computed(() => {
    const option = this.genderOptions.find((o) => o.value === this.state.gender());
    return option?.labelKey ?? this.genderOptions[0].labelKey;
  });

  // Steps are removed the moment their decision is recorded (`CreateWizardState.steps` is
  // re-derived from `outstandingChoices`, not appended-to — see its class doc). A future
  // species/background/etc. step component (T6-9) can legitimately call `setDecision` on the
  // CURRENTLY ACTIVE step without navigating away first, which would otherwise strand
  // `activeStepId` on a vanished id: `currentIndex` becomes -1, and `canGoBack`/`canGoNext` both
  // read false, dead-ending the footer (only a stepper-nav click on a 'done' step could recover).
  // This effect re-homes `activeStepId` whenever it stops appearing in `state.steps()`: it lands
  // on whatever now sits at the vanished step's OWN former ordinal position (i.e. the next
  // undecided step that took its place), clamped to the new (shorter) list, falling back to the
  // last step ('review') if that former position can't be recovered. `steps()` is the only
  // tracked dependency (recomputes only when the derived list itself changes, not on every
  // deliberate `activeStepId` navigation); prior state is read via `untracked` so this effect
  // never re-triggers itself off its own write.
  private previousSteps: WizardStep[] = [];
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

  // Ability line + chosen entity names for the review skeleton (task-5-brief.md: "renders the
  // draft summary skeleton"). Full presentation (icons, grouping, spell/equipment lists) is
  // T6-9's job once those steps exist; this is deliberately minimal.
  protected readonly abilityLine = computed(() => {
    const sheet = this.state.draftSheet();
    if (!sheet) return '';
    return Object.entries(sheet.abilities)
      .map(([id, block]) => `${id.toUpperCase()} ${block.score.value}`)
      .join(' · ');
  });

  // Best-effort: not every recorded selection is a full entity id (ability-score deltas like
  // "str:+2", raw skill slugs) — `index.has(id)` filters those out before asking the localizer.
  protected readonly chosenEntityNames = computed(() => {
    const sheet = this.state.draftSheet();
    if (!sheet) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const ids = [...this.state.decisions().values()].flat().filter((id) => index.has(id));
    return ids.map((id) => localizer.name(id)).filter((name) => name.length > 0);
  });

  protected onNameInput(value: string): void {
    this.state.name.set(value);
  }

  protected onNameBlur(): void {
    this.nameTouched.set(true);
  }

  protected onGenderChange(value: GrammaticalGender): void {
    this.state.gender.set(value);
  }

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

  protected async onCreate(): Promise<void> {
    if (!this.complete() || this.creating()) return;
    this.creating.set(true);
    try {
      const id = await this.characterStore.create(this.state.name().trim(), this.state.gender());
      const [, ...rest] = this.state.buildTransaction();
      if (rest.length > 0) await this.characterStore.appendTx(rest);
      await this.router.navigate(['/c', id, 'play']);
    } finally {
      this.creating.set(false);
    }
  }
}
