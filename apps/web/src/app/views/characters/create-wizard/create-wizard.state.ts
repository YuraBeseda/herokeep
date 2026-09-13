import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import {
  derive,
  ENGINE_VERSION,
  outstandingChoices,
  reduce,
  validateSelection,
  type ChoiceRequest,
  type Diagnostic,
  type Sheet,
  type SystemRules,
} from '@hk/engine';
import { parseChoiceId, parseEvent, type Event, type GrammaticalGender } from '@hk/protocol';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { type DraftEvent } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';

export interface WizardStep {
  id: string;
  labelKey: string;
  choiceId?: string;
  kind: 'name' | 'choice' | 'spells' | 'equipment' | 'review';
}

// Fixed, never-persisted stream/actor for the wizard's in-memory draft (task-5-brief.md): a
// throwaway envelope shape purely so `reduce`/`derive`/`validateSelection` (which all need a
// parsed `Event`) have something to run over before `CharacterStore.create` ever mints the real
// stream. `ts` is a fixed constant — it is never read back, replayed against real data, or
// persisted, so it only needs to satisfy `EventEnvelopeSchema`'s format.
const DRAFT_STREAM = 'char:00000000-0000-7000-8000-000000000000';
const DRAFT_ACTOR: Event['actor'] = { userId: 'local', deviceId: 'draft', role: 'owner' };
const DRAFT_TS = '2000-01-01T00:00:00.000Z';

/** Curated ordering (task-5-brief.md): only sorts these known creation-choice slugs to the
 * front, in this order — everything else `outstandingChoices` surfaces (a pack choice this task
 * doesn't special-case, e.g. a class's own level-1 feature choices) still gets a step, just
 * appended after, in the engine's own sorted order. Adding a pack choice therefore needs zero UI
 * changes (rules-are-data) — it simply shows up, uncurated, at the tail of the list. */
type KnownStepId =
  'species' | 'background' | 'background-abilities' | 'class' | 'ability-scores' | 'class-skills';
const KNOWN_STEP_ORDER: readonly KnownStepId[] = [
  'species',
  'background',
  'background-abilities',
  'class',
  'ability-scores',
  'class-skills',
];

function labelKeyFor(id: KnownStepId | 'choice'): string {
  const camel: Record<KnownStepId | 'choice', string> = {
    species: 'species',
    background: 'background',
    'background-abilities': 'backgroundAbilities',
    class: 'class',
    'ability-scores': 'abilityScores',
    'class-skills': 'classSkills',
    choice: 'choice',
  };
  return `characters.wizard.steps.${camel[id]}`;
}

/**
 * Component-provided (NOT root — `CreateWizardComponent` lists it in its own `providers`) state
 * for the character-creation wizard (task-5-brief.md). Everything here is a THROWAWAY, in-memory
 * draft: `name`/`gender`/`decisions`/`decisionContexts`/`extraDrafts` are plain signals the step
 * components (this task's name/gender + review skeleton; T6-9's species/background/class/
 * ability-scores/spells/equipment steps) read and write directly, and `draftSheet`/`outstanding`
 * are `derive`/`outstandingChoices` run over a synthetic, never-persisted envelope sequence built
 * from them — giving every step live engine-driven validation and step derivation for free,
 * without ever touching `CharacterStore` (which only gets involved once `buildTransaction()`'s
 * result is actually committed, at review time).
 */
@Injectable()
export class CreateWizardState {
  private readonly engineFacade = inject(EngineFacade);
  private readonly packStore = inject(PackStore);

  readonly name = signal('');
  readonly gender = signal<GrammaticalGender>('neuter');
  readonly decisions = signal<ReadonlyMap<string, string[]>>(new Map());
  readonly decisionContexts = signal<ReadonlyMap<string, Record<string, unknown>>>(new Map());
  readonly extraDrafts = signal<readonly DraftEvent[]>([]);

  private readonly systemId = computed<string | undefined>(() => {
    if (!this.packStore.ready()) return undefined;
    return this.engineFacade.index().system().id;
  });

  private readonly classChoiceId = computed<string | undefined>(() => {
    const systemId = this.systemId();
    return systemId ? `${systemId}@0/class` : undefined;
  });

  private readonly systemRules = computed<SystemRules | undefined>(() => {
    if (!this.packStore.ready()) return undefined;
    const system = this.engineFacade.index().system();
    return { restRules: system.restRules, hpRules: system.hpRules };
  });

