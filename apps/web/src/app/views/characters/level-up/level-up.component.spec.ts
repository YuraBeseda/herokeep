import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { routes } from '../../../app.routes';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { seedFighter, seedWizard } from '../sheet/testing/character-fixtures';
import { CreateWizardState } from '../create-wizard/create-wizard.state';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling), same fixture-loading
// approach as `sheet-shell.component.spec.ts`.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

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

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    return of({});
  }
}

function configureReal(): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
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
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
    ],
  });
}

/** Task 12 (phase 4 plan 11): clicks the which-class picker's OWN "level up <class>" option for
 * an already-taken class — `seedFighter`'s own real-pack fixture is genuinely eligible to
 * multiclass into Barbarian/Rogue too (T7's real `system.multiclass.prerequisites` data, same note
 * `level-up.state.spec.ts` already carries), so the picker renders whenever `characterStore
 * .advancements()` reports more than one entry. A no-op (never queries the DOM at all) when the
 * picker isn't showing — every test that calls this stays correct regardless of whether THIS
 * particular fixture happens to be multiclass-eligible at the moment it's called. */
async function chooseClassIfOffered(
  root: HTMLElement,
  fixture: { whenStable(): Promise<unknown> },
  label: string,
): Promise<void> {
  if (root.querySelector('.level-up__class-picker') === null) return;
  const button = Array.from(
    root.querySelectorAll<HTMLButtonElement>('.level-up__class-picker-option'),
  ).find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`no class-picker option matching "${label}"`);
  button.click();
  await fixture.whenStable();
}

/** Lets `CharacterStore.appendTx`'s real (unmocked) fake-indexeddb promise chain settle before
 * asserting — mirrors `build-tab.component.spec.ts`'s own `pollUntil`. */
