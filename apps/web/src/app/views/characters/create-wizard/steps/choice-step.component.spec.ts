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
const ROGUE_EXPERTISE_CHOICE = 'srd-5e-2024:class/rogue@1/expertise';
const BARD_TOOLS_CHOICE = 'srd-5e-2024:class/bard@1/tools';

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

  // Plan 13 task 1 (ruling 4): a `requireProficient` expertise pick (Rogue's @1/expertise) offers
  // ONLY the skills the draft character is proficient in — the engine's `queryPickOptions`, read
  // against the wizard's draft sheet — never every skill entity.
  it('the rogue Expertise pick offers only the draft character’s proficient skills and records a pick', async () => {
    const state = createState();
    state.name.set('Vex');
    state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/rogue']);
    state.setDecision('srd-5e-2024:class/rogue@1/skills', [
      'stealth',
      'sleight-of-hand',
      'perception',
      'acrobatics',
    ]);

    const fixture = TestBed.createComponent(ChoiceStepComponent);
    fixture.componentRef.setInput('choiceId', ROGUE_EXPERTISE_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const names = Array.from(compiled.querySelectorAll('.entity-picker__name')).map((n) =>
      n.textContent?.trim(),
    );
    // 4 rogue class skills + Soldier's Athletics and Intimidation; no unproficient skill (Arcana).
    expect([...names].sort()).toEqual(
      [
        'Acrobatics',
        'Athletics',
        'Intimidation',
        'Perception',
        'Sleight of Hand',
        'Stealth',
      ].sort(),
    );

    const buttons = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.entity-picker__select'),
    );
    const byName = (text: string) =>
      buttons.find((b) => b.querySelector('.entity-picker__name')?.textContent?.trim() === text)!;
    byName('Stealth').click();
    await fixture.whenStable();
    byName('Sleight of Hand').click();
    await fixture.whenStable();

    expect(state.decisions().get(ROGUE_EXPERTISE_CHOICE)).toEqual([
      'srd-5e-2024:skill/stealth',
      'srd-5e-2024:skill/sleight-of-hand',
    ]);
    expect(compiled.querySelectorAll('.choice-step__diagnostic').length).toBe(0);
    expect(state.draftSheet()?.skills['stealth']?.proficiency).toBe('expertise');
  });

  // Plan 13 task 2 (ruling 5): the bard's @1/tools pick is a STATIC pick, so the step offers exactly
  // its listed tool items (the 10 Musical Instruments) via `hk-entity-picker`, and the recorded
  // selection lands as tool proficiencies on the draft sheet.
  it('the bard tool pick offers exactly the ten Musical Instruments and records three', async () => {
    const state = createState();
    state.name.set('Lia');
    state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/bard']);

    const fixture = TestBed.createComponent(ChoiceStepComponent);
    fixture.componentRef.setInput('choiceId', BARD_TOOLS_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const names = Array.from(compiled.querySelectorAll('.entity-picker__name')).map((n) =>
      n.textContent?.trim(),
    );
    expect([...names].sort()).toEqual(
      [
        'Bagpipes',
        'Drum',
        'Dulcimer',
        'Flute',
        'Horn',
        'Lute',
        'Lyre',
        'Pan Flute',
        'Shawm',
        'Viol',
      ]
        .map((s) => `Musical Instrument, ${s}`)
        .sort(),
    );

    const buttons = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.entity-picker__select'),
    );
    const byName = (text: string) =>
      buttons.find(
        (b) =>
          b.querySelector('.entity-picker__name')?.textContent?.trim() ===
          `Musical Instrument, ${text}`,
      )!;
    for (const name of ['Lute', 'Flute', 'Drum']) {
      byName(name).click();
      await fixture.whenStable();
    }

    expect(state.decisions().get(BARD_TOOLS_CHOICE)).toEqual([
      'srd-5e-2024:item/musical-instrument-lute',
      'srd-5e-2024:item/musical-instrument-flute',
      'srd-5e-2024:item/musical-instrument-drum',
    ]);
    expect(compiled.querySelectorAll('.choice-step__diagnostic').length).toBe(0);
    expect(
      state
        .draftSheet()
        ?.proficiencies.filter((p) => p.kind === 'tool')
        .map((p) => p.target),
    ).toEqual([
      'gaming-set',
      'musical-instrument-drum',
      'musical-instrument-flute',
      'musical-instrument-lute',
    ]);
  });

  // Plan 13 task 8 (ruling 10): an option the engine's own validation would refuse PER OPTION is
  // still LISTED but visibly gated — its select button disabled, a visible reason line wired to it
  // via `aria-describedby` — while the selection-time refusal stays the backstop. Level-ups are
  // drafted onto the wizard state (`extraDrafts`), so the real engine derives a real level-N sheet.
  describe('offer-time gating (plan 13 task 8)', () => {
    const FIGHTER = 'srd-5e-2024:class/fighter';
    const ROGUE = 'srd-5e-2024:class/rogue';
    const FIGHTER_FEAT_CHOICE = `${FIGHTER}@4/feat`;
    const ROGUE_EXPERTISE_6_CHOICE = `${ROGUE}@6/expertise`;
    const levelsUpTo = (classId: string, top: number) =>
      Array.from({ length: top - 1 }, (_, i) => ({
        type: 'level.gained',
        v: 1,
        payload: { classId, level: i + 2, hpRoll: 'average' },
      }));
    const selectButtons = (c: HTMLElement) =>
      Array.from(c.querySelectorAll<HTMLButtonElement>('.entity-picker__select'));
    const nameOf = (b: HTMLButtonElement) =>
      b.querySelector('.entity-picker__name')?.textContent?.trim() ?? '';
    const reasonOf = (c: HTMLElement, b: HTMLButtonElement): string | undefined => {
      const describedBy = b.getAttribute('aria-describedby');
      return describedBy
        ? c.querySelector(`[id="${describedBy}"]`)?.textContent?.trim()
        : undefined;
    };

    function seedLevel4Fighter(): CreateWizardState {
      const state = createState();
      state.name.set('Ivan');
      state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
      state.setDecision(
        `${SYSTEM_ID}@0/ability-scores`,
        ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
        { method: 'standardArray' },
      );
      state.setDecision(CLASS_CHOICE, [FIGHTER]);
      state.extraDrafts.set(levelsUpTo(FIGHTER, 4));
      return state;
    }

    it('a level-4 fighter sees every Epic Boon LISTED but disabled with a prerequisite reason; eligible feats stay selectable', async () => {
      const state = seedLevel4Fighter();
      expect(state.draftSheet()?.level).toBe(4);

      const fixture = TestBed.createComponent(ChoiceStepComponent);
      fixture.componentRef.setInput('choiceId', FIGHTER_FEAT_CHOICE);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const buttons = selectButtons(compiled);
      // All 17 SRD feats are offered (the pick is `query: {type: 'feat'}`) — none hidden.
      expect(buttons).toHaveLength(17);
      const boons = buttons.filter((b) => nameOf(b).startsWith('Boon of'));
      expect(boons.map(nameOf).sort()).toEqual(
        [
          'Boon of Combat Prowess',
          'Boon of Dimensional Travel',
          'Boon of Fate',
          'Boon of Irresistible Offense',
          'Boon of Spell Recall',
          'Boon of the Night Spirit',
          'Boon of Truesight',
        ].sort(),
      );
      for (const boon of boons) {
        expect(boon.disabled, nameOf(boon)).toBe(true);
        expect(reasonOf(compiled, boon), nameOf(boon)).toBe(
          charactersEn.wizard.picker.gate.prerequisiteFailed,
        );
      }
      // Level 4 / Str 17 satisfies ASI's and Grappler's own prerequisites: not gated.
      for (const eligible of buttons.filter((b) => !nameOf(b).startsWith('Boon of'))) {
        expect(eligible.disabled, nameOf(eligible)).toBe(false);
        expect(eligible.hasAttribute('aria-describedby'), nameOf(eligible)).toBe(false);
      }
      // Every reason id is unique in the document (one picker can't collide with itself).
      const ids = Array.from(compiled.querySelectorAll('[id]')).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);

      // A gated card can't be selected through the UI...
      boons[0].click();
      await fixture.whenStable();
      expect(state.decisions().get(FIGHTER_FEAT_CHOICE)).toBeUndefined();
      // ...an eligible one can.
      buttons.find((b) => nameOf(b) === 'Ability Score Improvement')!.click();
      await fixture.whenStable();
      expect(state.decisions().get(FIGHTER_FEAT_CHOICE)).toEqual([
        'srd-5e-2024:feat/ability-score-improvement',
      ]);
    });

    it('the engine still refuses a programmatic selection of a gated Epic Boon (backstop untouched)', async () => {
      const state = seedLevel4Fighter();
      const boon = 'srd-5e-2024:feat/boon-of-fate';
      expect(state.validate(FIGHTER_FEAT_CHOICE, [boon])).toContainEqual(
        expect.objectContaining({
          code: 'selection.prerequisiteFailed',
          severity: 'error',
          entityId: boon,
        }),
      );

      const fixture = TestBed.createComponent(ChoiceStepComponent);
      fixture.componentRef.setInput('choiceId', FIGHTER_FEAT_CHOICE);
      await fixture.whenStable();
      (fixture.componentInstance as unknown as { onToggle(id: string): void }).onToggle(boon);
      await fixture.whenStable();

      const diagnostics = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.choice-step__diagnostic'),
      ).map((d) => d.textContent?.trim());
      expect(diagnostics).toContain(charactersEn.validation.selection.prerequisiteFailed);
    });

    it('a same-family prior pick (rogue @1 expertise) is gated as already chosen in the rogue @6 expertise pick', async () => {
      const state = createState();
      state.name.set('Vex');
      state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
      state.setDecision(CLASS_CHOICE, [ROGUE]);
      state.setDecision(`${ROGUE}@1/skills`, [
        'stealth',
        'sleight-of-hand',
        'perception',
        'acrobatics',
      ]);
      state.setDecision(ROGUE_EXPERTISE_CHOICE, [
        'srd-5e-2024:skill/stealth',
        'srd-5e-2024:skill/sleight-of-hand',
      ]);
      state.extraDrafts.set(levelsUpTo(ROGUE, 6));

      const fixture = TestBed.createComponent(ChoiceStepComponent);
      fixture.componentRef.setInput('choiceId', ROGUE_EXPERTISE_6_CHOICE);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const buttons = selectButtons(compiled);
      const gated = buttons.filter((b) => b.disabled).map(nameOf);
      expect(gated.sort()).toEqual(['Sleight of Hand', 'Stealth']);
      for (const b of buttons.filter((x) => x.disabled)) {
        expect(reasonOf(compiled, b)).toBe(charactersEn.wizard.picker.gate.duplicate);
      }
      expect(buttons.find((b) => nameOf(b) === 'Perception')?.disabled).toBe(false);
    });
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

