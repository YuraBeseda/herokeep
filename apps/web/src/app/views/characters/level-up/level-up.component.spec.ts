import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
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
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { DialogService } from '../../../ui/dialog/dialog.service';
import { NavHistoryService } from '../../../ui/nav/nav-history.service';
import { TabBarService } from '../../../ui/tab-bar/tab-bar.service';
import { hintOf } from '../../../ui/testing/harness';
import { stubViewport } from '../../../ui/testing/viewport';
import shellEn from '../../../../assets/i18n/shell/en.json';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { seedFighter, seedWizard } from '../sheet/testing/character-fixtures';
import { CreateWizardState } from '../create-wizard/create-wizard.state';
import { LevelUpState } from './level-up.state';

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
    if (langPath === 'shell/en') return of(shellEn);
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
        useValue: {
          packs: signal([corePack]),
          // Plan 16 Task 5: the sheet shell's campaign packs banner brings in
          // `CampaignPacksService`, which reads the installed content packs.
          installedContent: signal([]),
          ready: signal(true),
          corePack: signal(corePack),
        },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
    ],
  });
}

/** Task 12 (phase 4 plan 11): chooses the which-class step's card for `className` — `seedFighter`'s
 * own real-pack fixture is genuinely eligible to multiclass into Barbarian/Rogue too (T7's real
 * `system.multiclass.prerequisites` data, same note `level-up.state.spec.ts` already carries), so
 * the step renders whenever `characterStore.advancements()` reports more than one entry. A no-op
 * (never queries a card at all) when the step isn't showing — every test that calls this stays
 * correct regardless of whether THIS particular fixture happens to be multiclass-eligible. */
