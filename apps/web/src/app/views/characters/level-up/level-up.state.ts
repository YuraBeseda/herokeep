import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import {
  derive,
  ENGINE_VERSION,
  findChoice,
  outstandingChoices,
  parseRollSpec,
  reduce,
  roll,
  validateSelection,
  type Advancement,
  type ChoiceRequest,
  type Diagnostic,
  type RollResult,
  type Sheet,
  type Snapshot,
  type SystemRules,
} from '@hk/engine';
import { parseEvent, type Event } from '@hk/protocol';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { cryptoRng } from '@shared/services/engine/rng';
import { CharacterStore, type DraftEvent } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';

export interface LevelUpStep {
  id: string;
  labelKey: string;
  choiceId?: string;
  kind: 'hp' | 'choice' | 'spells' | 'review';
}

// Same throwaway-envelope technique `CreateWizardState` uses (see its own `DRAFT_*` doc) — a
// fixed, never-replayed actor/ts purely so `reduce`/`outstandingChoices`/`validateSelection` (which
// all need a parsed `Event`) have something to run over. UNLIKE the creation wizard's fully
// synthetic stream, these draft envelopes carry the REAL `CharacterStore.streamId()` and are
// reduced INCREMENTALLY on top of a snapshot of the LIVE character's own already-committed
// `facts` — mirrors `CharacterStore`'s own `applyAppended` technique — so the draft always reflects
// "the live character, plus whatever's been picked in this level-up session so far". Nothing built
// here is ever itself persisted; only `buildTransaction()`'s result is, via the caller's OWN
// `CharacterStore.appendTx` call.
const DRAFT_ACTOR: Event['actor'] = { userId: 'local', deviceId: 'draft', role: 'owner' };
const DRAFT_TS = '2000-01-01T00:00:00.000Z';

/**
 * Component-provided (NOT root — `LevelUpComponent` lists it in its own `providers`, a fresh
 * session per visit) state for the per-level level-up wizard (plan-5 task-13-brief.md). Mirrors
 * `CreateWizardState`'s draft technique (`decisions`/`decisionContexts`/`extraDrafts`, plain
 * signals the step components read/write directly; `draftSheet`/`outstanding` derived via
 * `derive`/`outstandingChoices` over a synthetic envelope sequence) but over the LIVE character
 * instead of a from-scratch draft: draft = the live committed facts (`CharacterStore.facts()`)
 * plus this session's own not-yet-committed `level.gained`/`decision.made`/spell drafts, re-derived
 * in memory exactly the way the creation wizard re-derives its own outstanding choices after every
 * decision — this is what lets the ASI feat's own `@4/ability-scores` sub-choice (T1) surface the
 * moment the feat itself is picked, with zero special-casing here.
 */
@Injectable()
export class LevelUpState {
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly packStore = inject(PackStore);

  readonly decisions = signal<ReadonlyMap<string, string[]>>(new Map());
  readonly decisionContexts = signal<ReadonlyMap<string, Record<string, unknown>>>(new Map());
  readonly extraDrafts = signal<readonly DraftEvent[]>([]);
  readonly hpRoll = signal<number | 'average' | undefined>(undefined);
  readonly hpRollDice = signal<RollResult['dice'] | undefined>(undefined);

  /** User-confirmed "done" marker for the free-form 'spells' step — mirrors
   * `CreateWizardState.doneSteps`'s own doc; never required for `complete()` (spell learning at
   * level-up is a soft recommendation, never a gate — task-13-brief.md). */
  readonly doneSteps = signal<ReadonlySet<string>>(new Set());

  private readonly systemRules = computed<SystemRules | undefined>(() => {
    if (!this.packStore.ready()) return undefined;
    const system = this.engineFacade.index().system();
    return { restRules: system.restRules, hpRules: system.hpRules };
  });

  /** The class this session is leveling — the first (`pendingAdvancements`'s own classId sort) of
   * whatever `CharacterStore.advancements()` currently reports. 1b never offers a picker across
   * multiple simultaneously-eligible classes (out of scope, task-13-brief.md) — a character with
   * more than one eligible class at once always advances this one first; a second visit to
   * `/c/:id/level-up` after committing handles the next. */
  readonly advancement: Signal<Advancement | undefined> = computed(
    () => this.characterStore.advancements()[0],
  );