// Plan 14 task 2: a `queries` pick (the union of several entity queries — e.g. Skilled's "three
// skills or tools") renders through the same entity picker as a single `query` pick, one mixed
// list of the engine's offer set (`queryPickOptions`). Exercised over a clone of the real pack with
// a `queries` pick patched onto the (otherwise unrelated) Alert feat, as the engine tests do.
describe('ChoiceStepComponent — mixed-type queries pick', () => {
  const MIXED_CHOICE = 'srd-5e-2024:feat/alert@1/test-mixed';

  function mixedPack(): Pack {
    const pack = structuredClone(corePack);
    const feat = pack.entities.find((e) => e.id === 'srd-5e-2024:feat/alert') as unknown as {
      choices: unknown[];
    };
    feat.choices.push({
      id: MIXED_CHOICE,
      prompt: 'Pick',
      at: { kind: 'level', level: 1 },
      pick: { queries: [{ type: 'skill' }, { type: 'item', category: 'tool' }] },
      count: 3,
      unique: true,
      repeatableAt: [],
      prerequisites: [],
    });
    return pack;
  }

  beforeEach(() => {
    configure();
    const pack = mixedPack();
    TestBed.overrideProvider(PackStore, {
      useValue: { packs: signal([pack]), ready: signal(true), corePack: signal(pack) },
    });
  });

  it('lists every skill and every tool once in one picker and records a mixed selection', async () => {
    const state = createState();
    state.name.set('Aldric');

    const fixture = TestBed.createComponent(ChoiceStepComponent);
    fixture.componentRef.setInput('choiceId', MIXED_CHOICE);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const skillCount = corePack.entities.filter((e) => e.type === 'skill').length;
    const toolCount = corePack.entities.filter(
      (e) => e.type === 'item' && e.category === 'tool',
    ).length;
    const buttons = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.entity-picker__select'),
    );
    expect(buttons.length).toBe(skillCount + toolCount);

    const byName = (text: string) =>
      buttons.find((b) => b.querySelector('.entity-picker__name')?.textContent?.trim() === text)!;
    for (const name of ['Athletics', 'Perception', "Smith's Tools (20 GP)"]) {
      byName(name).click();
      await fixture.whenStable();
    }

    expect(state.decisions().get(MIXED_CHOICE)).toEqual([
      'srd-5e-2024:skill/athletics',
      'srd-5e-2024:skill/perception',
      'srd-5e-2024:item/smiths-tools',
    ]);
  });
});
