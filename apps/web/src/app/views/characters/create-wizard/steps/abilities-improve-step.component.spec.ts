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
import { AbilitiesImproveStepComponent } from './abilities-improve-step.component';

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

// Soldier's background ability-score bump: improve '+2/+1', restricted to str/dex/con.
const SOLDIER_ABILITIES_CHOICE = 'srd-5e-2024:background/soldier@0/ability-scores';
// The ASI general feat's own bump: improve '+2', unrestricted (feats carry no `abilityScores`
// allow-list).
const ASI_CHOICE = 'srd-5e-2024:feat/ability-score-improvement@4/ability-scores';

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

function findChip(compiled: HTMLElement, text: string): HTMLElement {
  const chip = Array.from(compiled.querySelectorAll('hk-chip')).find(
    (c) => c.textContent?.trim() === text,
  );
  if (!chip) throw new Error(`No chip labeled "${text}"`);
  return chip as HTMLElement;
}

describe('AbilitiesImproveStepComponent', () => {
  beforeEach(() => configure());

  it("restricts targets to the soldier background's own abilityScores allow-list (str/dex/con) and emits '+2/+1' picks in the grammar's own format", async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(AbilitiesImproveStepComponent);
    fixture.componentRef.setInput('choiceId', SOLDIER_ABILITIES_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const chipTexts = Array.from(compiled.querySelectorAll('hk-chip')).map((c) =>
      c.textContent?.trim(),
    );
    // Two slots ('+2' then '+1'), each offering only str/dex/con -> 6 chips total, never the other
    // three abilities.
    expect(chipTexts).toHaveLength(6);
    expect(new Set(chipTexts)).toEqual(new Set(['Strength', 'Dexterity', 'Constitution']));
    expect(chipTexts).not.toContain('Intelligence');
    expect(chipTexts).not.toContain('Wisdom');
    expect(chipTexts).not.toContain('Charisma');

    const slots = compiled.querySelectorAll('.abilities-improve-step__slot');
    expect(slots).toHaveLength(2);

    // Slot 0 is '+2' (the grammar's own order): pick Strength there.
    findChip(slots[0] as HTMLElement, 'Strength').click();
    await fixture.whenStable();

    // Slot 1 is '+1': pick Constitution there.
    findChip(slots[1] as HTMLElement, 'Constitution').click();
    await fixture.whenStable();

    expect(state.decisions().get(SOLDIER_ABILITIES_CHOICE)).toEqual(['str:+2', 'con:+1']);
    expect(compiled.querySelectorAll('.abilities-improve-step__diagnostic')).toHaveLength(0);
  });

  it("an ability already assigned to one slot disappears from the OTHER slot's options (distinctness)", async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(AbilitiesImproveStepComponent);
    fixture.componentRef.setInput('choiceId', SOLDIER_ABILITIES_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const slots = compiled.querySelectorAll('.abilities-improve-step__slot');
    findChip(slots[0] as HTMLElement, 'Strength').click();
    await fixture.whenStable();

    const slot1Texts = Array.from(
      (
        compiled.querySelectorAll('.abilities-improve-step__slot')[1] as HTMLElement
      ).querySelectorAll('hk-chip'),
    ).map((c) => c.textContent?.trim());
    expect(slot1Texts).not.toContain('Strength');
  });

  it('the ASI feat (no abilityScores allow-list) offers all six abilities for its single +2 pick', async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(AbilitiesImproveStepComponent);
    fixture.componentRef.setInput('choiceId', ASI_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const chipTexts = Array.from(compiled.querySelectorAll('hk-chip')).map((c) =>
      c.textContent?.trim(),
    );
    expect(chipTexts).toHaveLength(6);

    findChip(compiled, 'Charisma').click();
    await fixture.whenStable();

    expect(state.decisions().get(ASI_CHOICE)).toEqual(['cha:+2']);
  });
});