  /** Envelope-less drafts (`character.created`, `decision.made`*, a synthesized `level.gained`,
   * then `extraDrafts`) wrapped in synthetic, parseEvent-valid envelopes — empty until `name` is
   * non-empty and a core pack is loaded (there is nothing to reduce before then: `character.
   * created`'s payload itself requires a non-empty name to parse). Seq is assigned sequentially,
   * 1..n, in exactly the order pushed. */
  private readonly draftEvents = computed<Event[]>(() => {
    const name = this.name().trim();
    const core = this.packStore.corePack();
    if (!name || !core) return [];

    const events: Event[] = [];
    let seq = 1;
    const push = (type: string, v: number, payload: unknown): void => {
      const n = seq++;
      const parsed = parseEvent({
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        stream: DRAFT_STREAM,
        seq: n,
        ts: DRAFT_TS,
        actor: DRAFT_ACTOR,
        type,
        v,
        payload,
      });
      // Never actually invalid in practice (every payload built below is well-formed), but a
      // silently-dropped draft is safer than a thrown exception mid-render if it ever were.
      if (parsed.ok) events.push(parsed.event);
    };

    push('character.created', 1, {
      name,
      system: core.id,
      corePack: { id: core.id, version: core.version },
      engineVersion: ENGINE_VERSION,
      grammaticalGender: this.gender(),
    });

    const decisions = this.decisions();
    const contexts = this.decisionContexts();
    for (const [choiceId, selection] of decisions) {
      const context = contexts.get(choiceId);
      push('decision.made', 1, { choiceId, selection, ...(context ? { context } : {}) });
    }

    // As soon as the class decision lands, draft `level.gained` too (task-5-brief.md) — this is
    // what surfaces the class's own level-1 choices (the synthetic skills choice among them)
    // through `outstandingChoices` without T6-9 ever having to know about it.
    const classSelection = this.classDecisionSelection(decisions);
    if (classSelection !== undefined)
      push('level.gained', 1, { classId: classSelection, level: 1 });

    for (const draft of this.extraDrafts()) push(draft.type, draft.v, draft.payload);

    return events;
  });

  private classDecisionSelection(decisions: ReadonlyMap<string, string[]>): string | undefined {
    const classChoiceId = this.classChoiceId();
    return classChoiceId ? decisions.get(classChoiceId)?.[0] : undefined;
  }

  private readonly draftFacts = computed(() => {
    const events = this.draftEvents();
    if (events.length === 0) return undefined;
    return reduce(events, undefined, this.systemRules());
  });

  /** `undefined` until `name` is set (see `draftEvents`'s doc). */
  readonly draftSheet: Signal<Sheet | undefined> = computed(() => {
    const facts = this.draftFacts();
    if (!facts || !this.packStore.ready()) return undefined;
    return derive(facts, this.engineFacade.index(), this.systemRules());
  });

  readonly outstanding: Signal<ChoiceRequest[]> = computed(() => {
    const facts = this.draftFacts();
    if (!facts || !this.packStore.ready()) return [];
    return outstandingChoices(facts, this.engineFacade.index());
  });

  /** Decided choices whose CURRENT selection fails `validate` with at least one error (a
   * decision.made is committed unconditionally — see `setDecision` — so an over-budget point-buy,
   * an incomplete standard array, or an out-of-range manual entry all land here rather than being
   * silently accepted). `outstandingChoices` only tracks PRESENCE of a decision, never its
   * validity (`facts.decisions[id] === undefined`), so a choice never appears in both `outstanding`
   * and here at once — this is the other half of "has this choice actually been resolved". Only
   * error-severity diagnostics count; a decision with warnings only is not "invalid" for gating
   * purposes. */
  readonly invalidDecisions: Signal<ReadonlyMap<string, Diagnostic[]>> = computed(() => {
    const result = new Map<string, Diagnostic[]>();
    for (const [choiceId, selection] of this.decisions()) {
      const errors = this.validate(choiceId, selection).filter((d) => d.severity === 'error');
      if (errors.length > 0) result.set(choiceId, errors);
    }
    return result;
  });

  /** ORDER: 'name' → one step per outstanding-or-invalidly-decided creation choice in a stable
   * curated order (species, background, background-abilities, class, ability-scores,
   * class-skills, then remaining sorted) → 'spells' (only when `draftSheet` has a spellcasting
   * block) → 'equipment' → 'review'. The whole middle section (every step but 'name'/'review')
   * only appears once `draftSheet` is defined — before a name is set there is nothing to decide,
   * equip, or review yet.
   *
   * A choice's step disappears once it has a VALID decision, but stays (see `curatedChoiceSteps`)
   * as long as it is either outstanding or decided-but-invalid — `CreateWizardComponent` renders
   * the latter as a clickable 'blocked' stepper step, so the user can revisit and fix it. */
  readonly steps: Signal<WizardStep[]> = computed(() => {
    const steps: WizardStep[] = [
      { id: 'name', labelKey: 'characters.wizard.steps.name', kind: 'name' },
    ];
    const sheet = this.draftSheet();
    if (sheet) {
      steps.push(...this.curatedChoiceSteps());
      if (sheet.spellcasting.length > 0) {
        steps.push({ id: 'spells', labelKey: 'characters.wizard.steps.spells', kind: 'spells' });
      }
      steps.push({
        id: 'equipment',
        labelKey: 'characters.wizard.steps.equipment',
        kind: 'equipment',
      });
    }
    steps.push({ id: 'review', labelKey: 'characters.wizard.steps.review', kind: 'review' });
    return steps;
  });

