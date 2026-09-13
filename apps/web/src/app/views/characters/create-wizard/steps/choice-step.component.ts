import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { findChoice, type Diagnostic, type Sheet } from '@hk/engine';
import { makeEntityId, parseChoiceId, parseEntityId } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { diagnosticKey } from '@shared/helpers/diagnostic-toast';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CreateWizardState } from '../create-wizard.state';
import { AbilitiesImproveStepComponent } from './abilities-improve-step.component';
import { AbilityScoresStepComponent } from './ability-scores-step.component';
import type { ChoiceCommitFn, ChoiceValidateFn } from './choice-step-overrides';
import { EntityPickerComponent } from './entity-picker.component';

interface SkillOption {
  readonly id: string;
  readonly name: string;
}

type ChoiceView =
  | { kind: 'query' | 'static'; ids: string[]; count: number }
  | { kind: 'literal'; count: number }
  | { kind: 'skills'; classId: string; options: SkillOption[]; count: number }
  // 'abilities' (background +2/+1, ASI +2) and 'abilityGeneration' (the system's own ability-score
  // decision) each delegate to their own T7 component (`hk-abilities-improve-step` /
  // `hk-ability-scores-step`) — this generic step's job for them is only to route, not render.
  | { kind: 'abilities' }
  | { kind: 'abilityGeneration' }
  // 'equipmentOption' is the equipment step's own concern — this generic step renders nothing for
  // it (by design, per task-6-brief.md's resolution note).
  | { kind: 'unsupported' };

// The R5 synthetic class-skills decision id has no backing `Choice` entity at all — it's
// recognized purely by this suffix (see `packages/engine/src/derive/choices.ts`'s
// `skillsChoiceId`).
const SKILLS_SUFFIX = '@1/skills';

// Only diagnostic codes this step's own pick forms (query/static/literal/skills) can actually
// produce (see `validation.ts`) get a specific message; anything else (an `abilities`/
// `abilityGeneration` diagnostic bleeding through the shared `validate()` call, or a future code
// this task didn't anticipate) falls back to a generic one.
const KNOWN_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'selection.count',
  'selection.unresolved',
  'selection.notOffered',
  'selection.duplicate',
  'selection.prerequisiteFailed',
  'selection.subclassLevel',
  'selection.unknownChoice',
]);

/**
 * Generic engine-driven choice step (task-6-brief.md): resolves `choiceId` to its `Choice` (or,
 * for the synthetic `<classId>@1/skills` id, to the owning class's `skillChoice`) and renders the
 * right pick-form widget — `hk-entity-picker` for `query`/`static`, chips for the synthetic
 * skills pick, a freeform chip-entry for `literal` (the engine's `literal` pick carries no option
 * list of its own — see the class doc on `ChoiceView` — so "chip multi-select" here means each
 * entered value becomes its own chip, not a pick among engine-supplied options), and — for
 * `abilities`/`abilityGeneration` — delegates entirely to T7's own `hk-abilities-improve-step` /
 * `hk-ability-scores-step`, which own their pick-form AND their own validate/setDecision/
 * diagnostics loop (this step only renders the shared prompt heading above them).
 *
 * Every change to the working selection THIS step owns routes through `CreateWizardState.validate`
 * (rendered inline as localized diagnostics) and then `setDecision` — unconditionally, even when
 * invalid: this mirrors a live form rather than a gate, so the draft always reflects exactly what's
 * on screen and the diagnostics are the only signal that something still needs fixing.
 */
