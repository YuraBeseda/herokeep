import { Component, computed, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CreateWizardState } from '../create-wizard.state';
import { EntityPickerComponent } from './entity-picker.component';

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
  private readonly state = inject(CreateWizardState);
  private readonly engineFacade = inject(EngineFacade);

  protected readonly spellPickerLimit = SPELL_PICKER_LIMIT;
  protected readonly spellbookRecommended = SPELLBOOK_RECOMMENDED;

  protected readonly block = computed(() => this.state.draftSheet()?.spellcasting[0]);
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
      this.state.removeSpellLearned(id, classId);
      return;
    }
    if (this.cantripCapReached()) return; // hard cap — silently refused, see class doc
    this.state.addSpellLearned(id, classId);
  }

  protected onToggleSpellbook(id: string): void {
    const classId = this.classId();
    if (!classId) return;
    if (this.spellbookKnownIds().includes(id)) {
      this.state.removeSpellLearned(id, classId);
    } else {
      this.state.addSpellLearned(id, classId); // soft cap — always allowed
    }
  }

  protected onTogglePrepared(id: string): void {
    const classId = this.classId();
    if (!classId) return;
    if (this.isPrepared(id)) {
      this.state.removeSpellPrepared(id, classId);
      return;
    }
    if (this.preparedCapReached()) return; // hard cap — silently refused, see class doc
    this.state.addSpellPrepared(id, classId);
  }

  protected onContinue(): void {
    this.state.markStepDone('spells');
  }
}
