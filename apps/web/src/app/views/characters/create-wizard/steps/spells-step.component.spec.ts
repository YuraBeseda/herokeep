import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
import { hintOf, press } from '../../../../ui/testing/harness';
import shellEn from '../../../../../assets/i18n/shell/en.json';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { CreateWizardState } from '../create-wizard.state';
import { SpellsStepComponent } from './spells-step.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling) — same approach as every
// other create-wizard step spec.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

const SYSTEM_ID = 'srd-5e-2024:system/5e-2024';
const SPECIES_CHOICE = `${SYSTEM_ID}@0/species`;
const BACKGROUND_CHOICE = `${SYSTEM_ID}@0/background`;
const CLASS_CHOICE = `${SYSTEM_ID}@0/class`;
const ABILITY_SCORES_CHOICE = `${SYSTEM_ID}@0/ability-scores`;
const BACKGROUND_ABILITIES_CHOICE = 'srd-5e-2024:background/soldier@0/ability-scores';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'shell/en') return of(shellEn);
    return of({});
  }
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      CreateWizardState,
    ],
  });
}

/** A full, valid creation draft up to and including the class decision — WIZARD by default, so
 * `draftSheet().spellcasting[0]` exists (this component's own render gate, mirrored by
 * `CreateWizardState.steps()`, per its class doc). */
function createWizardDraft(classId = 'srd-5e-2024:class/wizard'): CreateWizardState {
  const state = TestBed.inject(CreateWizardState);
  state.name.set('Aldric');
  state.setDecision(SPECIES_CHOICE, ['srd-5e-2024:species/human']);
  state.setDecision(BACKGROUND_CHOICE, ['srd-5e-2024:background/soldier']);
  state.setDecision(BACKGROUND_ABILITIES_CHOICE, ['str:+2', 'con:+1']);
  state.setDecision(
    ABILITY_SCORES_CHOICE,
    ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
    { method: 'standardArray' },
  );
  state.setDecision(CLASS_CHOICE, [classId]);
  return state;
}

/** The tick toggles of one section, in list order. */
function toggles(compiled: HTMLElement, sectionClass: string): HTMLButtonElement[] {
  return Array.from(
    compiled.querySelectorAll<HTMLButtonElement>(`.${sectionClass} .spell-pick__toggle`),
  );
}

const isBlocked = (button: Element): boolean => button.getAttribute('aria-disabled') === 'true';

