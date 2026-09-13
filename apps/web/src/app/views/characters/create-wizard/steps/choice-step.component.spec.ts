import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { CreateWizardState } from '../create-wizard.state';
import { ChoiceStepComponent } from './choice-step.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack over a minimal fixture" ruling) —
// `pretest` (apps/web/package.json) builds it before this file ever runs. Same approach as
// create-wizard.state.spec.ts.
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
const CLASS_CHOICE = `${SYSTEM_ID}@0/class`;
const CLASS_SKILLS_CHOICE = 'srd-5e-2024:class/fighter@1/skills';
const WEAPON_MASTERIES_CHOICE = 'srd-5e-2024:class/fighter@1/weapon-masteries';

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
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      CreateWizardState,
    ],
  });
}

function createState(): CreateWizardState {
  return TestBed.inject(CreateWizardState);
}

describe('ChoiceStepComponent', () => {
  beforeEach(() => configure());

  it('a query-pick choice (species) renders at least 4 cards; selecting one records the decision', async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(ChoiceStepComponent);
    fixture.componentRef.setInput('choiceId', SPECIES_CHOICE);
    await fixture.whenStable();

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '.entity-picker__select',
    );
    expect(buttons.length).toBeGreaterThanOrEqual(4);

    buttons[0].click();
    await fixture.whenStable();

    const decided = state.decisions().get(SPECIES_CHOICE);
    expect(decided?.length).toBe(1);
    expect(decided?.[0]).toMatch(/^srd-5e-2024:species\//);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('a count=1 query pick REPLACES the selection when a second card is tapped, rather than adding to it', async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(ChoiceStepComponent);
    fixture.componentRef.setInput('choiceId', SPECIES_CHOICE);
    await fixture.whenStable();

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.entity-picker__select',
      ),
    );
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    buttons[0].click();
    await fixture.whenStable();
    const firstPick = state.decisions().get(SPECIES_CHOICE)?.[0];

    buttons[1].click();
    await fixture.whenStable();

    const secondPick = state.decisions().get(SPECIES_CHOICE);
    expect(secondPick).toHaveLength(1);
    expect(secondPick?.[0]).not.toBe(firstPick);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('a literal-pick choice (weapon masteries) renders typed values as chips and records the decision', async () => {
    const state = createState();
    state.name.set('Aldric');
    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);

    const fixture = TestBed.createComponent(ChoiceStepComponent);
    fixture.componentRef.setInput('choiceId', WEAPON_MASTERIES_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('.choice-step__literal-input');
    const form = compiled.querySelector<HTMLFormElement>('.choice-step__literal-form');
    expect(input).toBeTruthy();
    expect(form).toBeTruthy();

    input!.value = 'longsword';
    input!.dispatchEvent(new Event('input'));
    form!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const chips = Array.from(compiled.querySelectorAll('hk-chip'));
    expect(chips.some((c) => c.textContent?.trim() === 'longsword')).toBe(true);
    expect(state.decisions().get(WEAPON_MASTERIES_CHOICE)).toEqual(['longsword']);
  });

  it('the synthetic class-skills pick renders chips from the fighter skillChoice, enforces count 2, and shows the diagnostic on a 3rd pick', async () => {
    const state = createState();
    state.name.set('Aldric');
    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);

    const fixture = TestBed.createComponent(ChoiceStepComponent);
    fixture.componentRef.setInput('choiceId', CLASS_SKILLS_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const chips = Array.from(compiled.querySelectorAll('hk-chip'));
    // The fighter's skillChoice.from offers exactly 9 skills.
    expect(chips.length).toBe(9);
    const findChip = (text: string): HTMLElement =>
      chips.find((c) => c.textContent?.trim() === text) as HTMLElement;

    findChip('Athletics').click();
    await fixture.whenStable();
    findChip('Perception').click();
    await fixture.whenStable();

    expect(state.decisions().get(CLASS_SKILLS_CHOICE)).toEqual(['athletics', 'perception']);
    expect(compiled.querySelectorAll('.choice-step__diagnostic').length).toBe(0);

    findChip('Insight').click();
    await fixture.whenStable();

    expect(state.decisions().get(CLASS_SKILLS_CHOICE)).toEqual([
      'athletics',
      'perception',
      'insight',
    ]);
    expect(compiled.querySelectorAll('.choice-step__diagnostic').length).toBeGreaterThan(0);
  });

  it("routes the system's 'abilityGeneration' pick to hk-ability-scores-step and a background's 'abilities' pick to hk-abilities-improve-step (task-7)", async () => {
    const state = createState();
    state.name.set('Aldric');

    const abilityScoresFixture = TestBed.createComponent(ChoiceStepComponent);
    abilityScoresFixture.componentRef.setInput('choiceId', `${SYSTEM_ID}@0/ability-scores`);
    await abilityScoresFixture.whenStable();
    const abilityScoresCompiled = abilityScoresFixture.nativeElement as HTMLElement;
    expect(abilityScoresCompiled.querySelector('hk-ability-scores-step')).not.toBeNull();
    // The method tab bar (standard array/point buy/manual/roll) is this component's own content —
    // its presence confirms `hk-choice-step` actually delegated rendering, not just routed a case.
    expect(abilityScoresCompiled.querySelector('.ability-scores-step__tabs')).not.toBeNull();

    const improveFixture = TestBed.createComponent(ChoiceStepComponent);
    improveFixture.componentRef.setInput(
      'choiceId',
      'srd-5e-2024:background/soldier@0/ability-scores',
    );
    await improveFixture.whenStable();
    const improveCompiled = improveFixture.nativeElement as HTMLElement;
    expect(improveCompiled.querySelector('hk-abilities-improve-step')).not.toBeNull();
    expect(improveCompiled.querySelectorAll('hk-chip').length).toBeGreaterThan(0);
  });
});
