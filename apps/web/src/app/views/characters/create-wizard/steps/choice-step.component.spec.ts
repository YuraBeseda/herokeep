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

  // Task 8 (phase 4 plan 11): weapon-masteries' pick swapped from `literal: 'text'` to a real
  // `query` over item entities with a `weapon.mastery` field (T6 carry closed) — it was the only
  // literal-pick choice in the real SRD pack, and after this swap the pack has ZERO literal picks
  // left (verified: `pick.literal` no longer occurs anywhere in the built pack). The
  // `.choice-step__literal-input`/`.choice-step__literal-form` rendering path itself is untouched
  // production code, just no longer exercised by an integration test against the real pack — a
  // residual coverage gap flagged in task-8-report.md for controller triage (closing it cleanly
  // needs a small hand-built synthetic pack, out of this content-only task's scope). Fix round 1:
  // count is 3 (the real SRD value, not the original round's scope-limited 1) — `onToggle`'s
  // `count !== 1` branch (choice-step.component.ts, pre-existing code) already does generic
  // toggle/append multi-select, the exact same path the `skills` choice above exercises at
  // count:2, so this mirrors that test's "select up to count, diagnostic beyond it" shape instead
  // of the single-select species/count:1 shape.
  it('a query-pick choice (weapon masteries) renders item cards, enforces count 3, and shows the diagnostic on a 4th pick', async () => {
    const state = createState();
    state.name.set('Aldric');
    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);

    const fixture = TestBed.createComponent(ChoiceStepComponent);
    fixture.componentRef.setInput('choiceId', WEAPON_MASTERIES_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.entity-picker__select'),
    );
    expect(buttons.length).toBeGreaterThan(3);

    buttons[0].click();
    await fixture.whenStable();
    buttons[1].click();
    await fixture.whenStable();
    buttons[2].click();
    await fixture.whenStable();

    const afterThree = state.decisions().get(WEAPON_MASTERIES_CHOICE);
    expect(afterThree?.length).toBe(3);
    for (const id of afterThree ?? []) expect(id).toMatch(/^srd-5e-2024:item\//);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
    expect(compiled.querySelectorAll('.choice-step__diagnostic').length).toBe(0);

    buttons[3].click();
    await fixture.whenStable();

    const decided = state.decisions().get(WEAPON_MASTERIES_CHOICE);
    expect(decided?.length).toBe(4);
    expect(compiled.querySelectorAll('.choice-step__diagnostic').length).toBeGreaterThan(0);
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

  // --- Campaign edit lock fix round 1 (plan-10 task-14-brief.md, ruling 7) --------------------
  //
  // The reviewer's own finding: a wrapping `<fieldset disabled>` (`build-tab.component.html`) is
  // COSMETIC ONLY for this branch in a real browser — `hk-chip` is a custom element, not a
  // "listed" form-associated one, so fieldset-disabled never reaches its host `(click)` binding.
  // `ChoiceStepComponent`'s own `disabled` input (gating `onToggle` directly) is the real fix;
  // these specs assert the STORE side effect is untouched on click, never the fieldset property.
  describe('disabled input (fix round 1 — the chip click-through gate)', () => {
    it('does NOT commit a skills-chip click while disabled=true, and marks the chip aria-disabled', async () => {
      const state = createState();
      state.name.set('Aldric');
      state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);

      const fixture = TestBed.createComponent(ChoiceStepComponent);
      fixture.componentRef.setInput('choiceId', CLASS_SKILLS_CHOICE);
      fixture.componentRef.setInput('disabled', true);
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const athletics = Array.from(compiled.querySelectorAll('hk-chip')).find(
        (c) => c.textContent?.trim() === 'Athletics',
      ) as HTMLElement;
      expect(athletics.getAttribute('aria-disabled')).toBe('true');

      athletics.click();
      await fixture.whenStable();

      expect(state.decisions().get(CLASS_SKILLS_CHOICE)).toBeUndefined();
    });

    it('still commits skills-chip clicks when disabled is explicitly false (regression net — the create wizard and an unlocked build tab)', async () => {
      const state = createState();
      state.name.set('Aldric');
      state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);

      const fixture = TestBed.createComponent(ChoiceStepComponent);
      fixture.componentRef.setInput('choiceId', CLASS_SKILLS_CHOICE);
      fixture.componentRef.setInput('disabled', false);
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const athletics = Array.from(compiled.querySelectorAll('hk-chip')).find(
        (c) => c.textContent?.trim() === 'Athletics',
      ) as HTMLElement;
      expect(athletics.getAttribute('aria-disabled')).toBeNull();

      athletics.click();
      await fixture.whenStable();

      expect(state.decisions().get(CLASS_SKILLS_CHOICE)).toEqual(['athletics']);
    });

    it('defaults to enabled when the input is never set at all (every pre-existing consumer, incl. the create wizard)', async () => {
      const state = createState();
      state.name.set('Aldric');
      state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);

      const fixture = TestBed.createComponent(ChoiceStepComponent);
      fixture.componentRef.setInput('choiceId', CLASS_SKILLS_CHOICE);
      await fixture.whenStable(); // `disabled` never set

      const compiled = fixture.nativeElement as HTMLElement;
      const athletics = Array.from(compiled.querySelectorAll('hk-chip')).find(
        (c) => c.textContent?.trim() === 'Athletics',
      ) as HTMLElement;
      athletics.click();
      await fixture.whenStable();

      expect(state.decisions().get(CLASS_SKILLS_CHOICE)).toEqual(['athletics']);
    });

    it('forwards disabled=true to hk-abilities-improve-step for the "abilities" pick', async () => {
      const state = createState();
      state.name.set('Aldric');

      const fixture = TestBed.createComponent(ChoiceStepComponent);
      fixture.componentRef.setInput('choiceId', 'srd-5e-2024:background/soldier@0/ability-scores');
      fixture.componentRef.setInput('disabled', true);
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const strength = Array.from(compiled.querySelectorAll('hk-chip')).find(
        (c) => c.textContent?.trim() === 'Strength',
      ) as HTMLElement;
      expect(strength.getAttribute('aria-disabled')).toBe('true');

      strength.click();
      await fixture.whenStable();

      expect(
        state.decisions().get('srd-5e-2024:background/soldier@0/ability-scores'),
      ).toBeUndefined();
    });
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
