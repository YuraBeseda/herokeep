import { Component, computed, inject, input } from '@angular/core';
import type { Sheet } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CreateWizardState } from '../create-wizard.state';
import { EntityPickerComponent } from './entity-picker.component';

// Not exported from `@hk/engine`'s own barrel (only the `deriveSpellcasting` FUNCTION is, via
// `derive/index.ts`) — recovered from the already-exported `Sheet` shape instead of widening the
// engine package's public surface just for this one type.
type SpellcastingBlock = Sheet['spellcasting'][number];

/** A single spell-mutator override — see this file's class doc's "override trio" note. */
type SpellMutatorFn = (spellId: string, classId: string) => void;

// `hk-entity-picker`'s R3 render cap (task-6 fix round) — the real SRD pack carries 339 spells;
// even a single class's cantrip/level-1 slice is small (15/30 in the SRD pack), but the cap is
// passed defensively regardless (task-8-brief.md: "PASS A CAP … for the spell picker").
const SPELL_PICKER_LIMIT = 60;

// Recommended (soft, non-blocking) spellbook size at creation — controller ruling (design
// rulings 1-2, task-8-brief.md): helper text only, never enforced.
const SPELLBOOK_RECOMMENDED = 6;

/**
 * The wizard's 'spells' step (task-8-brief.md): only ever mounted once
 * `CreateWizardState.draftSheet().spellcasting.length > 0` (see `steps()`'s own gate), so
 * `block()` is only `undefined` for the brief instant before that gate has taken effect — never
 * in steady state.
 *
 * Three sections, each backed by `CreateWizardState`'s own extraDrafts mutators (never touching
 * `CharacterStore` — this is still a throwaway draft, same as every other wizard step):
 *   - Cantrips (spell level 0): `hk-entity-picker` toggle emits `addSpellLearned`/
 *     `removeSpellLearned`. HARD-capped at `cantripsKnown` — a tap past the cap is silently
 *     refused (the cap-reached message stays visible from the moment the cap is hit, which
 *     doubles as the "you're blocked" signal for a refused tap).
 *   - Spellbook (spell level 1, this system's only creation-time non-cantrip spells): same
 *     toggle wiring, but SOFT-capped — `SPELLBOOK_RECOMMENDED` is helper text only, a 7th (or
 *     more) is always allowed.
 *   - Prepared: one toggle per spellbook-known spell (cantrips are always available and never
 *     enter the prepared pool — 5e's own rule, mirrored here only insofar as the UI never offers
 *     a prepared toggle for a cantrip). HARD-capped at `preparedMax`.
 *
 * Every cap here is UI-only (comment repeated at the call sites deliberately): the engine has no
 * draft-validation for `extraDrafts` (unlike `decision.made`, which flows through
 * `validateSelection`) — a real, already-committed `CharacterStore.appendTx` would apply an
 * over-cap `spell.learned`/`spell.prepared` just fine; nothing but this component's own guard
 * stops it from ever being queued in the first place.
 */