async function chooseClassIfOffered(
  root: HTMLElement,
  fixture: { whenStable(): Promise<unknown> },
  className: string,
): Promise<void> {
  if (root.querySelector('.level-up__class-picker') === null) return;
  await pickClass(root, fixture, className);
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

/** The name of the card or row a choose / toggle button belongs to. */
function pickName(button: Element): string | undefined {
  return button
    .closest('hk-picker-card, .entity-picker__row')
    ?.querySelector('.hk-picker-card__name, .entity-picker__name')
    ?.textContent?.trim();
}

/** A strap action the level-up (or the sheet) has set; the strap itself is rendered by the app shell. */
function strapAction(id: string) {
  const config = TestBed.inject(ActionStrapService).config();
  return [...(config?.exit ?? []), ...(config?.primary ?? []), ...(config?.secondary ?? [])].find(
    (a) => a.id === id,
  );
}

async function pressStrap(fixture: { whenStable(): Promise<unknown> }, id: string): Promise<void> {
  const action = strapAction(id);
  expect(action, `strap action ${id}`).toBeDefined();
  action!.run();
  await fixture.whenStable();
}

/** Presses the strap's Next until it reads "Finish level up", then presses that. */
async function finishLevelUp(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  for (let i = 0; i < 8 && strapAction('next')?.label !== 'shell.strap.finish-level-up'; i++) {
    const next = strapAction('next');
    if (!next || next.disabled) break;
    next.run();
    await fixture.whenStable();
  }
  const finish = strapAction('next');
  expect(finish?.label).toBe('shell.strap.finish-level-up');
  expect(finish?.disabled).toBeFalsy();
  finish!.run();
}

/** Chooses the class card named `name` on the which-class step. */
async function pickClass(
  root: HTMLElement,
  fixture: { whenStable(): Promise<unknown> },
  name: string,
): Promise<void> {
  const choose = Array.from(
    root.querySelectorAll<HTMLButtonElement>('.level-up__class-picker .hk-picker-card__choose'),
  ).find((b) => pickName(b) === name);
  expect(choose, `class card ${name}`).toBeDefined();
  choose!.click();
  await fixture.whenStable();
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
    vi.unstubAllGlobals();
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

    await chooseClassIfOffered(root, harness.fixture, 'Fighter');

    const averageButton = root.querySelector<HTMLButtonElement>('.level-up__hp-average')!;
    expect(averageButton).not.toBeNull();
    averageButton.click();
    await harness.fixture.whenStable();

    // Fighter's level-2 row has no choices (packages/content dist pack) — the very next step is
    // 'review'.
    expect(strapAction('next')?.disabled).toBeFalsy();
    await pressStrap(harness.fixture, 'next');
    expect(root.querySelector('.level-up__review')).not.toBeNull();

    // The Next slot now reads "Finish level up" and commits.
    expect(strapAction('next')?.label).toBe('shell.strap.finish-level-up');
    expect(strapAction('next')?.disabled).toBeFalsy();
    strapAction('next')!.run();

    await pollUntil(harness.fixture, () => characterStore.sheet()?.level === 2);

    expect(characterStore.events().at(-1)?.type).toBe('level.gained');
    expect(characterStore.sheet()?.hp.max.value).toBe(20); // 12 + 6 (average d10) + 2 (con mod)
  });

  it('the HP step renders the rolled die (T7 kept-die styling) once "Roll" is clicked, and closes both choices', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;
    await chooseClassIfOffered(root, harness.fixture, 'Fighter');
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

    // One roll per level: both choices are now closed, the die stays shown.
    const rollBtn = root.querySelector<HTMLButtonElement>('.level-up__hp-roll')!;
    const avgBtn = root.querySelector<HTMLButtonElement>('.level-up__hp-average')!;
    expect(rollBtn.getAttribute('aria-disabled')).toBe('true');
    expect(avgBtn.getAttribute('aria-disabled')).toBe('true');
    expect(root.textContent).toContain(charactersEn.levelUp.hp.rolledOnce);
    avgBtn.click();
    await harness.fixture.whenStable();
    expect(root.querySelectorAll('.level-up__hp-die')).toHaveLength(1);
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

    const group = root.querySelector('[role="group"].level-up__class-own')!;
    expect(group.getAttribute('aria-label')).toBe(charactersEn.levelUp.classPicker.label);
    expect(root.querySelector('.level-up__title')?.textContent?.trim()).toBe(
      charactersEn.levelUp.classPicker.title,
    );
    const names = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.level-up__class-picker .hk-picker-card__choose'),
    ).map((b) => pickName(b));
    // Eligible classes, then the ones whose prerequisite is unmet (listed gated).
    expect(names.length).toBeGreaterThan(classIds.size);
    expect(
      root.querySelectorAll('.level-up__class-picker hk-picker-card:not(.hk-picker-card--gated)')
        .length,
    ).toBe(classIds.size);
    // The character's OWN class is listed first on its own; every other option is a class to start.
    expect(
      Array.from(root.querySelectorAll('.level-up__class-own .hk-picker-card__name')).map((n) =>
        n.textContent?.trim(),
      ),
    ).toEqual(['Fighter']);
    expect(
      root.querySelectorAll(
        '.level-up__class-multi hk-picker-card:not(.hk-picker-card--gated) .hk-picker-card__name',
      ).length,
    ).toBe(classIds.size - 1);
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

    await chooseClassIfOffered(root, harness.fixture, 'Barbarian');

    // A brand-new class's level 1 never rolls hit dice (`hpChoice: false`, task-2-report.md) — the
    // wizard skips straight past the HP step; whatever level-1 choices Barbarian asks for (or
    // 'review' if none) render next, never the fighter's own level-2 flow.
    expect(root.querySelector('.level-up__hp-roll')).toBeNull();
    expect(root.querySelector('.level-up')).not.toBeNull();

    // Plan 16 task 6 (ruling 10) re-pin: Barbarian's multiclass row grants no skill (plan 12 final
    // wave W1, gains.skillChoiceCount 0), and its `@1/weapon-masteries` pick is no longer offered
    // either — the Fighter's 3 recorded masteries already fill the shared cap (max(3, 2) = 3), so
    // Barbarian is offered 0 and level 1 asks nothing: the wizard opens on Review with Finish
    // enabled. (Fix round 1's "a fresh step list lands on its FIRST step, not Review" regression
    // keeps its coverage in the fighter → bard test below, whose first step is a real choice.)
    expect(root.querySelector('.choice-step__skills .entity-picker__row')).toBeNull();
    expect(root.querySelector('.hk-picker-card__choose, .entity-picker__toggle')).toBeNull();
    expect(root.querySelector('.level-up__review')).not.toBeNull();

    expect(strapAction('next')?.label).toBe('shell.strap.finish-level-up');
    expect(strapAction('next')?.disabled).toBeFalsy();
    strapAction('next')!.run();

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
    expect(
      characterStore
        .events()
        .some(
          (e) =>
            e.type === 'decision.made' &&
            (e.payload as { choiceId?: string }).choiceId ===
              'srd-5e-2024:class/barbarian@1/weapon-masteries',
        ),
    ).toBe(false);
    expect(characterStore.outstanding()).toEqual([]);
  });

  // Plan 12 final wave W1: `multiclass.gains.skillChoiceCount` is wired — a fighter multiclassing
  // into Bard (gains.skillChoiceCount 1) is asked for ONE skill from Bard's own list (the synthetic
  // `<class>@1/multiclass-skills` pick), never Bard's full 3-skill creation pick, and the pick lands
  // as a real proficiency on the sheet.
  it('fighter → bard: the new class offers a 1-skill multiclass pick from its own list, and the pick lands as proficient', async () => {
    const SYSTEM_ID = 'srd-5e-2024:system/5e-2024';
    const FIGHTER = 'srd-5e-2024:class/fighter';
    const BARD = 'srd-5e-2024:class/bard';
    const state = TestBed.runInInjectionContext(() => new CreateWizardState());
    state.name.set('Lirael');
    state.gender.set('feminine');
    state.setDecision(`${SYSTEM_ID}@0/species`, ['srd-5e-2024:species/human']);
    state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    // cha 13 clears Bard's own multiclass prerequisite.
    state.setDecision(
      `${SYSTEM_ID}@0/ability-scores`,
      ['str:15', 'dex:10', 'con:14', 'int:8', 'wis:12', 'cha:13'],
      { method: 'standardArray' },
    );
    state.setDecision(`${SYSTEM_ID}@0/class`, [FIGHTER]);
    state.setDecision(`${FIGHTER}@1/skills`, ['athletics', 'perception']);
    state.setDecision(`${FIGHTER}@1/fighting-style`, ['srd-5e-2024:feat/defense']);
    state.setDecision(`${FIGHTER}@1/weapon-masteries`, [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ]);
    const characterStore = TestBed.inject(CharacterStore);
    const id = await characterStore.create(state.name().trim(), state.gender());
    const [, ...rest] = state.buildTransaction();
    await characterStore.appendTx(rest);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    expect(characterStore.advancements().find((a) => a.classId === BARD)?.isNewClass).toBe(true);
    expect(characterStore.sheet()?.skills['arcana']?.proficiency).toBe('none');

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;
    await chooseClassIfOffered(root, harness.fixture, 'Bard');

    // The multiclass skill pick is the first step: "Choose 1 skill for Bard", chips = Bard's list.
    expect(root.querySelector('.choice-step__title')?.textContent?.trim()).toBe(
      'Choose 1 skill for Bard',
    );
    const chips = Array.from(
      root.querySelectorAll<HTMLElement>('.choice-step__skills .entity-picker__toggle'),
    );
    const bardList = corePack.entities.find((e) => e.id === BARD);
    expect(bardList?.type).toBe('class');
    expect(chips.length).toBe(bardList?.type === 'class' ? bardList.skillChoice.from.length : -1);
    chips.find((c) => pickName(c) === 'Arcana')!.click();
    await harness.fixture.whenStable();

    // Plan 14 task 1 re-pin: Bard's three-instrument `@1/tools` pick is `scope: 'initial'`, so a
    // later-class Bard is asked the `scope: 'later'` `@1/multiclass-tools` pick instead — ONE
    // Musical Instrument (plan 13 pinned the old residual: the full three-instrument pick).
    // Answering the skill pick drops its step, so the stepper re-homes onto the tool pick's step.
    expect(root.querySelector('.choice-step__title')?.textContent?.trim()).toBe(
      'Tool Proficiency: choose one Musical Instrument',
    );
    for (const name of ['Lute']) {
      Array.from(
        root.querySelectorAll<HTMLButtonElement>('.hk-picker-card__choose, .entity-picker__toggle'),
      )
        .find((b) => pickName(b) === `Musical Instrument, ${name}`)!
        .click();
      await harness.fixture.whenStable();
    }

    await finishLevelUp(harness.fixture);

    await pollUntil(harness.fixture, () =>
      characterStore
        .events()
        .some(
          (e) =>
            e.type === 'decision.made' &&
            (e.payload as { choiceId?: string }).choiceId === `${BARD}@1/multiclass-skills`,
        ),
    );
    expect(
      characterStore
        .events()
        .some(
          (e) =>
            e.type === 'decision.made' &&
            (e.payload as { choiceId?: string }).choiceId === `${BARD}@1/skills`,
        ),
    ).toBe(false);
    expect(characterStore.sheet()?.skills['arcana']?.proficiency).toBe('proficient');
    expect(characterStore.outstanding().map((o) => o.choiceId)).not.toContain(
      `${BARD}@1/multiclass-skills`,
    );
    expect(
      characterStore
        .sheet()
        ?.proficiencies.filter((p) => p.kind === 'tool' && p.sources.includes(BARD))
        .map((p) => p.target),
    ).toEqual(['musical-instrument-lute']);
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
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
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
    await chooseClassIfOffered(root, harness.fixture, 'Paladin');

    root.querySelector<HTMLButtonElement>('.level-up__hp-average')!.click();
    await harness.fixture.whenStable();

    await pressStrap(harness.fixture, 'next');

    // The subclass step: exactly one option, and it is Oath of Devotion.
    const options = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.hk-picker-card__choose, .entity-picker__toggle'),
    );
    expect(options).toHaveLength(1);
    expect(root.textContent).toContain('Oath of Devotion');
    options[0].click();
    await harness.fixture.whenStable();
    expect(root.textContent).not.toContain('Missing translation');
    expect(root.textContent).not.toMatch(/characters\.[a-z]+\.[A-Za-z.]+/);

    // Advance through whatever steps remain (spells/review) to Finish.
    await finishLevelUp(harness.fixture);
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
    await pressStrap(harness.fixture, 'next');

    const hint = hintOf(root.querySelector('.spells-step__spellbook .spells-step__counter')!);
    expect(hint).toContain('2');
    expect(hint).not.toContain('6');
  });

  // Plan 13 task 9: fighter Weapon Mastery grows 3 -> 4 at class level 4 (plan 12 task 2), so the
  // level-1 choice is re-offered with its 3-weapon decision still recorded. The step opens with the
  // recorded picks pre-selected, so the player adds only the delta — and the commit is the SAME
  // single replace-`decision.made` (full selection: prior picks in recorded order, then the new one)
  // the pre-change hand re-pick produced. UI-level pre-population only; the event shape is unchanged.
  it('fighter 3→4: the grown weapon-mastery re-offer pre-selects the 3 recorded picks; +1 commits the same replace-decision event as a hand re-pick', async () => {
    const FIGHTER = 'srd-5e-2024:class/fighter';
    const CHAMPION = 'srd-5e-2024:subclass/champion';
    const MASTERIES = `${FIGHTER}@1/weapon-masteries`;
    const PRIOR = [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ];
    const HANDAXE = 'srd-5e-2024:item/handaxe';
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    expect(characterStore.facts()?.decisions[MASTERIES]).toEqual(PRIOR);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    await characterStore.appendTx([
      { type: 'level.gained', v: 1, payload: { classId: FIGHTER, level: 2, hpRoll: 'average' } },
    ]);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 600 } }]);
    await characterStore.appendTx([
      {
        type: 'level.gained',
        v: 1,
        payload: { classId: FIGHTER, level: 3, hpRoll: 'average', subclassId: CHAMPION },
      },
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId: `${FIGHTER}@3/subclass`, selection: [CHAMPION] },
      },
    ]);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 1800 } }]);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;
    await chooseClassIfOffered(root, harness.fixture, 'Fighter');
    const state = harness.fixture.debugElement
      .query(By.css('app-level-up'))
      .injector.get(LevelUpState);
    expect(state.outstanding().map((r) => r.choiceId)[0]).toBe(MASTERIES);

    root.querySelector<HTMLButtonElement>('.level-up__hp-average')!.click();
    await harness.fixture.whenStable();
    await pressStrap(harness.fixture, 'next');

    const selectedNames = (): string[] =>
      Array.from(
        root.querySelectorAll<HTMLButtonElement>('.hk-picker-card__choose, .entity-picker__toggle'),
      )
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => pickName(b) ?? '');
    expect(selectedNames()).toEqual(['Dagger', 'Longsword', 'Shortsword']);
    // Nothing is committed by the pre-seed alone — only the player's own toggle commits.
    expect(state.decisions().has(MASTERIES)).toBe(false);

    Array.from(
      root.querySelectorAll<HTMLButtonElement>('.hk-picker-card__choose, .entity-picker__toggle'),
    )
      .find((b) => pickName(b) === 'Handaxe')!
      .click();
    await harness.fixture.whenStable();
    expect(state.outstanding().map((r) => r.choiceId)).not.toContain(MASTERIES);

    state.setDecision(`${FIGHTER}@4/feat`, ['srd-5e-2024:feat/ability-score-improvement']);
    state.setDecision('srd-5e-2024:feat/ability-score-improvement@4/ability-scores', ['str:+2']);
    expect(state.complete()).toBe(true);

    // The pre-change path: the player re-picks all four by hand (recorded order, then the new one).
    const manual = TestBed.runInInjectionContext(() => new LevelUpState());
    manual.chooseClass(FIGHTER);
    manual.setDecision(MASTERIES, [...PRIOR, HANDAXE]);
    const masteryDraft = (drafts: { type: string; payload: unknown }[]) =>
      drafts.filter(
        (d) =>
          d.type === 'decision.made' && (d.payload as { choiceId?: string }).choiceId === MASTERIES,
      );
    expect(masteryDraft(state.buildTransaction())).toStrictEqual(
      masteryDraft(manual.buildTransaction()),
    );

    await finishLevelUp(harness.fixture);
    await pollUntil(harness.fixture, () => characterStore.sheet()?.level === 4);

    const emitted = characterStore
      .events()
      .filter(
        (e) =>
          e.type === 'decision.made' && (e.payload as { choiceId?: string }).choiceId === MASTERIES,
      );
    expect(emitted).toHaveLength(2); // creation's 3-pick + this level-up's replacing 4-pick
    expect(emitted[1].v).toBe(1);
    expect(emitted[1].payload).toStrictEqual({
      choiceId: MASTERIES,
      selection: [...PRIOR, HANDAXE],
    });
    expect(characterStore.events().some((e) => e.type === 'decision.cleared')).toBe(false);
    expect(characterStore.facts()?.decisions[MASTERIES]).toEqual([...PRIOR, HANDAXE]);
    expect(characterStore.outstanding().map((o) => o.choiceId)).not.toContain(MASTERIES);
  });

  // Final fix wave (plan 13): the deselect half of task 9's pre-seed. A pre-selected grown pick can
  // be toggled OFF (a selected card is never disabled, even when gated), the step keeps the reduced
  // selection with the count diagnostic (no re-seed on the next change detection), and the invalid
  // count is never committed as an event.
  it('fighter 3→4: a pre-seeded grown weapon-mastery pick can be toggled off; the 2 remaining picks show the count diagnostic and nothing is committed', async () => {
    const FIGHTER = 'srd-5e-2024:class/fighter';
    const CHAMPION = 'srd-5e-2024:subclass/champion';
    const MASTERIES = `${FIGHTER}@1/weapon-masteries`;
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    await characterStore.appendTx([
      { type: 'level.gained', v: 1, payload: { classId: FIGHTER, level: 2, hpRoll: 'average' } },
    ]);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 600 } }]);
    await characterStore.appendTx([
      {
        type: 'level.gained',
        v: 1,
        payload: { classId: FIGHTER, level: 3, hpRoll: 'average', subclassId: CHAMPION },
      },
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId: `${FIGHTER}@3/subclass`, selection: [CHAMPION] },
      },
    ]);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 1800 } }]);
    const masteryEvents = () =>
      characterStore
        .events()
        .filter(
          (e) =>
            e.type === 'decision.made' &&
            (e.payload as { choiceId?: string }).choiceId === MASTERIES,
        ).length;
    expect(masteryEvents()).toBe(1);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;
    await chooseClassIfOffered(root, harness.fixture, 'Fighter');
    const state = harness.fixture.debugElement
      .query(By.css('app-level-up'))
      .injector.get(LevelUpState);
    root.querySelector<HTMLButtonElement>('.level-up__hp-average')!.click();
    await harness.fixture.whenStable();
    await pressStrap(harness.fixture, 'next');

    const buttons = () =>
      Array.from(
        root.querySelectorAll<HTMLButtonElement>('.hk-picker-card__choose, .entity-picker__toggle'),
      );
    const nameOf = (b: HTMLButtonElement) => pickName(b) ?? '';
    const selectedNames = (): string[] =>
      buttons()
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map(nameOf);
    expect(selectedNames()).toEqual(['Dagger', 'Longsword', 'Shortsword']);

    const longsword = buttons().find((b) => nameOf(b) === 'Longsword')!;
    expect(longsword.getAttribute('aria-disabled')).not.toBe('true');
    longsword.click();
    await harness.fixture.whenStable();
    expect(selectedNames()).toEqual(['Dagger', 'Shortsword']);
    const diagnostics = () =>
      Array.from(root.querySelectorAll('.choice-step__diagnostic')).map((el) =>
        el.textContent?.trim(),
      );
    expect(diagnostics()).toContain(charactersEn.validation.selection.count);

    // No re-seed: another change-detection pass keeps the player's reduced selection.
    harness.fixture.detectChanges();
    await harness.fixture.whenStable();
    expect(selectedNames()).toEqual(['Dagger', 'Shortsword']);

    // The invalid count is a draft only: the level-up stays incomplete (Finish unavailable) and
    // no decision event reaches the character's log.
    expect(state.invalidDecisions().has(MASTERIES)).toBe(true);
    expect(state.complete()).toBe(false);
    expect(masteryEvents()).toBe(1);
    expect(characterStore.facts()?.decisions[MASTERIES]).toEqual([
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ]);
  });

  // --- Plan 17 B10a: level-up on the shared stepper (boards L01..L04) -------------------------------

  describe('on the shared stepper (plan 17 B10a)', () => {
    const FIGHTER_NAME = 'Fighter';

    async function seedLevelUp(xp = 300): Promise<string> {
      const id = await seedFighter('Ivan');
      await TestBed.inject(CharacterStore).appendTx([
        { type: 'xp.awarded', v: 1, payload: { amount: xp } },
      ]);
      return id;
    }

    /** Opens the level-up the way a link does, recording it in the user's path like the app shell. */
    async function visit(url: string) {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);
      TestBed.inject(NavHistoryService).push(url);
      return harness;
    }

    const currentStepName = (root: HTMLElement): string | undefined =>
      (
        root.querySelector('.hk-stepper__step--current .hk-stepper__name') ??
        root.querySelector('.hk-stepper__step--current')
      )?.textContent?.trim();

    it('a deep link to the level-up, then Cancel, returns to the tab the user came from', async () => {
      const id = await seedLevelUp();
      const router = TestBed.inject(Router);
      const nav = TestBed.inject(NavHistoryService);
      const timeline = `/c/${id}/timeline`;
      const harness = await RouterTestingHarness.create(timeline);
      nav.push(timeline);
      await harness.navigateByUrl(`/c/${id}/level-up`);
      nav.push(`/c/${id}/level-up`);

      await pressStrap(harness.fixture, 'cancel');
      await harness.fixture.whenStable();

      expect(router.url).toBe(timeline);
    });

    it('a cold deep link (a reload or bookmark, the character not loaded yet) opens the level-up instead of bouncing to the heroes list', async () => {
      const id = await seedLevelUp();
      // A fresh app: the stores start empty, the route's guard runs before the sheet's resolver.
      TestBed.inject(HkDb).close();
      TestBed.resetTestingModule();
      configureReal();
      expect(TestBed.inject(CharacterStore).streamId()).toBeFalsy();

      const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);

      expect(TestBed.inject(Router).url).toBe(`/c/${id}/level-up`);
      expect(harness.routeNativeElement!.querySelector('.level-up')).not.toBeNull();
    });

    it('a level-up opened by deep link (no earlier screen) falls back to the play tab on Cancel', async () => {
      const id = await seedLevelUp();
      const harness = await visit(`/c/${id}/level-up`);

      await pressStrap(harness.fixture, 'cancel');
      await harness.fixture.whenStable();

      expect(TestBed.inject(Router).url).toBe(`/c/${id}/play`);
      expect(harness.routeNativeElement!.querySelector('.level-up')).toBeNull();
    });

    it('the level-up replaces the sheet strap with Cancel, Back and Next, and the sheet strap returns after leaving', async () => {
      const id = await seedLevelUp();
      const harness = await RouterTestingHarness.create(`/c/${id}/play`);
      TestBed.inject(NavHistoryService).push(`/c/${id}/play`);
      expect(strapAction('damage'), 'sheet strap before').toBeDefined();
      expect(strapAction('cancel')).toBeUndefined();

      await harness.navigateByUrl(`/c/${id}/level-up`);
      TestBed.inject(NavHistoryService).push(`/c/${id}/level-up`);
      await harness.fixture.whenStable();
      expect(strapAction('cancel'), 'level-up strap').toBeDefined();
      expect(strapAction('back')).toBeDefined();
      expect(strapAction('next')).toBeDefined();
      expect(strapAction('damage')).toBeUndefined();

      await pressStrap(harness.fixture, 'cancel');
      await harness.fixture.whenStable();
      expect(strapAction('damage'), 'sheet strap after').toBeDefined();
      expect(strapAction('cancel')).toBeUndefined();
    });

    /** Opens the level-up with its dialog service stubbed to answer `leave` (true: discard and leave). */
    async function openWithStubbedDialog(
      id: string,
      options: { leave?: boolean; pick?: boolean } = {},
    ) {
      const { leave = false, pick = true } = options;
      const harness = await visit(`/c/${id}/level-up`);
      const dialog = harness.fixture.debugElement
        .query(By.css('app-level-up'))
        .injector.get(DialogService);
      const open = vi
        .spyOn(dialog, 'open')
        .mockReturnValue({ closed: Promise.resolve(leave) } as ReturnType<DialogService['open']>);
      if (pick) await pickClass(harness.routeNativeElement!, harness.fixture, FIGHTER_NAME);
      return { harness, open };
    }

    const chooseAverage = async (harness: {
      routeNativeElement: HTMLElement | null;
      fixture: { whenStable(): Promise<unknown> };
    }): Promise<void> => {
      harness
        .routeNativeElement!.querySelector<HTMLButtonElement>('.level-up__hp-average')!
        .click();
      await harness.fixture.whenStable();
    };

    it('Cancel leaves without asking while nothing has been chosen', async () => {
      const id = await seedLevelUp();
      const { harness, open } = await openWithStubbedDialog(id, { pick: false });

      await pressStrap(harness.fixture, 'cancel');
      await harness.fixture.whenStable();

      expect(open).not.toHaveBeenCalled();
      expect(TestBed.inject(Router).url).toBe(`/c/${id}/play`);
    });

    it('picking a class already counts as a change: Cancel asks', async () => {
      const id = await seedLevelUp();
      const { harness, open } = await openWithStubbedDialog(id);

      await pressStrap(harness.fixture, 'cancel');
      await harness.fixture.whenStable();

      expect(open).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(Router).url).toBe(`/c/${id}/level-up`);
    });

    it('Cancel asks first once something has been chosen, and stays when the answer is to keep going', async () => {
      const id = await seedLevelUp();
      const { harness, open } = await openWithStubbedDialog(id);
      await chooseAverage(harness);

      await pressStrap(harness.fixture, 'cancel');
      await harness.fixture.whenStable();

      expect(open).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(Router).url).toBe(`/c/${id}/level-up`);
    });

    it('Cancel confirmed leaves, and the dialog is shown exactly once', async () => {
      const id = await seedLevelUp();
      const { harness, open } = await openWithStubbedDialog(id, { leave: true });
      await chooseAverage(harness);

      await pressStrap(harness.fixture, 'cancel');
      await harness.fixture.whenStable();
      await harness.fixture.whenStable();

      expect(open).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(Router).url).toBe(`/c/${id}/play`);
    });

    it('any other way out (a tab link, the rail, browser Back) asks too while something is chosen, and stays on "keep going"', async () => {
      const id = await seedLevelUp();
      const router = TestBed.inject(Router);
      const { harness, open } = await openWithStubbedDialog(id);
      await chooseAverage(harness);

      await router.navigateByUrl(`/c/${id}/timeline`);
      await harness.fixture.whenStable();

      expect(open).toHaveBeenCalledTimes(1);
      expect(router.url).toBe(`/c/${id}/level-up`);
    });

    it('leaving by a tab link after "discard and leave" goes there, asking once', async () => {
      const id = await seedLevelUp();
      const router = TestBed.inject(Router);
      const { harness, open } = await openWithStubbedDialog(id, { leave: true });
      await chooseAverage(harness);

      await router.navigateByUrl(`/c/${id}/timeline`);
      await harness.fixture.whenStable();

      expect(open).toHaveBeenCalledTimes(1);
      expect(router.url).toBe(`/c/${id}/timeline`);
    });

    it('a clean level-up is left by any route without asking', async () => {
      const id = await seedLevelUp();
      const router = TestBed.inject(Router);
      const { harness, open } = await openWithStubbedDialog(id, { pick: false });

      await router.navigateByUrl(`/c/${id}/timeline`);
      await harness.fixture.whenStable();

      expect(open).not.toHaveBeenCalled();
      expect(router.url).toBe(`/c/${id}/timeline`);
    });

    it('finishing the level up never asks', async () => {
      const id = await seedLevelUp();
      const characterStore = TestBed.inject(CharacterStore);
      const { harness, open } = await openWithStubbedDialog(id);
      await chooseAverage(harness);
      await finishLevelUp(harness.fixture);
      await pollUntil(harness.fixture, () => characterStore.sheet()?.level === 2);
      await pollUntil(harness.fixture, () => TestBed.inject(Router).url === `/c/${id}/play`);

      expect(open).not.toHaveBeenCalled();
    });

    it('a class whose multiclass prerequisite is unmet is listed gated with its reason, and cannot be picked', async () => {
      const id = await seedLevelUp();
      const harness = await visit(`/c/${id}/level-up`);
      const root = harness.routeNativeElement!;
      const card = Array.from(
        root.querySelectorAll<HTMLElement>('.level-up__class-multi hk-picker-card'),
      ).find((c) => c.querySelector('.hk-picker-card__name')?.textContent?.trim() === 'Wizard');
      expect(card, 'a gated Wizard card').toBeDefined();
      expect(card!.classList.contains('hk-picker-card--gated')).toBe(true);
      expect(card!.querySelector('.hk-picker-card__gate')?.getAttribute('aria-label')).toBe(
        charactersEn.wizard.picker.gate.prerequisiteFailed,
      );
      const choose = card!.querySelector<HTMLButtonElement>('.hk-picker-card__choose')!;
      expect(choose.getAttribute('aria-disabled') === 'true' || choose.disabled).toBe(true);
      choose.click();
      await harness.fixture.whenStable();
      expect(root.querySelector('.level-up__class-picker')).not.toBeNull();
      // Eligible classes are unchanged.
      expect(
        Array.from(
          root.querySelectorAll(
            '.level-up__class-multi hk-picker-card:not(.hk-picker-card--gated) .hk-picker-card__name',
          ),
        ).map((n) => n.textContent?.trim()),
      ).toEqual(expect.arrayContaining(['Barbarian', 'Rogue']));
    });

    it('the review and the hit point step show what changes as before to after and what stays as "unchanged"', async () => {
      const id = await seedLevelUp();
      const harness = await visit(`/c/${id}/level-up`);
      const root = harness.routeNativeElement!;
      await pickClass(root, harness.fixture, FIGHTER_NAME);
      await chooseAverage(harness);
      const row = (field: string): string =>
        root.querySelector(`.level-up__changes [data-change="${field}"]`)?.textContent ?? '';
      // On the hit point step already.
      expect(row('hitDice')).toContain('2d10');
      await pressStrap(harness.fixture, 'next');

      expect(root.querySelector('.level-up__review')).not.toBeNull();
      expect(row('hitDice')).toContain('1d10');
      expect(row('hitDice')).toContain('2d10');
      expect(row('proficiency')).toContain('+2');
      expect(row('proficiency')).toContain(charactersEn.levelUp.review.unchanged);
      expect(row('currentHp')).toContain(charactersEn.levelUp.review.unchanged);
    });

    it('a level-up for a deleted hero never judges eligibility against the hero loaded before', async () => {
      await seedLevelUp(); // this hero is loaded in the store and could level up
      const router = TestBed.inject(Router);
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/c/char:00000000-0000-7000-8000-000000000000/level-up');

      expect(router.url).toBe('/characters');
    });

    it('while the level-up is open the sheet tabs are dimmed and the Level up tab is the active one', async () => {
      const id = await seedLevelUp();
      const harness = await RouterTestingHarness.create(`/c/${id}/play`);
      const root = harness.routeNativeElement!;
      const tabs = () => Array.from(root.querySelectorAll<HTMLElement>('.sheet-shell__tab'));
      const badge = () => root.querySelector<HTMLElement>('.sheet-shell__level-up-badge')!;
      expect(tabs().every((t) => t.getAttribute('aria-disabled') !== 'true')).toBe(true);
      expect(badge().getAttribute('aria-current')).toBeNull();

      await harness.navigateByUrl(`/c/${id}/level-up`);
      await harness.fixture.whenStable();

      expect(tabs()).toHaveLength(3);
      expect(tabs().every((t) => t.getAttribute('aria-disabled') === 'true')).toBe(true);
      expect(tabs().some((t) => t.getAttribute('aria-selected') === 'true')).toBe(false);
      expect(badge().getAttribute('aria-current')).toBe('page');
    });

    it('on a phone the tab bar stays and More is the active tab while the level-up is open', async () => {
      stubViewport({ phone: true });
      const id = await seedLevelUp();
      await RouterTestingHarness.create(`/c/${id}/level-up`);
      await Promise.resolve();

      const more = TestBed.inject(TabBarService)
        .tabs()
        ?.find((t) => t.id === 'more');
      expect(more, 'a tab bar is set').toBeDefined();
      expect(more!.alsoActive).toContainEqual(['/c', id, 'level-up']);
    });

    it('the HP step shows the roll and the hit points it adds before the level up is confirmed', async () => {
      const id = await seedLevelUp();
      const characterStore = TestBed.inject(CharacterStore);
      const harness = await visit(`/c/${id}/level-up`);
      const root = harness.routeNativeElement!;
      await pickClass(root, harness.fixture, FIGHTER_NAME);
      expect(currentStepName(root)).toBe(charactersEn.levelUp.steps.hp);
      // The average is priced from the start; the roll only once it is rolled.
      expect(
        root.querySelector('.level-up__hp-card--average .level-up__hp-gain')?.textContent,
      ).toContain('+8');
      expect(root.querySelector('.level-up__hp-card--roll .level-up__hp-gain')).toBeNull();

      root.querySelector<HTMLButtonElement>('.level-up__hp-roll')!.click();
      await harness.fixture.whenStable();

      const die = Number(root.querySelector('.level-up__hp-die')?.textContent?.trim());
      expect(die).toBeGreaterThanOrEqual(1);
      // Constitution +2 is added to the die; shown on the card, still on this step.
      expect(
        root.querySelector('.level-up__hp-card--roll .level-up__hp-gain')?.textContent,
      ).toContain(`+${die + 2}`);
      expect(root.querySelector('.level-up__hp-card--roll')?.getAttribute('data-chosen')).toBe(
        'true',
      );
      expect(currentStepName(root)).toBe(charactersEn.levelUp.steps.hp);
      // Nothing is confirmed yet: the character is still level 1 until the review's Finish.
      expect(characterStore.sheet()?.level).toBe(1);
      expect(strapAction('next')?.disabled).toBeFalsy();
    });

    it('once the class is picked the stepper keeps it as a locked, answered first row with the class name', async () => {
      const id = await seedLevelUp();
      const harness = await visit(`/c/${id}/level-up`);
      const root = harness.routeNativeElement!;
      expect(currentStepName(root)).toBe(charactersEn.levelUp.steps.class);

      await pickClass(root, harness.fixture, FIGHTER_NAME);

      const first = root.querySelector('.hk-stepper__step')!;
      expect(first.classList.contains('hk-stepper__step--locked')).toBe(true);
      expect(first.textContent).toContain(charactersEn.levelUp.steps.class);
      expect(root.querySelector('.hk-stepper__item')?.textContent).toContain(FIGHTER_NAME);
      // Back from the first real step has nowhere to go: the class cannot be changed any more.
      expect(strapAction('back')?.disabled).toBe(true);
    });

    it('the review lists the hit point change with an Edit that jumps back, and Next returns to the review', async () => {
      const id = await seedLevelUp();
      const harness = await visit(`/c/${id}/level-up`);
      const root = harness.routeNativeElement!;
      await pickClass(root, harness.fixture, FIGHTER_NAME);
      root.querySelector<HTMLButtonElement>('.level-up__hp-average')!.click();
      await harness.fixture.whenStable();
      await pressStrap(harness.fixture, 'next');
      expect(root.querySelector('.level-up__review')).not.toBeNull();
      expect(root.querySelector('.level-up__summary-hp')?.textContent).toContain('12');
      expect(root.querySelector('.level-up__summary-hp')?.textContent).toContain('20');

      root.querySelector<HTMLButtonElement>('[data-edit-step="hp"]')!.click();
      await harness.fixture.whenStable();
      expect(currentStepName(root)).toBe(charactersEn.levelUp.steps.hp);
      expect(root.querySelector('.level-up__review')).toBeNull();

      await pressStrap(harness.fixture, 'next');
      expect(root.querySelector('.level-up__review')).not.toBeNull();
      // Back from the review lands on the step the player just came from.
      await pressStrap(harness.fixture, 'back');
      expect(currentStepName(root)).toBe(charactersEn.levelUp.steps.hp);
    });

    it('Next waits for an unanswered choice and never skips it; the review offers "Finish level up" in the Next slot', async () => {
      const id = await seedLevelUp();
      const harness = await visit(`/c/${id}/level-up`);
      const root = harness.routeNativeElement!;
      // A second class opens on its own level-1 choices (no hit points step).
      await pickClass(root, harness.fixture, 'Rogue');

      let sawChoice = false;
      for (let i = 0; i < 12 && root.querySelector('.level-up__review') === null; i++) {
        const title = root.querySelector('.choice-step__title')?.textContent;
        if (title) {
          sawChoice = true;
          expect(strapAction('next')?.disabled, 'Next on an unanswered choice').toBe(true);
          strapAction('next')!.run();
          await harness.fixture.whenStable();
          expect(root.querySelector('.choice-step__title')?.textContent).toBe(title);
          for (
            let j = 0;
            j < 6 && root.querySelector('.choice-step__title')?.textContent === title;
            j++
          ) {
            const choose = Array.from(
              root.querySelectorAll<HTMLButtonElement>(
                '.hk-picker-card__choose, .entity-picker__toggle',
              ),
            ).find((b) => b.getAttribute('aria-pressed') !== 'true' && !b.disabled);
            if (!choose) break;
            choose.click();
            await harness.fixture.whenStable();
          }
        } else {
          await pressStrap(harness.fixture, 'next');
        }
      }
      expect(sawChoice, 'Rogue asks at least one level-1 choice').toBe(true);
      expect(root.querySelector('.level-up__review')).not.toBeNull();
      expect(strapAction('next')?.label).toBe('shell.strap.finish-level-up');
      expect(strapAction('next')?.disabled).toBeFalsy();
    });
  });
});
