import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { findChoice, type Diagnostic } from '@hk/engine';
import { makeEntityId, parseChoiceId, parseEntityId } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CreateWizardState } from '../create-wizard.state';
import { EntityPickerComponent } from './entity-picker.component';

interface SkillOption {
  readonly id: string;
  readonly name: string;
}

type ChoiceView =
  | { kind: 'query' | 'static'; ids: string[]; count: number }
  | { kind: 'literal'; count: number }
  | { kind: 'skills'; classId: string; options: SkillOption[]; count: number }
  // 'abilities'/'abilityGeneration' picks delegate to T7's components; 'equipmentOption' is the
  // equipment step's own concern — this generic step renders nothing for any of them (by design,
  // per task-6-brief.md's resolution note).
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

function diagnosticKey(code: string): string {
  return KNOWN_DIAGNOSTIC_CODES.has(code) ? `validation.${code}` : 'validation.generic';
}

/**
 * Generic engine-driven choice step (task-6-brief.md): resolves `choiceId` to its `Choice` (or,
 * for the synthetic `<classId>@1/skills` id, to the owning class's `skillChoice`) and renders the
 * right pick-form widget — `hk-entity-picker` for `query`/`static`, chips for the synthetic
 * skills pick, and a freeform chip-entry for `literal` (the engine's `literal` pick carries no
 * option list of its own — see the class doc on `ChoiceView` — so "chip multi-select" here means
 * each entered value becomes its own chip, not a pick among engine-supplied options).
 *
 * Every change to the working selection routes through `CreateWizardState.validate` (rendered
 * inline as localized diagnostics) and then `setDecision` — unconditionally, even when invalid:
 * this mirrors a live form rather than a gate, so the draft always reflects exactly what's on
 * screen and the diagnostics are the only signal that something still needs fixing.
 */
@Component({
  selector: 'hk-choice-step',
  imports: [TranslocoDirective, ChipComponent, ButtonComponent, EntityPickerComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './choice-step.component.html',
  styleUrl: './choice-step.component.scss',
})
export class ChoiceStepComponent {
  private readonly state = inject(CreateWizardState);
  private readonly engineFacade = inject(EngineFacade);

  // Inputs
  readonly choiceId = input.required<string>();

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
    const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
    this.commit(next);
  }

  protected onAddLiteral(event: Event): void {
    event.preventDefault();
    const value = this.literalDraft().trim();
    if (!value) return;
    this.literalDraft.set('');
    this.commit([...this.selection(), value]);
  }

  protected onRemoveLiteral(value: string): void {
    this.commit(this.selection().filter((v) => v !== value));
  }

  protected diagnosticKey(code: string): string {
    return diagnosticKey(code);
  }

  private commit(next: string[]): void {
    this.selection.set(next);
    this.diagnostics.set(this.state.validate(this.choiceId(), next));
    this.state.setDecision(this.choiceId(), next);
  }
}