describe('SpellsStepComponent', () => {
  beforeEach(() => configure());

  it('a fighter draft has no spellcasting block and no spells step (state-level gate)', () => {
    const state = createWizardDraft('srd-5e-2024:class/fighter');
    expect(state.draftSheet()?.spellcasting.length ?? 0).toBe(0);
    expect(state.steps().map((s) => s.id)).not.toContain('spells');

    // Switching the same draft to a spellcasting class DOES surface the step — proves the gate
    // is genuinely about spellcasting presence, not e.g. always/never showing it.
    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/wizard']);
    expect(state.steps().map((s) => s.id)).toContain('spells');
  });

  it('enforces the cantrip cap (3 at wizard L1): a 4th press is refused, the rest read blocked with the cap as their hint', async () => {
    const state = createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const cantrips = () => toggles(compiled, 'spells-step__cantrips');
    expect(cantrips().length).toBeGreaterThanOrEqual(4);
    expect(cantrips().some(isBlocked)).toBe(false);

    for (let i = 0; i < 3; i++) {
      cantrips()[i].click();
      await fixture.whenStable();
    }
    const classId = state.draftSheet()!.spellcasting[0].classId;
    expect(state.draftSheet()!.spellcasting[0].known).toHaveLength(3);

    // The three learned rows stay pressable (to undo); every other row is blocked and says why.
    expect(cantrips().slice(0, 3).some(isBlocked)).toBe(false);
    expect(isBlocked(cantrips()[3])).toBe(true);
    expect(hintOf(cantrips()[3])).toBe(
      charactersEn.wizard.spells.cantripCapReached.replace('{cap}', '3'),
    );

    // A 4th press (on the still-unselected 4th row) must not grow `known` past 3.
    cantrips()[3].click();
    await fixture.whenStable();
    expect(state.draftSheet()!.spellcasting[0].known).toHaveLength(3);
    expect(
      state
        .extraDrafts()
        .filter(
          (d) =>
            d.type === 'spell.learned' && (d.payload as { classId: string }).classId === classId,
        ),
    ).toHaveLength(3);
  });

  it('every learned row wears the tick seal; the counter chip counts them', async () => {
    createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const section = compiled.querySelector('.spells-step__cantrips')!;
    expect(section.querySelector('hk-wax-seal')).toBeNull();
    expect(section.querySelector('.spells-step__counter')?.textContent?.trim()).toBe(
      '0 of 3 known',
    );

    toggles(compiled, 'spells-step__cantrips')[0].click();
    await fixture.whenStable();

    expect(section.querySelectorAll('hk-wax-seal')).toHaveLength(1);
    expect(toggles(compiled, 'spells-step__cantrips')[0].getAttribute('aria-pressed')).toBe('true');
    expect(section.querySelector('.spells-step__counter')?.textContent?.trim()).toBe(
      '1 of 3 known',
    );
  });

  it('a concentration spell carries the orb glyph with its hint, and no caption stays on the page', async () => {
    createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const orbs = compiled.querySelectorAll('.hk-srow__orb');
    expect(orbs.length).toBeGreaterThan(0);
    expect(hintOf(orbs[0])).toBe(charactersEn.wizard.spells.concentration);
    expect(orbs[0].getAttribute('aria-label')).toBe(charactersEn.wizard.spells.concentration);
    expect(compiled.querySelector('.spells-step__helper, .spells-step__cap-message')).toBeNull();
  });

  it('an info button opens the spell in the description drawer without learning it', async () => {
    const state = createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const info = compiled.querySelector<HTMLElement>('.spells-step__cantrips .spell-pick__info')!;
    press(info);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(compiled.querySelector('hk-description-drawer [role="dialog"]')).not.toBeNull();
    expect(state.draftSheet()!.spellcasting[0].known).toHaveLength(0);
  });

  it('allows a 7th spellbook spell (soft cap); the recommended count is the counter chip hint', async () => {
    const state = createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // The recommendation is available before anything is learned, as the counter's hint.
    const counter = compiled.querySelector('.spells-step__spellbook .spells-step__counter')!;
    expect(hintOf(counter)).toContain('6');

    const spellbook = () => toggles(compiled, 'spells-step__spellbook');
    expect(spellbook().length).toBeGreaterThanOrEqual(7);

    for (let i = 0; i < 7; i++) {
      spellbook()[i].click();
      await fixture.whenStable();
    }

    expect(state.draftSheet()!.spellcasting[0].known).toHaveLength(7);
    // Still nothing blocked in the spellbook — the cap is soft.
    expect(spellbook().some(isBlocked)).toBe(false);
  });

  it('recommendedCount is overridable — the level-up wizard passes 2 instead of the creation-only default of 6', async () => {
    createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    fixture.componentRef.setInput('recommendedCount', 2);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const hint = hintOf(compiled.querySelector('.spells-step__spellbook .spells-step__counter')!);
    expect(hint).toContain('2');
    expect(hint).not.toContain('6');
  });

  it('caps prepared spells at preparedMax (4 at wizard L1): a 5th toggle is refused, blocked with the cap as its hint', async () => {
    const state = createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const spellbook = () => toggles(compiled, 'spells-step__spellbook');
    for (let i = 0; i < 5; i++) {
      spellbook()[i].click();
      await fixture.whenStable();
    }
    expect(state.draftSheet()!.spellcasting[0].known).toHaveLength(5);

    const prepared = () => toggles(compiled, 'spells-step__prepared');
    expect(prepared()).toHaveLength(5);

    for (let i = 0; i < 4; i++) {
      prepared()[i].click();
      await fixture.whenStable();
    }
    expect(state.draftSheet()!.spellcasting[0].prepared).toHaveLength(4);
    expect(isBlocked(prepared()[4])).toBe(true);
    expect(hintOf(prepared()[4])).toBe(
      charactersEn.wizard.spells.preparedCapReached.replace('{cap}', '4'),
    );

    // The 5th spell's own toggle is still refused past the cap.
    prepared()[4].click();
    await fixture.whenStable();
    expect(state.draftSheet()!.spellcasting[0].prepared).toHaveLength(4);

    // Un-preparing one frees a slot back up.
    prepared()[0].click();
    await fixture.whenStable();
    expect(state.draftSheet()!.spellcasting[0].prepared).toHaveLength(3);
    expect(isBlocked(prepared()[4])).toBe(false);
  });

  // Plan 12 task 4: `block.prepared` includes always-prepared grants, which are exempt from the cap
  // and cannot be unprepared. No pack content grants one yet, so the block is hand-shaped through
  // the component's own `spellcasting` override input.
  describe('always-prepared grants', () => {
    async function setup() {
      const state = createWizardDraft();
      const prepare = vi.fn();
      const unprepare = vi.fn();
      const fixture = TestBed.createComponent(SpellsStepComponent);
      fixture.componentRef.setInput('prepare', prepare);
      fixture.componentRef.setInput('unprepare', unprepare);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      for (let i = 0; i < 5; i++) {
        toggles(compiled, 'spells-step__spellbook')[i].click();
        await fixture.whenStable();
      }
      const base = state.draftSheet()!.spellcasting[0];
      const [granted, ...chosen] = base.known;
      // 1 granted + 3 chosen prepared (preparedMax 4): 3 count against the cap.
      fixture.componentRef.setInput('spellcasting', {
        ...base,
        prepared: [granted, chosen[0], chosen[1], chosen[2]],
        alwaysPrepared: [granted],
      });
      await fixture.whenStable();
      return { fixture, compiled, prepare, unprepare, granted, chosen };
    }

    it('does not count the granted spell against preparedMax: a 4th chosen spell can still be prepared', async () => {
      const { fixture, compiled, prepare, chosen } = await setup();

      const fourth = toggles(compiled, 'spells-step__prepared').find(
        (b) => b.getAttribute('aria-pressed') === 'false',
      )!;
      expect(isBlocked(fourth)).toBe(false);
      fourth.click();
      await fixture.whenStable();

      expect(prepare).toHaveBeenCalledWith(chosen[3], expect.any(String));
    });

    it('blocks the granted spell with an accessible reason and a fleur-de-lys marker; pressing it is a no-op', async () => {
      const { fixture, compiled, unprepare } = await setup();
      const reason = charactersEn.sheet.spellcasting.alwaysPreparedReason;

      const blocked = toggles(compiled, 'spells-step__prepared').filter(isBlocked);
      expect(blocked).toHaveLength(1);
      expect(hintOf(blocked[0])).toBe(reason);
      const mark = blocked[0].closest('.spell-pick')!.querySelector('.hk-srow__always')!;
      expect(mark.getAttribute('aria-label')).toBe(charactersEn.sheet.spellcasting.alwaysPrepared);

      blocked[0].click();
      await fixture.whenStable();
      expect(unprepare).not.toHaveBeenCalled();
    });
  });

  it("the creation wizard has no Continue button (the strap's Next is the only way on); a caller's finish override brings it back", async () => {
    createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.spells-step__continue')).toBeNull();

    const finish = vi.fn();
    fixture.componentRef.setInput('finish', finish);
    await fixture.whenStable();
    compiled.querySelector<HTMLButtonElement>('.spells-step__continue')!.click();
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
