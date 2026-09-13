import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { seedFighter, seedWizard } from '../sheet/testing/character-fixtures';
import { LevelUpState } from './level-up.state';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling), same fixture-loading
// approach as `create-wizard.state.spec.ts` / `build-tab.component.spec.ts`.
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

const FIGHTER = 'srd-5e-2024:class/fighter';
const WIZARD = 'srd-5e-2024:class/wizard';
const SUBCLASS_CHOICE = 'srd-5e-2024:class/fighter@3/subclass';
const CHAMPION = 'srd-5e-2024:subclass/champion';
const FEAT_CHOICE = 'srd-5e-2024:class/fighter@4/feat';
const ASI_FEAT = 'srd-5e-2024:feat/ability-score-improvement';
const ASI_CHOICE = 'srd-5e-2024:feat/ability-score-improvement@4/ability-scores';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

function configureReal(): void {
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
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
    ],
  });
}

function createState(): LevelUpState {
  return TestBed.runInInjectionContext(() => new LevelUpState());
}

async function awardXp(characterStore: CharacterStore, amount: number): Promise<void> {
  await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount } }]);
}

describe('LevelUpState', () => {
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

  it('fighter 1→2: a scripted-rng roll records hpRoll and derives hp.max = 12 + 5 + 2 = 19', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    expect(characterStore.sheet()?.hp.max.value).toBe(12);

    await awardXp(characterStore, 300);
    expect(characterStore.advancements().map((a) => a.toLevel)).toEqual([2]);

    const state = createState();
    expect(state.advancement()?.classId).toBe(FIGHTER);
    expect(state.outstanding()).toEqual([]); // fighter's level-2 row has no choices

    // floor(0.45 * 10) + 1 === 5 on a 1d10 — a scripted, deterministic rng.
    state.rollHp(() => 0.45);
    expect(state.hpRoll()).toBe(5);
    expect(state.complete()).toBe(true);

    const drafts = state.buildTransaction();
    expect(drafts).toEqual([
      { type: 'level.gained', v: 1, payload: { classId: FIGHTER, level: 2, hpRoll: 5 } },
    ]);

    await characterStore.appendTx(drafts);
    expect(characterStore.sheet()?.level).toBe(2);
    expect(characterStore.sheet()?.hp.max.value).toBe(19);
  });

  it('fighter 1→2: taking the average records hpRoll:"average" and derives hp.max = 12 + 6 + 2 = 20', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await awardXp(characterStore, 300);

    const state = createState();
    state.chooseAverageHp();
    expect(state.hpRoll()).toBe('average');

    await characterStore.appendTx(state.buildTransaction());
    expect(characterStore.sheet()?.hp.max.value).toBe(20);
  });

  it('fighter 2→3 offers the subclass step; picking champion lands level.gained.subclassId, sharing one txId with the decision', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await awardXp(characterStore, 300);
    const level2 = createState();
    level2.chooseAverageHp();
    await characterStore.appendTx(level2.buildTransaction());
    expect(characterStore.sheet()?.level).toBe(2);

    await awardXp(characterStore, 600);
    expect(characterStore.facts()?.xp).toBe(900);
    expect(characterStore.advancements().map((a) => a.toLevel)).toEqual([3]);

    const state = createState();
    expect(state.outstanding().map((r) => r.choiceId)).toEqual([SUBCLASS_CHOICE]);
    expect(state.steps().some((s) => s.choiceId === SUBCLASS_CHOICE)).toBe(true);

    state.setDecision(SUBCLASS_CHOICE, [CHAMPION]);
    expect(state.outstanding()).toEqual([]);
    state.chooseAverageHp();
    expect(state.complete()).toBe(true);

    const drafts = state.buildTransaction();
    expect(drafts).toEqual([
      {
        type: 'level.gained',
        v: 1,
        payload: { classId: FIGHTER, level: 3, hpRoll: 'average', subclassId: CHAMPION },
      },
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId: SUBCLASS_CHOICE, selection: [CHAMPION] },
      },
    ]);

    await characterStore.appendTx(drafts);
    const last2 = characterStore.events().slice(-2);
    const txIds = new Set(last2.map((e) => e.txId));
    expect(txIds.size).toBe(1);
    expect([...txIds][0]).toBeDefined();
    expect(characterStore.sheet()?.classes[0]?.subclassId).toBe(CHAMPION);
  });

  it("fighter 3→4: picking the ASI feat surfaces its own ability sub-choice; ['str:+2'] validates and lands", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await awardXp(characterStore, 300);
    const level2 = createState();
    level2.chooseAverageHp();
    await characterStore.appendTx(level2.buildTransaction());

    await awardXp(characterStore, 600);
    const level3 = createState();
    level3.setDecision(SUBCLASS_CHOICE, [CHAMPION]);
    level3.chooseAverageHp();
    await characterStore.appendTx(level3.buildTransaction());
    expect(characterStore.sheet()?.level).toBe(3);

    await awardXp(characterStore, 1800);
    expect(characterStore.facts()?.xp).toBe(2700);

    const state = createState();
    expect(state.outstanding().map((r) => r.choiceId)).toEqual([FEAT_CHOICE]);

    state.setDecision(FEAT_CHOICE, [ASI_FEAT]);
    expect(state.outstanding().map((r) => r.choiceId)).toContain(ASI_CHOICE);
    expect(state.steps().some((s) => s.choiceId === ASI_CHOICE)).toBe(true);

    expect(state.validate(ASI_CHOICE, ['str:+2'])).toEqual([]);
    state.setDecision(ASI_CHOICE, ['str:+2']);
    expect(state.outstanding()).toEqual([]);
    state.chooseAverageHp();
    expect(state.complete()).toBe(true);

    await characterStore.appendTx(state.buildTransaction());
    expect(characterStore.sheet()?.level).toBe(4);
    expect(characterStore.sheet()?.abilities['str']?.score.value).toBe(19);
    expect(characterStore.sheet()?.abilities['str']?.mod).toBe(4);
    // Matches the plan-4 golden fixture (fighter-4.json) exactly: levels 2-4 all priced at average.
    expect(characterStore.sheet()?.hp.max.value).toBe(36);
  });

  it('wizard 1→2 offers a spells step; a learned spell queues spell.learned, sharing one txId with level.gained', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    // `seedWizard` deliberately leaves the level-1 skills choice undecided (its own doc) — resolve
    // it first so this test's `advancement`/`outstanding` reflect ONLY the level-2 step, same as a
    // real "build tab is already clean" character would when the level-up wizard opens.
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
    await awardXp(characterStore, 300);
    expect(characterStore.advancements().map((a) => a.toLevel)).toEqual([2]);

    const state = createState();
    expect(state.advancement()?.classId).toBe(WIZARD);
    expect(state.steps().some((s) => s.kind === 'spells')).toBe(true);

    const spellId = 'srd-5e-2024:spell/burning-hands';
    state.addSpellLearned(spellId, WIZARD);
    state.chooseAverageHp();
    expect(state.complete()).toBe(true);

    const drafts = state.buildTransaction();
    expect(drafts).toEqual([
      { type: 'level.gained', v: 1, payload: { classId: WIZARD, level: 2, hpRoll: 'average' } },
      { type: 'spell.learned', v: 1, payload: { spellId, classId: WIZARD, source: 'levelUp' } },
    ]);

    await characterStore.appendTx(drafts);
    const txIds = new Set(
      characterStore
        .events()
        .slice(-2)
        .map((e) => e.txId),
    );
    expect(txIds.size).toBe(1);
    expect([...txIds][0]).toBeDefined();
    expect(characterStore.sheet()?.spellcasting[0]?.known).toContain(spellId);
  });

  it('undo restores a sheet deep-equal to the one before the level-up transaction was committed', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await awardXp(characterStore, 300);
    const level2 = createState();
    level2.chooseAverageHp();
    await characterStore.appendTx(level2.buildTransaction());
    await awardXp(characterStore, 600);

    const before = JSON.parse(JSON.stringify(characterStore.sheet())) as unknown;

    const state = createState();
    state.setDecision(SUBCLASS_CHOICE, [CHAMPION]);
    state.chooseAverageHp();
    await characterStore.appendTx(state.buildTransaction());
    expect(characterStore.sheet()?.level).toBe(3);

    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.txId).toBeDefined();
    await characterStore.revert({ txId: lastEvent.txId });

    const after = JSON.parse(JSON.stringify(characterStore.sheet())) as unknown;
    expect(after).toEqual(before);
    expect(characterStore.sheet()?.level).toBe(2);
  });

  it('undo also restores a deep-equal sheet for a 3-event ASI transaction (level.gained + feat decision + ability sub-choice)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await awardXp(characterStore, 300);
    const level2 = createState();
    level2.chooseAverageHp();
    await characterStore.appendTx(level2.buildTransaction());

    await awardXp(characterStore, 600);
    const level3 = createState();
    level3.setDecision(SUBCLASS_CHOICE, [CHAMPION]);
    level3.chooseAverageHp();
    await characterStore.appendTx(level3.buildTransaction());

    await awardXp(characterStore, 1800);
    const before = JSON.parse(JSON.stringify(characterStore.sheet())) as unknown;

    const state = createState();
    state.setDecision(FEAT_CHOICE, [ASI_FEAT]);
    state.setDecision(ASI_CHOICE, ['str:+2']);
    state.chooseAverageHp();
    expect(state.complete()).toBe(true);
    const drafts = state.buildTransaction();
    expect(drafts).toHaveLength(3);
    await characterStore.appendTx(drafts);
    expect(characterStore.sheet()?.level).toBe(4);
    expect(characterStore.sheet()?.abilities['str']?.score.value).toBe(19);

    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.txId).toBeDefined();
    const last3 = characterStore.events().slice(-3);
    expect(new Set(last3.map((e) => e.txId)).size).toBe(1);
    await characterStore.revert({ txId: lastEvent.txId });

    const after = JSON.parse(JSON.stringify(characterStore.sheet())) as unknown;
    expect(after).toEqual(before);
    expect(characterStore.sheet()?.level).toBe(3);
    expect(characterStore.sheet()?.abilities['str']?.score.value).toBe(17);
  });
});