  private readonly classEntity = computed(() => {
    const a = this.advancement();
    if (!a) return undefined;
    const entity = this.engineFacade.index().get(a.classId);
    return entity?.type === 'class' ? entity : undefined;
  });

  readonly hitDie: Signal<number | undefined> = computed(() => this.classEntity()?.hitDie);

  /** The subclass entity id, if any decision made THIS session selected one — scanned by the
   * SELECTED entity's type, not by choiceId shape, so it works whatever slug the pack gives its
   * subclass-row choice. Mirrors `level.gained.subclassId`'s own "filled when a subclass decision
   * was made this level" contract (task-13-brief.md). Only ever scans `this.decisions` (THIS
   * session's own draft map), never committed history, so an unrelated past choice can never match. */
  private readonly subclassIdThisLevel = computed<string | undefined>(() => {
    const index = this.engineFacade.index();
    for (const selection of this.decisions().values()) {
      for (const id of selection) {
        if (index.get(id)?.type === 'subclass') return id;
      }
    }
    return undefined;
  });

  /** `excludeChoiceId`, when given, omits that ONE `decision.made` draft from the built sequence —
   * used by `validate()` (see its own doc) to re-check an already-recorded decision's selection
   * without double-counting that SAME decision's already-applied effect (an `abilities` pick reads
   * the draft SHEET's current score, so re-validating it while its own prior contribution is still
   * baked into that sheet would otherwise see e.g. `17 + 2 (already applied) + 2 (proposed) > 20`
   * instead of the correct `17 + 2 (proposed) ≤ 20`). */
  private buildDraftEnvelopes(fromSeq: number, excludeChoiceId?: string): Event[] {
    const a = this.advancement();
    const streamId = this.characterStore.streamId();
    if (!a || !streamId) return [];

    const events: Event[] = [];
    let seq = fromSeq;
    const push = (type: string, v: number, payload: unknown): void => {
      seq += 1;
      const parsed = parseEvent({
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
        stream: streamId,
        seq,
        ts: DRAFT_TS,
        actor: DRAFT_ACTOR,
        type,
        v,
        payload,
      });
      // Never actually invalid in practice (every payload built below is well-formed), but a
      // silently-dropped draft is safer than a thrown exception mid-render if it ever were — same
      // reasoning as `CreateWizardState.draftEvents`'s own `push`.
      if (parsed.ok) events.push(parsed.event);
    };

    const hpRoll = this.hpRoll();
    const subclassId = this.subclassIdThisLevel();
    push('level.gained', 1, {
      classId: a.classId,
      level: a.toLevel,
      ...(hpRoll !== undefined ? { hpRoll } : {}),
      ...(subclassId !== undefined ? { subclassId } : {}),
    });

    for (const [choiceId, selection] of this.decisions()) {
      if (choiceId === excludeChoiceId) continue;
      const context = this.decisionContexts().get(choiceId);
      push('decision.made', 1, { choiceId, selection, ...(context ? { context } : {}) });
    }

    for (const draft of this.extraDrafts()) push(draft.type, draft.v, draft.payload);

    return events;
  }

  /** Incremental reduce on top of a snapshot of the LIVE `CharacterStore.facts()` — see class doc
   * and `buildDraftEnvelopes`'s own `excludeChoiceId` doc. `undefined` before packs/facts/an
   * advancement are all ready (mirrors `CreateWizardState.draftFacts`'s own "nothing to reduce yet"
   * gate). */
  private reduceDraft(excludeChoiceId?: string) {
    const base = this.characterStore.facts();
    const a = this.advancement();
    if (!base || !a) return undefined;
    const events = this.buildDraftEnvelopes(base.lastSeq, excludeChoiceId);
    if (events.length === 0) return base;
    const snapshot: Snapshot = {
      seq: base.lastSeq,
      facts: base,
      engineVersion: ENGINE_VERSION,
      rules: this.systemRules(),
    };
    return reduce(events, snapshot, this.systemRules());
  }

  private readonly draftFacts = computed(() => this.reduceDraft());

  readonly draftSheet: Signal<Sheet | undefined> = computed(() => {
    const facts = this.draftFacts();
    if (!facts || !this.packStore.ready()) return undefined;
    return derive(facts, this.engineFacade.index(), this.systemRules());
  });