@Component({
  selector: 'hk-choice-step',
  imports: [
    TranslocoDirective,
    ChipComponent,
    ButtonComponent,
    EntityPickerComponent,
    AbilityScoresStepComponent,
    AbilitiesImproveStepComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './choice-step.component.html',
  styleUrl: './choice-step.component.scss',
})
export class ChoiceStepComponent {
  // Optional (task-11-brief.md): only the creation wizard provides `CreateWizardState`; the build
  // tab renders this component with none in context, always passing the overrides below instead.
  private readonly state = inject(CreateWizardState, { optional: true });
  private readonly engineFacade = inject(EngineFacade);

  // Inputs
  readonly choiceId = input.required<string>();
  // Optional overrides — see `choice-step-overrides.ts`'s class doc. Threaded straight through to
  // the `abilityGeneration`/`abilities` children below (their own template bindings, further
  // down) so a future level-up flow never has to re-plumb this.
  // Not aliased (`@angular-eslint/no-input-rename`) — the property name IS the binding name.
  readonly sheet = input<Sheet | undefined>(undefined);
  readonly validate = input<ChoiceValidateFn | undefined>(undefined);
  readonly commit = input<ChoiceCommitFn | undefined>(undefined);

  // Working (uncommitted-until-`commit`) UI state — always reset when `choiceId` changes (a
  // fresh mount for a different choice never inherits a stale selection/diagnostics/draft; see
  // the constructor effect below).
  protected readonly selection = signal<string[]>([]);
  protected readonly diagnostics = signal<Diagnostic[]>([]);
  protected readonly literalDraft = signal('');

  protected readonly view = computed<ChoiceView>(() => {
    const id = this.choiceId();
    const index = this.engineFacade.index();

    if (id.endsWith(SKILLS_SUFFIX)) {
      const parsed = parseChoiceId(id);
      const classId = parsed
        ? (index.resolveClassRef(parsed.entityId) ?? parsed.entityId)
        : undefined;
      const classEntity = classId ? index.get(classId) : undefined;
      if (!classId || classEntity?.type !== 'class') return { kind: 'unsupported' };

      const packId = parseEntityId(classId)?.packId;
      const localizer = this.engineFacade.localizer();
      const options = classEntity.skillChoice.from.map((slug): SkillOption => {
        const skillEntityId = packId ? makeEntityId(packId, 'skill', slug) : undefined;
        const skillEntity = skillEntityId ? index.get(skillEntityId) : undefined;
        const name = skillEntity ? localizer.name(skillEntityId!) : slug;
        return { id: slug, name };
      });
      return { kind: 'skills', classId, options, count: classEntity.skillChoice.count };
    }

    const found = findChoice(index, id);
    if (!found) return { kind: 'unsupported' };
    const { choice } = found;
    if ('query' in choice.pick) {
      return {
        kind: 'query',
        ids: index.query(choice.pick.query).map((e) => e.id),
        count: choice.count,
      };
    }
    if ('static' in choice.pick) {
      return { kind: 'static', ids: [...choice.pick.static], count: choice.count };
    }
    if ('literal' in choice.pick) {
      return { kind: 'literal', count: choice.count };
    }
    if ('abilities' in choice.pick) {
      return { kind: 'abilities' };
    }
    if ('abilityGeneration' in choice.pick) {
      return { kind: 'abilityGeneration' };
    }
    return { kind: 'unsupported' };
  });

  protected readonly promptText = computed(
    () => this.engineFacade.localizer().choicePrompt(this.choiceId()).text,
  );

  protected readonly skillsClassName = computed(() => {
    const v = this.view();
    return v.kind === 'skills' ? this.engineFacade.localizer().name(v.classId) : '';
  });

  constructor() {
    // Resets the working UI state whenever `choiceId` changes. The wizard shell may reuse this
    // same component instance across consecutive 'choice' steps (its `@switch` case doesn't
    // change), so nothing here may leak from one choice to the next; a freshly-mounted choice
    // step is guaranteed a not-yet-decided choice (see `CreateWizardState.curatedChoiceSteps`'s
    // doc), so starting empty is always correct, never a loss of a real prior selection.
    effect(() => {
      this.choiceId();
      this.selection.set([]);
      this.diagnostics.set([]);
      this.literalDraft.set('');
    });
  }

  // Methods
  protected isSelected(id: string): boolean {
    return this.selection().includes(id);
  }

  protected onToggle(id: string): void {
    const current = this.selection();
    const v = this.view();
    // A count:1 query/static pick (species/background/class in the SRD system's own creation
    // choices) is single-select: tapping a different card REPLACES the current selection rather
    // than appending to it (task-6 fix round — previously every pick form toggled/appended
    // unconditionally, letting a count:1 choice accumulate an unbounded multi-selection that only
    // surfaced as an after-the-fact diagnostic). Tapping the already-selected card still clears
    // it. Scoped to `query`/`static` only — the synthetic skills chips and literal entries keep
    // the general toggle/append behavior even when their own `count` happens to be 1.
    if ((v.kind === 'query' || v.kind === 'static') && v.count === 1) {
      this.applySelection(current.length === 1 && current[0] === id ? [] : [id]);
      return;
    }
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    this.applySelection(next);
  }

  protected onAddLiteral(event: Event): void {
    event.preventDefault();
    const value = this.literalDraft().trim();
    if (!value) return;
    this.literalDraft.set('');
    this.applySelection([...this.selection(), value]);
  }

  protected onRemoveLiteral(value: string): void {
    this.applySelection(this.selection().filter((v) => v !== value));
  }

  protected diagnosticKey(code: string): string {
    return diagnosticKey(code, KNOWN_DIAGNOSTIC_CODES);
  }

  private applySelection(next: string[]): void {
    this.selection.set(next);
    this.diagnostics.set(this.runValidate(this.choiceId(), next));
    this.runCommit(this.choiceId(), next);
  }

  // Runs the `validate`/`commit` override when the consumer supplied one (the build tab, a future
  // level-up flow), falling back to the injected `CreateWizardState` otherwise (the creation
  // wizard, which never sets these inputs) — see `ChoiceValidateFn`/`ChoiceCommitFn`'s class doc.
  // Never actually reached with neither available in practice (every real consumer supplies one or
  // the other), but no-ops/returns `[]` rather than throwing mid-render if it ever were.
  private runValidate(choiceId: string, selection: string[]): Diagnostic[] {
    const override = this.validate();
    if (override) return override(choiceId, selection);
    return this.state?.validate(choiceId, selection) ?? [];
  }

  private runCommit(
    choiceId: string,
    selection: string[],
    context?: Record<string, unknown>,
  ): void {
    const override = this.commit();
    if (override) {
      override(choiceId, selection, context);
      return;
    }
    this.state?.setDecision(choiceId, selection, context);
  }
}
