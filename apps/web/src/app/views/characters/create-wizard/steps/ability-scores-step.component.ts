import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { parseRollSpec, roll, type Diagnostic, type RollResult } from '@hk/engine';
import type { Entity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import { TabsComponent, type HkTab } from '@shared/components/tabs/tabs.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { cryptoRng } from '@shared/services/engine/rng';
import { CreateWizardState } from '../create-wizard.state';

type GenerationMethod = 'standardArray' | 'pointBuy' | 'manual' | 'roll';

const METHOD_ORDER: readonly GenerationMethod[] = ['standardArray', 'pointBuy', 'manual', 'roll'];

// Only diagnostic codes `validateAbilityGeneration` (packages/engine/src/derive/validation.ts) can
// actually produce get a specific message; anything else falls back to a generic one (mirrors
// `choice-step.component.ts`'s own `KNOWN_DIAGNOSTIC_CODES` convention).
const KNOWN_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'selection.count',
  'selection.invalidEntry',
  'selection.standardArrayMismatch',
  'selection.pointBuyRange',
  'selection.pointBuyBudget',
  'selection.manualRange',
  'selection.rollRange',
  'selection.abilityGenerationInvalid',
]);

function diagnosticKey(code: string): string {
  return KNOWN_DIAGNOSTIC_CODES.has(code) ? `validation.${code}` : 'validation.generic';
}

/**
 * The `abilityGeneration` pick (task-7-brief.md): all four generation methods the SRD system
 * entity declares (`index.system().abilityGeneration` — standard array, point buy, manual, roll),
 * read live off the pack so nothing here hardcodes a 5e rule. Every method converges on the same
 * `['str:15', …]`-shaped selection plus a `{method, scores, rolls?}` context (doc-02 § events),
 * committed through `CreateWizardState.validate`/`setDecision` on every change — mirroring
 * `hk-choice-step`'s "always commit, even mid-edit" live-diagnostics philosophy.
 *
 * Multiset enforcement (standard array) and free-assignment exclusivity (roll) both work the same
 * way: each ability's `<select>` only ever offers array/roll-result SLOTS not already claimed by a
 * different ability (plus whichever slot IT currently holds), so the UI makes a duplicate
 * assignment structurally unavailable rather than merely flagging it after the fact — the engine's
 * own `validateAbilityGeneration` still re-checks the multiset authoritatively.
 */
