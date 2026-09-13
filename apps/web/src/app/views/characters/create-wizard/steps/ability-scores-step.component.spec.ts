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
import { AbilityScoresStepComponent } from './ability-scores-step.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack over a minimal fixture" ruling) —
// same approach as `choice-step.component.spec.ts`.
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
const ABILITY_SCORES_CHOICE = `${SYSTEM_ID}@0/ability-scores`;

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

function createState(): CreateWizardState {
  return TestBed.inject(CreateWizardState);
}

// Abilities in the SRD system's own declared order: str, dex, con, int, wis, cha.
const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function selectsInAbilityOrder(compiled: HTMLElement): HTMLSelectElement[] {
  return Array.from(compiled.querySelectorAll<HTMLSelectElement>('.ability-scores-step__select'));
}

function pickOptionByText(select: HTMLSelectElement, text: string): void {
  const option = Array.from(select.options).find((o) => o.textContent?.trim() === text);
  if (!option) throw new Error(`No option with text "${text}" in select`);
  select.value = option.value;
  select.dispatchEvent(new Event('change'));
}

function findTabButton(compiled: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(compiled.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`No tab button labeled "${label}"`);
  return button;
}

describe('AbilityScoresStepComponent', () => {
  beforeEach(() => configure());

  it("defaults to the standard-array method and enforces the multiset: assigning 15 to one ability removes it from every other ability's options", async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(AbilityScoresStepComponent);
    fixture.componentRef.setInput('choiceId', ABILITY_SCORES_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const selects = selectsInAbilityOrder(compiled);
    expect(selects).toHaveLength(6);

    pickOptionByText(selects[0], '15');
    await fixture.whenStable();

    expect(state.decisions().get(ABILITY_SCORES_CHOICE)).toEqual(['str:15']);

    // The array has exactly one 15 — no other ability's select may still offer it.
    const dexSelect = selectsInAbilityOrder(compiled)[1];
    const dexOptionTexts = Array.from(dexSelect.options).map((o) => o.textContent?.trim());
    expect(dexOptionTexts).not.toContain('15');

    // Assigning the rest completes a full, valid standard-array selection.
    const rest: [number, string][] = [
      [1, '14'],
      [2, '13'],
      [3, '12'],
      [4, '10'],
      [5, '8'],
    ];
    for (const [index, value] of rest) {
      pickOptionByText(selectsInAbilityOrder(compiled)[index], value);
      await fixture.whenStable();
    }

    expect(state.decisions().get(ABILITY_SCORES_CHOICE)).toEqual([
      'str:15',
      'dex:14',
      'con:13',
      'int:12',
      'wis:10',
      'cha:8',
    ]);
    expect(compiled.querySelectorAll('.ability-scores-step__diagnostic')).toHaveLength(0);
  });

  it('point buy: meter math against the costs table shows over-budget and the engine diagnostic for 15,15,15,15,15,8', async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(AbilityScoresStepComponent);
    fixture.componentRef.setInput('choiceId', ABILITY_SCORES_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    findTabButton(compiled, 'Point buy').click();
    await fixture.whenStable();

    const inputs = Array.from(compiled.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(inputs).toHaveLength(6);

    const values = ['15', '15', '15', '15', '15', '8'];
    for (const [index, value] of values.entries()) {
      inputs[index].value = value;
      inputs[index].dispatchEvent(new Event('input'));
      await fixture.whenStable();
    }

    // costs: 15 -> 9, 8 -> 0; 5*9 + 0 = 45, way over the pack's 27-point budget.
    const meter = compiled.querySelector('.ability-scores-step__meter');
    expect(meter?.textContent).toContain('45');
    expect(meter?.textContent).toContain('27');
    expect(meter?.classList.contains('ability-scores-step__meter--over')).toBe(true);

    const diagnosticTexts = Array.from(
      compiled.querySelectorAll('.ability-scores-step__diagnostic'),
    ).map((el) => el.textContent?.trim());
    expect(diagnosticTexts).toContain(charactersEn.validation.selection.pointBuyBudget);

    expect(state.decisions().get(ABILITY_SCORES_CHOICE)).toEqual([
      'str:15',
      'dex:15',
      'con:15',
      'int:15',
      'wis:15',
      'cha:8',
    ]);
    expect(state.decisionContexts().get(ABILITY_SCORES_CHOICE)?.['method']).toBe('pointBuy');
  });

  it("manual entry commits only the abilities actually entered, and validates against the pack's manual range", async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(AbilityScoresStepComponent);
    fixture.componentRef.setInput('choiceId', ABILITY_SCORES_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    findTabButton(compiled, 'Manual').click();
    await fixture.whenStable();

    const inputs = Array.from(compiled.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(inputs).toHaveLength(6);
    expect(inputs[0].min).toBe('3');
    expect(inputs[0].max).toBe('18');

    inputs[0].value = '16';
    inputs[0].dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(state.decisions().get(ABILITY_SCORES_CHOICE)).toEqual(['str:16']);
    expect(state.decisionContexts().get(ABILITY_SCORES_CHOICE)?.['method']).toBe('manual');
  });

  it('roll: rolling all six produces six 4d6kh3 results whose context lands in the decision, scores match the kept sums, and re-roll is no longer offered', async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(AbilityScoresStepComponent);
    fixture.componentRef.setInput('choiceId', ABILITY_SCORES_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    findTabButton(compiled, 'Roll').click();
    await fixture.whenStable();

    const rollButton = compiled.querySelector<HTMLButtonElement>('.ability-scores-step__roll-all')!;
    expect(rollButton.disabled).toBe(false);
    rollButton.click();
    await fixture.whenStable();

    const context = state.decisionContexts().get(ABILITY_SCORES_CHOICE);
    expect(context?.['method']).toBe('roll');

    const rolls = context?.['rolls'] as {
      dice: { sides: number; value: number; kept: boolean }[];
      total: number;
    }[];
    expect(rolls).toHaveLength(6);
    for (const r of rolls) {
      expect(r.dice).toHaveLength(4);
      expect(r.dice.filter((d) => d.kept)).toHaveLength(3);
      const keptSum = r.dice.filter((d) => d.kept).reduce((s, d) => s + d.value, 0);
      expect(r.total).toBe(keptSum);
    }

    const scores = context?.['scores'] as Record<string, number>;
    ABILITY_ORDER.forEach((ability, i) => {
      expect(scores[ability]).toBe(rolls[i].total);
    });

    const selection = state.decisions().get(ABILITY_SCORES_CHOICE);
    expect(selection).toEqual(ABILITY_ORDER.map((a, i) => `${a}:${rolls[i].total}`));

    // Re-roll not offered once rolled (rolls are recorded — honesty by design).
    expect(rollButton.disabled).toBe(true);
  });
});