  private curatedChoiceSteps(): WizardStep[] {
    // A choiceId is either outstanding (no decision yet) or decided (`outstandingChoices` gates on
    // `facts.decisions[id] === undefined`) — never both — so concatenating these two id lists
    // never double-counts the same choice under two different `byKnownId` buckets.
    const ids = [...this.outstanding().map((r) => r.choiceId), ...this.invalidDecisions().keys()];
    if (ids.length === 0) return [];
    const systemId = this.systemId();

    const knownKind = (choiceId: string): KnownStepId | undefined => {
      const parsed = parseChoiceId(choiceId);
      if (!parsed) return undefined;
      if (parsed.entityId === systemId) {
        if (parsed.slug === 'species') return 'species';
        if (parsed.slug === 'background') return 'background';
        if (parsed.slug === 'class') return 'class';
        if (parsed.slug === 'ability-scores') return 'ability-scores';
        return undefined;
      }
      if (parsed.slug === 'ability-scores') return 'background-abilities';
      if (parsed.slug === 'skills' && parsed.level === 1) return 'class-skills';
      return undefined;
    };

    const byKnownId = new Map<KnownStepId, string>();
    const rest: string[] = [];
    for (const choiceId of ids) {
      const kind = knownKind(choiceId);
      if (kind && !byKnownId.has(kind)) byKnownId.set(kind, choiceId);
      else rest.push(choiceId);
    }

    const steps: WizardStep[] = [];
    for (const knownId of KNOWN_STEP_ORDER) {
      const choiceId = byKnownId.get(knownId);
      if (choiceId)
        steps.push({ id: knownId, labelKey: labelKeyFor(knownId), choiceId, kind: 'choice' });
    }
    for (const choiceId of rest) {
      steps.push({ id: choiceId, labelKey: labelKeyFor('choice'), choiceId, kind: 'choice' });
    }
    return steps;
  }

  setDecision(choiceId: string, selection: string[], context?: Record<string, unknown>): void {
    this.decisions.update((prev) => {
      const next = new Map(prev);
      next.set(choiceId, selection);
      return next;
    });
    if (context) {
      this.decisionContexts.update((prev) => {
        const next = new Map(prev);
        next.set(choiceId, context);
        return next;
      });
    }
  }

  /** `validateSelection` over the CURRENT `draftSheet`/draft facts — `[]` (nothing to validate
   * against yet) before a name has been set. */
  validate(choiceId: string, selection: string[]): Diagnostic[] {
    const sheet = this.draftSheet();
    const facts = this.draftFacts();
    if (!sheet || !facts) return [];
    return validateSelection(sheet, facts, this.engineFacade.index(), choiceId, selection);
  }

  /** `character.created` + `decision.made` (with contexts) per decision + `level.gained
   * {classId, level:1}` (once a class is decided) + `extraDrafts` — in that order. The caller
   * (the review step) commits this by calling `CharacterStore.create(name, gender)` first (which
   * mints the REAL `character.created`) and then `appendTx` on everything from index 1 onward,
   * sharing one txId. */
  buildTransaction(): DraftEvent[] {
    const core = this.packStore.corePack();
    const drafts: DraftEvent[] = [
      {
        type: 'character.created',
        v: 1,
        payload: {
          name: this.name().trim(),
          system: core?.id ?? '',
          corePack: { id: core?.id ?? '', version: core?.version ?? '' },
          engineVersion: ENGINE_VERSION,
          grammaticalGender: this.gender(),
        },
      },
    ];

    const decisions = this.decisions();
    const contexts = this.decisionContexts();
    for (const [choiceId, selection] of decisions) {
      const context = contexts.get(choiceId);
      drafts.push({
        type: 'decision.made',
        v: 1,
        payload: { choiceId, selection, ...(context ? { context } : {}) },
      });
    }

    const classSelection = this.classDecisionSelection(decisions);
    if (classSelection !== undefined) {
      drafts.push({ type: 'level.gained', v: 1, payload: { classId: classSelection, level: 1 } });
    }

    drafts.push(...this.extraDrafts());
    return drafts;
  }
}