  readonly outstanding: Signal<ChoiceRequest[]> = computed(() => {
    const facts = this.draftFacts();
    if (!facts) return [];
    return outstandingChoices(facts, this.engineFacade.index());
  });

  /** Mirrors `CreateWizardState.invalidDecisions`'s own doc exactly, over this session's draft. */
  readonly invalidDecisions: Signal<ReadonlyMap<string, Diagnostic[]>> = computed(() => {
    const result = new Map<string, Diagnostic[]>();
    for (const [choiceId, selection] of this.decisions()) {
      const errors = this.validate(choiceId, selection).filter((d) => d.severity === 'error');
      if (errors.length > 0) result.set(choiceId, errors);
    }
    return result;
  });

  /** ORDER: 'hp' (always — `Advancement.hpChoice` is always true in 1b's XP-mode scope, per
   * `pendingAdvancements`'s own doc) → one 'choice' step per outstanding-or-invalidly-decided
   * choiceId (engine sorted order; a newly-unlocked sub-choice, e.g. the ASI feat's own
   * ability-scores pick, simply appears once its decision lands, same as the creation wizard) →
   * 'spells' (only when the class being leveled has a spellcasting block) → 'review'. */
  readonly steps: Signal<LevelUpStep[]> = computed(() => {
    const a = this.advancement();
    if (!a) return [];
    const steps: LevelUpStep[] = [];
    if (a.hpChoice) steps.push({ id: 'hp', labelKey: 'characters.levelUp.steps.hp', kind: 'hp' });

    const seen = new Set<string>();
    const ids = [...this.outstanding().map((r) => r.choiceId), ...this.invalidDecisions().keys()];
    for (const choiceId of ids) {
      if (seen.has(choiceId)) continue;
      seen.add(choiceId);
      steps.push({
        id: choiceId,
        labelKey: 'characters.levelUp.steps.choice',
        choiceId,
        kind: 'choice',
      });
    }

    const sheet = this.draftSheet();
    if (sheet?.spellcasting.some((b) => b.classId === a.classId)) {
      steps.push({ id: 'spells', labelKey: 'characters.levelUp.steps.spells', kind: 'spells' });
    }
    steps.push({ id: 'review', labelKey: 'characters.levelUp.steps.review', kind: 'review' });
    return steps;
  });

  /** Gates the review step's "Finish" action: an HP choice must be made (always required, see
   * `steps`'s doc) and every choice this level asks for must be resolved and valid. Spell
   * learning/preparing is never gating (soft recommendation only). */
  readonly complete: Signal<boolean> = computed(() => {
    const a = this.advancement();
    if (!a) return false;
    if (a.hpChoice && this.hpRoll() === undefined) return false;
    return this.outstanding().length === 0 && this.invalidDecisions().size === 0;
  });

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

  /** `validateSelection` over the draft sheet/facts, with `choiceId`'s OWN already-recorded
   * decision excluded from that draft first WHEN `choiceId` resolves to an `abilities` pick (see
   * `isAbilitiesPick`'s doc — mirrors `CreateWizardState.validate`'s own fix exactly, including the
   * same narrowing: 1b's level-up flow never re-offers `abilityGeneration` — that pick is
   * creation-only — but the guard is kept here too so this stays correct if that ever changes).
   * This is what lets `invalidDecisions` re-check an already-decided `abilities` pick (the ASI
   * feat) without its own prior contribution double-counting against itself. A choiceId with no
   * recorded decision yet, or one that isn't an `abilities` pick, is unaffected. `[]` before an
   * advancement/draft exists. */
  validate(choiceId: string, selection: string[]): Diagnostic[] {
    const excludeChoiceId = this.isAbilitiesPick(choiceId) ? choiceId : undefined;
    const facts = this.reduceDraft(excludeChoiceId);
    if (!facts || !this.packStore.ready()) return [];
    const sheet = derive(facts, this.engineFacade.index(), this.systemRules());
    return validateSelection(sheet, facts, this.engineFacade.index(), choiceId, selection);
  }

  /** See `CreateWizardState.isAbilitiesPick`'s doc — identical reasoning. */
  private isAbilitiesPick(choiceId: string): boolean {
    const found = findChoice(this.engineFacade.index(), choiceId);
    return found !== undefined && 'abilities' in found.choice.pick;
  }