async function pollUntil(
  fixture: { whenStable(): Promise<unknown> },
  predicate: () => boolean,
  maxIterations = 50,
): Promise<void> {
  for (let i = 0; i < maxIterations && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
  expect(predicate()).toBe(true);
}

describe('LevelUpComponent', () => {
  beforeEach(async () => {
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('the guard redirects to the play tab (with a toast) when no level-up is available', async () => {
    const id = await seedFighter('Ivan');

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;

    expect(root.querySelector('.play-tab')).not.toBeNull();
    expect(root.querySelector('.level-up')).toBeNull();
  });

  it('fighter 1→2: taking the average HP through to Finish commits level.gained and returns to the play tab', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    // Phase 4 plan 11 task 7: the real SRD pack's `system.multiclass.prerequisites` now makes this
    // fixture character genuinely eligible to multiclass into Barbarian/Rogue too (str 17 / dex 13
    // after the soldier background bonus) — real 5e eligibility, not a bug. The level-up route still
    // opens on the character's OWN class (`isNewClass: false` sorts first — `derive/advancement.ts`),
    // which the rest of this test verifies via the HP-average button below.
    expect(
      characterStore.advancements().find((a) => a.classId === 'srd-5e-2024:class/fighter')?.toLevel,
    ).toBe(2);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;
    expect(root.querySelector('.level-up')).not.toBeNull();

    await chooseClassIfOffered(
      root,
      harness.fixture,
      charactersEn.levelUp.classPicker.levelUp
        .replace('{class}', 'Fighter')
        .replace('{level}', '2'),
    );

    const averageButton = root.querySelector<HTMLButtonElement>('.level-up__hp-average')!;
    expect(averageButton).not.toBeNull();
    averageButton.click();
    await harness.fixture.whenStable();

    // Fighter's level-2 row has no choices (packages/content dist pack) — the very next step is
    // 'review'.
    const nextButton = root.querySelector<HTMLButtonElement>('.level-up__next')!;
    expect(nextButton.disabled).toBe(false);
    nextButton.click();
    await harness.fixture.whenStable();

    const finishButton = root.querySelector<HTMLButtonElement>('.level-up__finish')!;
    expect(finishButton.disabled).toBe(false);
    finishButton.click();

    await pollUntil(harness.fixture, () => characterStore.sheet()?.level === 2);

    expect(characterStore.events().at(-1)?.type).toBe('level.gained');
    expect(characterStore.sheet()?.hp.max.value).toBe(20); // 12 + 6 (average d10) + 2 (con mod)
  });

  it('the HP step renders the rolled die (T7 kept-die styling) once "Roll" is clicked, and clears it on "Take average"', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;
    await chooseClassIfOffered(
      root,
      harness.fixture,
      charactersEn.levelUp.classPicker.levelUp
        .replace('{class}', 'Fighter')
        .replace('{level}', '2'),
    );
    expect(root.querySelector('.level-up__hp-dice')).toBeNull();

    root.querySelector<HTMLButtonElement>('.level-up__hp-roll')!.click();
    await harness.fixture.whenStable();

    const dice = root.querySelectorAll<HTMLElement>('.level-up__hp-die');
    expect(dice).toHaveLength(1);
    expect(dice[0].classList.contains('level-up__hp-die--dropped')).toBe(false);
    const shown = Number(dice[0].textContent?.trim());
    expect(shown).toBeGreaterThanOrEqual(1);
    expect(shown).toBeLessThanOrEqual(10); // fighter's hit die

    // The rendered die must equal what actually landed as the draft's hpRoll.
    const resultText = root.querySelector('.level-up__hp-result')?.textContent ?? '';
    expect(resultText).toContain(String(shown));

    root.querySelector<HTMLButtonElement>('.level-up__hp-average')!.click();
    await harness.fixture.whenStable();
    expect(root.querySelector('.level-up__hp-dice')).toBeNull();
  });

  // --- The which-class picker (phase 4, plan 11, task 12, ADR-007) -----------------------------

  it('renders the labeled which-class picker offering both the existing class and the eligible new classes, and a11y-checks it', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    // seedFighter's real-pack eligibility (str 17 / dex 13) genuinely qualifies for Barbarian
    // (str >= 13) and Rogue (dex >= 13) too — same T7 data every other test in this file notes.
    const classIds = new Set(characterStore.advancements().map((a) => a.classId));
    expect(classIds.size).toBeGreaterThan(1);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;

    const group = root.querySelector('[role="group"].level-up__class-picker-options')!;
    expect(group.getAttribute('aria-label')).toBe(charactersEn.levelUp.classPicker.label);
    expect(root.querySelector('.level-up__title')?.textContent?.trim()).toBe(
      charactersEn.levelUp.classPicker.title,
    );
    const options = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.level-up__class-picker-option'),
    );
    expect(options.length).toBe(classIds.size);
    // The character's OWN class reads as a plain level-up; every other option reads as multiclass.
    expect(
      options.some(
        (o) =>
          o.textContent?.trim() ===
          charactersEn.levelUp.classPicker.levelUp
            .replace('{class}', 'Fighter')
            .replace('{level}', '2'),
      ),
    ).toBe(true);
    expect(
      options.filter((o) =>
        o.textContent?.trim().startsWith(charactersEn.levelUp.classPicker.multiclass.split(' ')[0]),
      ).length,
    ).toBeGreaterThan(0);
    // No wizard content renders until a class is actually chosen.
    expect(root.querySelector('.level-up__hp-roll')).toBeNull();
  });

  it('picking the isNewClass ("Multiclass into Barbarian") option levels the character INTO that brand-new class at level 1', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    const barbarian = characterStore
      .advancements()
      .find((a) => a.classId === 'srd-5e-2024:class/barbarian');
    expect(barbarian?.isNewClass).toBe(true);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;

    await chooseClassIfOffered(
      root,
      harness.fixture,
      charactersEn.levelUp.classPicker.multiclass.replace('{class}', 'Barbarian'),
    );

    // A brand-new class's level 1 never rolls hit dice (`hpChoice: false`, task-2-report.md) — the
    // wizard skips straight past the HP step; whatever level-1 choices Barbarian asks for (or
    // 'review' if none) render next, never the fighter's own level-2 flow.
    expect(root.querySelector('.level-up__hp-roll')).toBeNull();
    expect(root.querySelector('.level-up')).not.toBeNull();

    // Fix round 1 (reviewer HIGH finding): `reHomeActiveStep`'s old "vanished, not found ->
    // land on the LAST step" fallback wrongly fired here too, since `previousSteps` was still
    // `[]` (the picker's own gate) on the very first effect run after a class is picked — this
    // landed the wizard on REVIEW with Barbarian's real level-1 choices (skills, then weapon
    // masteries — verified against the built pack) skipped entirely, `Finish` disabled, no
    // explanation. The fix lands on the FIRST step of a genuinely fresh (grown-from-empty) list
    // instead. This assertion is the reviewer's own exact repro: the first outstanding CHOICE
    // step is active, not Review.
    expect(root.querySelector('.level-up__review')).toBeNull();
    const skillsChips = Array.from(root.querySelectorAll('hk-chip'));
    expect(skillsChips.length).toBeGreaterThan(0); // the skills choice step is showing

    // Drive the flow THROUGH both of Barbarian's real level-1 choices (no conditional guard
    // around the load-bearing assertions below — fix round 1, MEDIUM finding: the previous
    // version's `if (finishButton && !finishButton.disabled)` silently skipped its own commit
    // assertion whenever the choices weren't actually resolved).
    const findChip = (text: string): HTMLElement =>
      skillsChips.find((c) => c.textContent?.trim() === text) as HTMLElement;
    findChip('Nature').click();
    await harness.fixture.whenStable();
    findChip('Survival').click();
    await harness.fixture.whenStable();

    const masteryButtons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.entity-picker__select'),
    );
    expect(masteryButtons.length).toBeGreaterThan(1); // the weapon-masteries choice step now shows
    masteryButtons[0].click();
    await harness.fixture.whenStable();
    masteryButtons[1].click();
    await harness.fixture.whenStable();

    const finishButton = root.querySelector<HTMLButtonElement>('.level-up__finish')!;
    expect(finishButton).not.toBeNull();
    expect(finishButton.disabled).toBe(false); // genuinely enabled, not skipped
    finishButton.click();

    // `seedFighter` itself already committed a `level.gained{classId: fighter}` at creation —
    // a bare `.some(type === 'level.gained')` predicate would match THAT pre-existing event
    // immediately and return before this Finish click's own (async) commit ever lands, so this
    // polls for the BARBARIAN-specific event.
    await pollUntil(harness.fixture, () =>
      characterStore
        .events()
        .some(
          (e) =>
            e.type === 'level.gained' &&
            (e.payload as { classId?: string }).classId === 'srd-5e-2024:class/barbarian',
        ),
    );

    const levelGained = characterStore
      .events()
      .find(
        (e) =>
          e.type === 'level.gained' &&
          (e.payload as { classId?: string }).classId === 'srd-5e-2024:class/barbarian',
      );
    expect(levelGained?.payload).toEqual({ classId: 'srd-5e-2024:class/barbarian', level: 1 });
    expect(characterStore.sheet()?.classes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classId: 'srd-5e-2024:class/barbarian', level: 1 }),
      ]),
    );
  });

  it('the barred case: a character whose OWN multiclass prerequisite fails is never offered a picker at all — the wizard opens directly on its own class', async () => {
    // `seedWizard`'s own fixture (int 10) fails Wizard's OWN prerequisite (int >= 13) — ruling 7's
    // "every already-taken class must still meet its own prerequisite, or NO new-class entries are
    // offered at all" (task-2-report.md) — so `advancements()` stays single-entry and no picker
    // ever renders, exactly the pre-existing single-class contract.
    const id = await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    expect(characterStore.advancements().length).toBe(1);
    expect(characterStore.advancements()[0]?.isNewClass).toBe(false);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;

    expect(root.querySelector('.level-up__class-picker')).toBeNull();
    expect(root.querySelector('.level-up__hp-average')).not.toBeNull();
  });

  // Plan 12 task 14: a slice-2 half-caster driven through the GENERIC level-up wizard (no bespoke
  // UI): Paladin 2 -> 3 offers exactly one subclass (Oath of Devotion), grows the 1st-level slot
  // row, and only the picked oath contributes its always-prepared spells.
  it('paladin 2→3: the subclass step offers exactly Oath of Devotion; slots grow 2→3 and oath spells appear only once picked', async () => {
    const PALADIN = 'srd-5e-2024:class/paladin';
    const SYSTEM_ID = 'srd-5e-2024:system/5e-2024';
    const state = TestBed.runInInjectionContext(() => new CreateWizardState());
    state.name.set('Aldis');
    state.gender.set('masculine');
    state.setDecision(`${SYSTEM_ID}@0/species`, ['srd-5e-2024:species/human']);
    state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision(
      `${SYSTEM_ID}@0/ability-scores`,
      ['str:15', 'dex:8', 'con:13', 'int:10', 'wis:12', 'cha:14'],
      { method: 'standardArray' },
    );
    state.setDecision(`${SYSTEM_ID}@0/class`, [PALADIN]);
    state.setDecision(`${PALADIN}@1/skills`, ['athletics', 'persuasion']);
    state.setDecision(`${PALADIN}@1/weapon-masteries`, [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
    ]);
    const characterStore = TestBed.inject(CharacterStore);
    const id = await characterStore.create(state.name().trim(), state.gender());
    const [, ...rest] = state.buildTransaction();
    await characterStore.appendTx(rest);

    const oathSpells = [
      'srd-5e-2024:spell/protection-from-evil-and-good',
      'srd-5e-2024:spell/shield-of-faith',
    ];
    const slotTotal = () =>
      characterStore.sheet()!.spellcasting.find((b) => b.classId === PALADIN)!.slots[0]?.max;
    expect(slotTotal()).toBe(2); // paladin 1: two 1st-level slots (class row `paladin-slots-1st`)

    await characterStore.appendTx([
      { type: 'level.gained', v: 1, payload: { classId: PALADIN, level: 2, hpRoll: 'average' } },
      {
        type: 'decision.made',
        v: 1,
        payload: {
          choiceId: `${PALADIN}@2/fighting-style`,
          selection: ['srd-5e-2024:feat/defense'],
        },
      },
      { type: 'xp.awarded', v: 1, payload: { amount: 900 } },
    ]);
    const alwaysAt2 = characterStore
      .sheet()!
      .spellcasting.find((b) => b.classId === PALADIN)!.alwaysPrepared;
    expect(alwaysAt2 ?? []).not.toEqual(expect.arrayContaining(oathSpells));
    expect(slotTotal()).toBe(2);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;
    await chooseClassIfOffered(
      root,
      harness.fixture,
      charactersEn.levelUp.classPicker.levelUp
        .replace('{class}', 'Paladin')
        .replace('{level}', '3'),
    );

    root.querySelector<HTMLButtonElement>('.level-up__hp-average')!.click();
    await harness.fixture.whenStable();

    root.querySelector<HTMLButtonElement>('.level-up__next')!.click();
    await harness.fixture.whenStable();

    // The subclass step: exactly one option, and it is Oath of Devotion.
    const options = Array.from(root.querySelectorAll<HTMLButtonElement>('.entity-picker__select'));
    expect(options).toHaveLength(1);
    expect(root.textContent).toContain('Oath of Devotion');
    options[0].click();
    await harness.fixture.whenStable();
    expect(root.textContent).not.toContain('Missing translation');
    expect(root.textContent).not.toMatch(/characters\.[a-z]+\.[A-Za-z.]+/);

    // Advance through whatever steps remain (spells/review) to Finish.
    for (let i = 0; i < 6 && root.querySelector('.level-up__finish') === null; i++) {
      const next = root.querySelector<HTMLButtonElement>('.level-up__next');
      if (!next || next.disabled) break;
      next.click();
      await harness.fixture.whenStable();
    }
    const finish = root.querySelector<HTMLButtonElement>('.level-up__finish')!;
    expect(finish.disabled).toBe(false);
    finish.click();
    await pollUntil(harness.fixture, () => characterStore.sheet()?.level === 3);

    expect(characterStore.sheet()!.classes[0]).toMatchObject({
      classId: PALADIN,
      level: 3,
      subclassId: 'srd-5e-2024:subclass/oath-of-devotion',
    });
    expect(slotTotal()).toBe(3); // `paladin-slots-1st` extra at level 3
    const block = characterStore.sheet()!.spellcasting.find((b) => b.classId === PALADIN)!;
    expect(block.alwaysPrepared ?? []).toEqual(expect.arrayContaining(oathSpells));
  });

  it("the spells step recommends 2 spells (not the creation wizard's 6)", async () => {
    const id = await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([
      {
        type: 'decision.made',
        v: 1,
        payload: {
          choiceId: 'srd-5e-2024:class/wizard@1/skills',
          selection: ['arcana', 'investigation'],
        },
      },
    ]);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;

    root.querySelector<HTMLButtonElement>('.level-up__hp-average')!.click();
    await harness.fixture.whenStable();
    root.querySelector<HTMLButtonElement>('.level-up__next')!.click();
    await harness.fixture.whenStable();

    const helper = root.querySelector('.spells-step__spellbook .spells-step__helper');
    expect(helper?.textContent).toContain('2');
    expect(helper?.textContent).not.toContain('6');
  });
});