@Component({
  selector: 'hk-ability-scores-step',
  imports: [TranslocoDirective, FormsModule, TabsComponent, NumberFieldComponent, ButtonComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './ability-scores-step.component.html',
  styleUrl: './ability-scores-step.component.scss',
})
export class AbilityScoresStepComponent {
  private readonly state = inject(CreateWizardState);
  private readonly engineFacade = inject(EngineFacade);
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  // Inputs
  readonly choiceId = input.required<string>();

  protected readonly system = computed(() => this.engineFacade.index().system());
  protected readonly abilities = computed(() => this.system().abilities);
  protected readonly gen = computed(() => this.system().abilityGeneration);

  protected readonly availableMethods = computed<GenerationMethod[]>(() => {
    const gen = this.gen();
    return METHOD_ORDER.filter((m) => {
      if (m === 'standardArray') return (gen.standardArray?.length ?? 0) > 0;
      if (m === 'pointBuy') return gen.pointBuy !== undefined;
      if (m === 'manual') return gen.manual !== undefined;
      return gen.roll !== undefined;
    });
  });

  // `undefined` until a tab is explicitly clicked — `activeMethod` falls back to the first
  // available method, same convention as `hk-tabs`' own `selected` model.
  protected readonly method = signal<string | undefined>(undefined);
  protected readonly activeMethod = computed<GenerationMethod | undefined>(() => {
    const methods = this.availableMethods();
    const selected = this.method();
    return methods.includes(selected as GenerationMethod)
      ? (selected as GenerationMethod)
      : methods[0];
  });

  // Working (uncommitted-elsewhere) per-method state. Ability id -> array/roll-result SLOT INDEX
  // for standard-array/roll (never the raw value itself — see the class doc's multiset note);
  // ability id -> raw score for point-buy/manual. A missing key means "not yet assigned".
  protected readonly standardArrayAssignment = signal<Record<string, number>>({});
  protected readonly pointBuyScores = signal<Record<string, number>>({});
  protected readonly manualScores = signal<Record<string, number>>({});
  protected readonly rollResults = signal<RollResult[] | undefined>(undefined);
  protected readonly rollAssignment = signal<Record<string, number>>({});

  protected readonly diagnostics = signal<Diagnostic[]>([]);

  constructor() {
    // Resets all working state whenever `choiceId` changes (same reasoning as
    // `ChoiceStepComponent`'s own reset effect: a freshly-mounted choice never inherits a stale
    // in-progress selection from a previous one).
    effect(() => {
      this.choiceId();
      this.method.set(undefined);
      this.standardArrayAssignment.set({});
      this.pointBuyScores.set({});
      this.manualScores.set({});
      this.rollResults.set(undefined);
      this.rollAssignment.set({});
      this.diagnostics.set([]);
    });
  }

  // Methods

  protected methodTabs(t: (key: string) => string): HkTab[] {
    return this.availableMethods().map((m) => ({
      id: m,
      label: t(`wizard.abilityScores.method.${m}`),
    }));
  }

  protected abilityName(key: string): string {
    const entity = this.engineFacade
      .index()
      .byType('ability')
      .find(
        (e): e is Extract<Entity, { type: 'ability' }> =>
          e.type === 'ability' && e.abbreviation === key,
      );
    return entity ? this.engineFacade.localizer().name(entity.id) : key.toUpperCase();
  }

  protected diagnosticKey(code: string): string {
    return diagnosticKey(code);
  }

  // Standard array

  protected standardArrayOptionsFor(abilityId: string): { index: number; value: number }[] {
    const values = this.gen().standardArray;
    const usedElsewhere = this.usedElsewhere(this.standardArrayAssignment(), abilityId);
    return values
      .map((value, index) => ({ index, value }))
      .filter(({ index }) => !usedElsewhere.has(index));
  }

  protected onAssignStandardArray(abilityId: string, raw: string): void {
    this.standardArrayAssignment.set(
      this.applySlot(this.standardArrayAssignment(), abilityId, raw),
    );
    this.commitStandardArray();
  }

  private commitStandardArray(): void {
    const values = this.gen().standardArray;
    const assignment = this.standardArrayAssignment();
    const scores: Record<string, number> = {};
    for (const a of this.abilities()) {
      const idx = assignment[a.id];
      if (idx !== undefined) scores[a.id] = values[idx];
    }
    this.commit('standardArray', scores);
  }

  // Point buy

  protected pointBuyValue(abilityId: string): number {
    return this.pointBuyScores()[abilityId] ?? this.gen().pointBuy.min;
  }

  protected pointBuyCost(value: number): number {
    return this.gen().pointBuy.costs[String(value)] ?? 0;
  }

  protected readonly pointBuyTotal = computed(() => {
    const pointBuy = this.gen().pointBuy;
    const scores = this.pointBuyScores();
    return this.abilities().reduce((sum, a) => {
      const v = scores[a.id] ?? pointBuy.min;
      return sum + (pointBuy.costs[String(v)] ?? 0);
    }, 0);
  });

  protected readonly pointBuyOverBudget = computed(
    () => this.pointBuyTotal() > this.gen().pointBuy.budget,
  );

  protected onPointBuyChange(abilityId: string, value: number | null): void {
    const v = value ?? this.gen().pointBuy.min;
    this.pointBuyScores.update((prev) => ({ ...prev, [abilityId]: v }));
    this.commitPointBuy();
  }

  private commitPointBuy(): void {
    const pointBuy = this.gen().pointBuy;
    const scores: Record<string, number> = {};
    for (const a of this.abilities()) scores[a.id] = this.pointBuyScores()[a.id] ?? pointBuy.min;
    this.commit('pointBuy', scores);
  }

  // Manual

  protected manualValue(abilityId: string): number | null {
    return this.manualScores()[abilityId] ?? null;
  }

  protected onManualChange(abilityId: string, value: number | null): void {
    this.manualScores.update((prev) => {
      const next = { ...prev };
      if (value === null) delete next[abilityId];
      else next[abilityId] = value;
      return next;
    });
    this.commitManual();
  }

  private commitManual(): void {
    const scores: Record<string, number> = {};
    const manualScores = this.manualScores();
    for (const a of this.abilities()) {
      const v = manualScores[a.id];
      if (v !== undefined) scores[a.id] = v;
    }
    this.commit('manual', scores);
  }

  // Roll

  // Rolls all six abilities' dice at once and seeds a default 1:1 assignment (ability order ==
  // roll order) — re-assignment stays free afterward (see `onAssignRoll`), but rolling itself is
  // one-shot: once `rollResults` holds a value, this is a no-op (task-7-brief.md's "re-roll NOT
  // offered once assigned" — rolls are recorded, honesty by design).
  // `t` is the scoped translate function from the template's own `*transloco="let t; read:
  // 'characters'"` (passed in from the click binding, same trick as `methodTabs`) — LiveAnnouncer
  // needs the resolved STRING right now, which only a scoped `t()` call (not a service call with a
  // manually-prefixed key) both resolves correctly AND stays visible to the i18n key checker.
  protected onRollAll(t: (key: string, params?: Record<string, unknown>) => string): void {
    if (this.rollResults()) return;
    const spec = parseRollSpec(this.gen().roll);
    const abilities = this.abilities();
    const results = abilities.map(() => roll(spec, cryptoRng));
    this.rollResults.set(results);
    const defaultAssignment: Record<string, number> = {};
    abilities.forEach((a, i) => {
      defaultAssignment[a.id] = i;
    });
    this.rollAssignment.set(defaultAssignment);
    this.commitRoll();

    const scores = results.map((r) => r.total).join(', ');
    const message = t('wizard.abilityScores.rollsAnnounced', { scores });
    void this.liveAnnouncer.announce(message);
  }

  protected rollOptionsFor(abilityId: string): { index: number; total: number }[] {
    const results = this.rollResults();
    if (!results) return [];
    const usedElsewhere = this.usedElsewhere(this.rollAssignment(), abilityId);
    return results
      .map((r, index) => ({ index, total: r.total }))
      .filter(({ index }) => !usedElsewhere.has(index));
  }

  protected onAssignRoll(abilityId: string, raw: string): void {
    this.rollAssignment.set(this.applySlot(this.rollAssignment(), abilityId, raw));
    this.commitRoll();
  }

  // `undefined` when the ability has no roll assigned yet — kept as its own method (rather than
  // inlined in the template) because slot 0 is a legitimate assignment and must not read as falsy.
  protected rollDiceFor(abilityId: string): RollResult['dice'] | undefined {
    const results = this.rollResults();
    const slot = this.rollAssignment()[abilityId];
    return results && slot !== undefined ? results[slot]?.dice : undefined;
  }

  private commitRoll(): void {
    const results = this.rollResults();
    if (!results) return;
    const assignment = this.rollAssignment();
    const scores: Record<string, number> = {};
    for (const a of this.abilities()) {
      const idx = assignment[a.id];
      if (idx !== undefined) scores[a.id] = results[idx].total;
    }
    this.commit('roll', scores, results);
  }

  // Shared slot-assignment helpers (standard array + roll both assign an exclusive SLOT INDEX per
  // ability, never a raw value, so a duplicate face value in the source array/rolls can still be
  // assigned to two different abilities while a single value/roll can only go to one).

  private usedElsewhere(assignment: Record<string, number>, abilityId: string): Set<number> {
    return new Set(
      Object.entries(assignment)
        .filter(([a]) => a !== abilityId)
        .map(([, v]) => v),
    );
  }

  private applySlot(
    assignment: Record<string, number>,
    abilityId: string,
    raw: string,
  ): Record<string, number> {
    const next = { ...assignment };
    if (raw === '') delete next[abilityId];
    else next[abilityId] = Number(raw);
    return next;
  }

  private commit(
    method: GenerationMethod,
    scores: Record<string, number>,
    rolls?: RollResult[],
  ): void {
    const selection = Object.entries(scores).map(([a, v]) => `${a}:${v}`);
    this.diagnostics.set(this.state.validate(this.choiceId(), selection));
    this.state.setDecision(this.choiceId(), selection, {
      method,
      scores,
      ...(rolls ? { rolls } : {}),
    });
  }
}