@Component({
  selector: 'hk-spells-step',
  imports: [TranslocoDirective, EntityPickerComponent, ButtonComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './spells-step.component.html',
  styleUrl: './spells-step.component.scss',
})
export class SpellsStepComponent {
  // Optional (task-13-brief.md): only the creation wizard mounts this with no overrides, relying
  // entirely on its own injected `CreateWizardState`; the level-up wizard (`LevelUpComponent`)
  // supplies every override below instead, driving the SAME cantrip/spellbook/prepared UI against
  // `LevelUpState` — mirrors `hk-choice-step`'s own override-or-injected-state convention
  // (`choice-step-overrides.ts`'s class doc) rather than duplicating this component.
  private readonly state = inject(CreateWizardState, { optional: true });
  private readonly engineFacade = inject(EngineFacade);

  protected readonly spellPickerLimit = SPELL_PICKER_LIMIT;
  protected readonly spellbookRecommended = SPELLBOOK_RECOMMENDED;

  // Override trio + one more (task-13-brief.md): `spellcasting` overrides which block this step
  // reads (`CreateWizardState.draftSheet()?.spellcasting[0]` otherwise); `learn`/`unlearn`/
  // `prepare`/`unprepare` override the four draft mutators; `finish` overrides the "Continue"
  // button's action (`CreateWizardState.markStepDone('spells')` otherwise). Every one of these
  // falls back to `state` when omitted — the wizard's own usage never passes them, so nothing
  // changes for it. Not aliased (`@angular-eslint/no-input-rename`) — the property name IS the
  // binding name.
  readonly spellcasting = input<SpellcastingBlock | undefined>(undefined);
  readonly learn = input<SpellMutatorFn | undefined>(undefined);
  readonly unlearn = input<SpellMutatorFn | undefined>(undefined);
  readonly prepare = input<SpellMutatorFn | undefined>(undefined);
  readonly unprepare = input<SpellMutatorFn | undefined>(undefined);
  readonly finish = input<(() => void) | undefined>(undefined);

  protected readonly block = computed(
    () => this.spellcasting() ?? this.state?.draftSheet()?.spellcasting[0],
  );
  protected readonly classId = computed(() => this.block()?.classId ?? '');

  protected readonly cantripIds = computed<string[]>(() => {
    const classId = this.classId();
    if (!classId) return [];
    return this.engineFacade
      .index()
      .query({ type: 'spell', level: 0, classes: [classId] })
      .map((e) => e.id);
  });

  protected readonly spellbookIds = computed<string[]>(() => {
    const classId = this.classId();
    if (!classId) return [];
    return this.engineFacade
      .index()
      .query({ type: 'spell', level: 1, classes: [classId] })
      .map((e) => e.id);
  });

  protected readonly knownIds = computed(() => this.block()?.known ?? []);

  protected readonly cantripsKnownIds = computed<string[]>(() => {
    const cantrips = new Set(this.cantripIds());
    return this.knownIds().filter((id) => cantrips.has(id));
  });

  protected readonly spellbookKnownIds = computed<string[]>(() => {
    const spellbook = new Set(this.spellbookIds());
    return this.knownIds().filter((id) => spellbook.has(id));
  });

  protected readonly cantripCap = computed(() => this.block()?.cantripsKnown ?? 0);
  protected readonly cantripCapReached = computed(
    () => this.cantripsKnownIds().length >= this.cantripCap(),
  );

  protected readonly preparedIds = computed(() => this.block()?.prepared ?? []);
  protected readonly preparedMax = computed(() => this.block()?.preparedMax ?? 0);
  protected readonly preparedCapReached = computed(
    () => this.preparedIds().length >= this.preparedMax(),
  );

  protected spellName(id: string): string {
    return this.engineFacade.localizer().name(id);
  }

  protected isPrepared(id: string): boolean {
    return this.preparedIds().includes(id);
  }

  protected onToggleCantrip(id: string): void {
    const classId = this.classId();
    if (!classId) return;
    if (this.cantripsKnownIds().includes(id)) {
      this.runUnlearn(id, classId);
      return;
    }
    if (this.cantripCapReached()) return; // hard cap — silently refused, see class doc
    this.runLearn(id, classId);
  }

  protected onToggleSpellbook(id: string): void {
    const classId = this.classId();
    if (!classId) return;
    if (this.spellbookKnownIds().includes(id)) {
      this.runUnlearn(id, classId);
    } else {
      this.runLearn(id, classId); // soft cap — always allowed
    }
  }

  protected onTogglePrepared(id: string): void {
    const classId = this.classId();
    if (!classId) return;
    if (this.isPrepared(id)) {
      this.runUnprepare(id, classId);
      return;
    }
    if (this.preparedCapReached()) return; // hard cap — silently refused, see class doc
    this.runPrepare(id, classId);
  }

  protected onContinue(): void {
    const override = this.finish();
    if (override) {
      override();
      return;
    }
    this.state?.markStepDone('spells');
  }

  // Mirrors `ChoiceStepComponent`'s own override-or-injected-state fallback (see
  // `choice-step-overrides.ts`'s class doc) for each of the four draft mutators.
  private runLearn(spellId: string, classId: string): void {
    const override = this.learn();
    if (override) {
      override(spellId, classId);
      return;
    }
    this.state?.addSpellLearned(spellId, classId);
  }

  private runUnlearn(spellId: string, classId: string): void {
    const override = this.unlearn();
    if (override) {
      override(spellId, classId);
      return;
    }
    this.state?.removeSpellLearned(spellId, classId);
  }

  private runPrepare(spellId: string, classId: string): void {
    const override = this.prepare();
    if (override) {
      override(spellId, classId);
      return;
    }
    this.state?.addSpellPrepared(spellId, classId);
  }

  private runUnprepare(spellId: string, classId: string): void {
    const override = this.unprepare();
    if (override) {
      override(spellId, classId);
      return;
    }
    this.state?.removeSpellPrepared(spellId, classId);
  }
}
