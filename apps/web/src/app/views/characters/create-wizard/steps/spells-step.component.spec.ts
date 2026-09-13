import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
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
    return of({});
  }
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
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

function selectButtons(compiled: HTMLElement, sectionClass: string): HTMLButtonElement[] {
  return Array.from(
    compiled.querySelectorAll<HTMLButtonElement>(`.${sectionClass} .entity-picker__select`),
  );
}

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

  it('enforces the cantrip cap (3 at wizard L1): a 4th tap is refused and the cap message appears', async () => {
    const state = createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const cantripButtons = () => selectButtons(compiled, 'spells-step__cantrips');
    expect(cantripButtons().length).toBeGreaterThanOrEqual(4);

    for (let i = 0; i < 3; i++) {
      cantripButtons()[i].click();
      await fixture.whenStable();
    }
    const classId = state.draftSheet()!.spellcasting[0].classId;
    expect(state.draftSheet()!.spellcasting[0].known).toHaveLength(3);
    expect(compiled.querySelector('.spells-step__cantrips .spells-step__cap-message')).toBeTruthy();

    // A 4th tap (on the still-unselected 4th card) must not grow `known` past 3.
    cantripButtons()[3].click();
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

  it('allows a 7th spellbook spell (soft cap) and always shows the recommended-count helper', async () => {
    const state = createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // Helper visible even before anything is learned.
    const helper = compiled.querySelector('.spells-step__spellbook .spells-step__helper');
    expect(helper?.textContent).toContain('6');

    const spellbookButtons = () => selectButtons(compiled, 'spells-step__spellbook');
    expect(spellbookButtons().length).toBeGreaterThanOrEqual(7);

    for (let i = 0; i < 7; i++) {
      spellbookButtons()[i].click();
      await fixture.whenStable();
    }

    expect(state.draftSheet()!.spellcasting[0].known).toHaveLength(7);
    // Still no blocking message anywhere — the spellbook cap is soft.
    expect(compiled.querySelector('.spells-step__spellbook .spells-step__cap-message')).toBeNull();
  });

  it('caps prepared spells at preparedMax (4 at wizard L1): a 5th toggle is refused with a cap message', async () => {
    const state = createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const spellbookButtons = () => selectButtons(compiled, 'spells-step__spellbook');
    for (let i = 0; i < 5; i++) {
      spellbookButtons()[i].click();
      await fixture.whenStable();
    }
    expect(state.draftSheet()!.spellcasting[0].known).toHaveLength(5);

    const preparedToggles = () =>
      Array.from(
        compiled.querySelectorAll<HTMLButtonElement>(
          '.spells-step__prepared .spells-step__prepared-toggle',
        ),
      );
    expect(preparedToggles()).toHaveLength(5);

    for (let i = 0; i < 4; i++) {
      preparedToggles()[i].click();
      await fixture.whenStable();
    }
    expect(state.draftSheet()!.spellcasting[0].prepared).toHaveLength(4);
    expect(compiled.querySelector('.spells-step__prepared .spells-step__cap-message')).toBeTruthy();

    // The 5th spell's own toggle is still refused past the cap.
    preparedToggles()[4].click();
    await fixture.whenStable();
    expect(state.draftSheet()!.spellcasting[0].prepared).toHaveLength(4);

    // Un-preparing one frees a slot back up.
    preparedToggles()[0].click();
    await fixture.whenStable();
    expect(state.draftSheet()!.spellcasting[0].prepared).toHaveLength(3);
  });

  it('"Continue" marks the spells step done even with nothing learned yet', async () => {
    const state = createWizardDraft();
    const fixture = TestBed.createComponent(SpellsStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(state.spellsAutoDone()).toBe(false);
    compiled.querySelector<HTMLButtonElement>('.spells-step__continue')!.click();
    await fixture.whenStable();

    expect(state.doneSteps().has('spells')).toBe(true);
  });
});