  /** Rolls `1d<hitDie>` via the injected `rng` (defaults to the app's `cryptoRng`) — overridable so
   * a spec can drive a scripted, deterministic result (task-13-brief.md Step 1's "hpRoll: 5 from a
   * scripted rng"). A no-op while the class's hit die isn't resolved yet. */
  rollHp(rng: () => number = cryptoRng): void {
    const hitDie = this.hitDie();
    if (hitDie === undefined) return;
    const result = roll(parseRollSpec(`1d${hitDie}`), rng);
    this.hpRollDice.set(result.dice);
    this.hpRoll.set(result.total);
  }

  /** Takes the average hit-die value instead of rolling — the `level.gained.hpRoll` choice lands
   * as the literal string `'average'` (task-13-brief.md), priced by `deriveHp` itself. */
  chooseAverageHp(): void {
    this.hpRollDice.set(undefined);
    this.hpRoll.set('average');
  }

  markStepDone(stepId: string): void {
    if (this.doneSteps().has(stepId)) return;
    this.doneSteps.update((prev) => new Set(prev).add(stepId));
  }

  // --- spell mutators — mirrors `CreateWizardState`'s own section exactly (see its class doc) ---

  private matchesSpellDraft(
    draft: DraftEvent,
    type: string,
    spellId: string,
    classId: string,
  ): boolean {
    if (draft.type !== type) return false;
    const p = draft.payload as { spellId?: unknown; classId?: unknown };
    return p.spellId === spellId && p.classId === classId;
  }

  addSpellLearned(spellId: string, classId: string): void {
    if (
      this.extraDrafts().some((d) => this.matchesSpellDraft(d, 'spell.learned', spellId, classId))
    ) {
      return;
    }
    this.extraDrafts.update((prev) => [
      ...prev,
      { type: 'spell.learned', v: 1, payload: { spellId, classId, source: 'levelUp' } },
    ]);
  }

  removeSpellLearned(spellId: string, classId: string): void {
    this.extraDrafts.update((prev) =>
      prev.filter(
        (d) =>
          !this.matchesSpellDraft(d, 'spell.learned', spellId, classId) &&
          !this.matchesSpellDraft(d, 'spell.prepared', spellId, classId),
      ),
    );
  }

  addSpellPrepared(spellId: string, classId: string): void {
    if (
      this.extraDrafts().some((d) => this.matchesSpellDraft(d, 'spell.prepared', spellId, classId))
    ) {
      return;
    }
    this.extraDrafts.update((prev) => [
      ...prev,
      { type: 'spell.prepared', v: 1, payload: { spellId, classId } },
    ]);
  }

  removeSpellPrepared(spellId: string, classId: string): void {
    this.extraDrafts.update((prev) =>
      prev.filter((d) => !this.matchesSpellDraft(d, 'spell.prepared', spellId, classId)),
    );
  }

  /** `level.gained` FIRST (`subclassId` filled iff a subclass decision landed this level), then
   * `decision.made`s, then queued spell drafts — task-13-brief.md's binding transaction order. The
   * caller (`LevelUpComponent`'s review step) commits this via ONE `CharacterStore.appendTx` call,
   * so every event here shares a single txId the moment it's appended. `[]` before an advancement
   * exists (nothing to commit). */
  buildTransaction(): DraftEvent[] {
    const a = this.advancement();
    if (!a) return [];
    const hpRoll = this.hpRoll();
    const subclassId = this.subclassIdThisLevel();
    const drafts: DraftEvent[] = [
      {
        type: 'level.gained',
        v: 1,
        payload: {
          classId: a.classId,
          level: a.toLevel,
          ...(hpRoll !== undefined ? { hpRoll } : {}),
          ...(subclassId !== undefined ? { subclassId } : {}),
        },
      },
    ];

    for (const [choiceId, selection] of this.decisions()) {
      const context = this.decisionContexts().get(choiceId);
      drafts.push({
        type: 'decision.made',
        v: 1,
        payload: { choiceId, selection, ...(context ? { context } : {}) },
      });
    }

    drafts.push(...this.extraDrafts());
    return drafts;
  }
}
