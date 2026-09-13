import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { findChoice, type Diagnostic } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CreateWizardState } from '../create-wizard.state';

interface AbilityInfo {
  readonly id: string;
  readonly name: string;
}

interface ImproveInfo {
  // One entry per target the `improve` grammar needs (e.g. '+2/+1' -> [2, 1]): the ORDER is the
  // grammar's own order, so slot 0 is always the choice's biggest bump.
  readonly deltas: number[];
  // The owner's `abilityScores` allow-list (backgrounds) when it has one; every system ability
  // otherwise (the ASI feat carries no such list — task-7-brief.md).
  readonly allowedAbilities: AbilityInfo[];
}

// Only diagnostic codes `validateAbilitiesPick` (packages/engine/src/derive/validation.ts) can
// actually produce get a specific message; anything else falls back to a generic one (mirrors
// `choice-step.component.ts`'s own `KNOWN_DIAGNOSTIC_CODES` convention).
const KNOWN_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'selection.count',
  'selection.invalidEntry',
  'selection.abilityNotAllowed',
  'selection.duplicateAbility',
  'selection.abilityImproveShape',
  'selection.abilityMax',
]);

function diagnosticKey(code: string): string {
  return KNOWN_DIAGNOSTIC_CODES.has(code) ? `validation.${code}` : 'validation.generic';
}

/**
 * The `abilities` pick (task-7-brief.md): a background's +2/+1 ability bump, or the ASI feat's own
 * +2 (and, per the grammar, a hypothetical +1/+1/+1) — one target ability chosen per `improve`
 * grammar slot, restricted to the OWNER's `abilityScores` allow-list when it has one (backgrounds;
 * `findChoice`'s `owner`), unrestricted otherwise (the ASI feat). Emits `['str:+2', 'con:+1']`
 * (task-7-brief.md's exact format), committed through `CreateWizardState.validate`/`setDecision`
 * on every change, same "always commit" convention as `hk-choice-step`/`hk-ability-scores-step`.
 */
@Component({
  selector: 'hk-abilities-improve-step',
  imports: [TranslocoDirective, ChipComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './abilities-improve-step.component.html',
  styleUrl: './abilities-improve-step.component.scss',
})
export class AbilitiesImproveStepComponent {
  private readonly state = inject(CreateWizardState);
  private readonly engineFacade = inject(EngineFacade);

  // Inputs
  readonly choiceId = input.required<string>();

  protected readonly info = computed<ImproveInfo | undefined>(() => {
    const index = this.engineFacade.index();
    const found = findChoice(index, this.choiceId());
    if (!found || !('abilities' in found.choice.pick)) return undefined;

    const deltas = found.choice.pick.abilities.improve.split('/').map(Number);
    const allAbilities = index.system().abilities;
    // `owner.abilityScores` is read HERE (a plain identifier, directly in this narrowed branch —
    // not inside the `.filter` closure below) because TS's `in`-narrowing of a property access
    // doesn't reliably survive into a nested closure; `allowedIds` carries the already-resolved
    // (non-union) type into it instead.
    const owner = found.owner;
    const allowedIds: readonly string[] | undefined =
      'abilityScores' in owner ? owner.abilityScores : undefined;
    const allowedAbilities = allowedIds
      ? allAbilities.filter((a) => allowedIds.includes(a.id))
      : allAbilities;
    return { deltas, allowedAbilities };
  });

  // Slot index (position in `info().deltas`) -> assigned ability id. A missing key means "not yet
  // assigned".
  protected readonly assignment = signal<Record<number, string>>({});
  protected readonly diagnostics = signal<Diagnostic[]>([]);

  constructor() {
    // Resets working state whenever `choiceId` changes (same reasoning as
    // `ChoiceStepComponent`'s own reset effect).
    effect(() => {
      this.choiceId();
      this.assignment.set({});
      this.diagnostics.set([]);
    });
  }

  // Methods

  protected abilityName(key: string): string {
    const entity = this.engineFacade
      .index()
      .byType('ability')
      .find((e) => e.type === 'ability' && e.abbreviation === key);
    return entity ? this.engineFacade.localizer().name(entity.id) : key.toUpperCase();
  }

  protected diagnosticKey(code: string): string {
    return diagnosticKey(code);
  }

  protected optionsForSlot(slot: number): AbilityInfo[] {
    const info = this.info();
    if (!info) return [];
    const assignment = this.assignment();
    const usedElsewhere = new Set(
      Object.entries(assignment)
        .filter(([s]) => Number(s) !== slot)
        .map(([, v]) => v),
    );
    return info.allowedAbilities.filter((a) => !usedElsewhere.has(a.id));
  }

  protected isAssigned(slot: number, abilityId: string): boolean {
    return this.assignment()[slot] === abilityId;
  }

  protected onSelectSlot(slot: number, abilityId: string): void {
    this.assignment.update((prev) => {
      const next = { ...prev };
      if (next[slot] === abilityId) delete next[slot];
      else next[slot] = abilityId;
      return next;
    });
    this.commit();
  }

  private commit(): void {
    const info = this.info();
    if (!info) return;
    const assignment = this.assignment();
    const selection: string[] = [];
    info.deltas.forEach((delta, slot) => {
      const abilityId = assignment[slot];
      if (abilityId) selection.push(`${abilityId}:+${delta}`);
    });
    this.diagnostics.set(this.state.validate(this.choiceId(), selection));
    this.state.setDecision(this.choiceId(), selection);
  }
}
