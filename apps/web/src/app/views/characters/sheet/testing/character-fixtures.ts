import { TestBed } from '@angular/core/testing';
import { CharacterStore } from '@shared/stores/character.store';
import { CreateWizardState } from '../../create-wizard/create-wizard.state';
import { LevelUpState } from '../../level-up/level-up.state';

// Test-only helper (not a spec file itself): persists a real character through the exact same
// `CharacterStore.create()` + `appendTx(buildTransaction())` path `CreateWizardComponent.onCreate()`
// uses — see `create-wizard.component.spec.ts`'s own "binding spec" describe block, which this
// mirrors, per task-10-brief.md's "T9's binding spec shows how to build a persisted fighter — reuse
// its helper approach or extract one." Every caller's `TestBed` must already provide a real
// `PackStore` (with the core pack loaded) and a real `CharacterStore` (fake-indexeddb-backed), same
// as `create-wizard.component.spec.ts`'s `configureReal()`.

const SYSTEM_ID = 'srd-5e-2024:system/5e-2024';

async function persist(state: CreateWizardState): Promise<string> {
  const characterStore = TestBed.inject(CharacterStore);
  const id = await characterStore.create(state.name().trim(), state.gender());
  const [, ...rest] = state.buildTransaction(); // drop the draft's own `character.created` — `create()` above minted the real one.
  if (rest.length > 0) await characterStore.appendTx(rest);
  return id;
}

/**
 * Persists the exact "fighter-1" fixture `create-wizard.component.spec.ts`'s binding spec drives:
 * soldier background, standard-array abilities, fighter class, athletics/perception skills, Defense
 * fighting style, a longsword mastery pick, and chain mail + longsword + shield all equipped —
 * `hp.max` 12 / `ac` 19 / `prof` 2, with the AC total backed by exactly 3 contributions (chain mail,
 * shield, Defense). Returns the persisted `char:<uuid>` stream id.
 *
 * `options.fightingStyle` (default `true`, task-11-brief.md Step 1): pass `false` to omit the
 * `fighting-style` decision, leaving `srd-5e-2024:class/fighter@1/fighting-style` as the ONLY
 * entry `CharacterStore.outstanding()` reports for the resulting stream — everything else about
 * the fixture (species/background/abilities/class/skills/weapon-masteries/equipment) is unchanged.
 */
export async function seedFighter(
  name = 'Ivan',
  options: { fightingStyle?: boolean } = {},
): Promise<string> {
  const { fightingStyle = true } = options;
  const state = TestBed.runInInjectionContext(() => new CreateWizardState());
  state.name.set(name);
  state.gender.set('masculine');
  state.setDecision(`${SYSTEM_ID}@0/species`, ['srd-5e-2024:species/human']);
  state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
  state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
  state.setDecision(
    `${SYSTEM_ID}@0/ability-scores`,
    ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
    { method: 'standardArray' },
  );
  state.setDecision(`${SYSTEM_ID}@0/class`, ['srd-5e-2024:class/fighter']);
  state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
  if (fightingStyle) {
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
  }
  state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', ['longsword']);

  const chainMail = state.addItem('srd-5e-2024:item/chain-mail', 1);
  state.equipItem(chainMail);
  const longsword = state.addItem('srd-5e-2024:item/longsword', 1);
  state.equipItem(longsword);
  const shield = state.addItem('srd-5e-2024:item/shield', 1);
  state.equipItem(shield);

  return persist(state);
}

/**
 * Persists a level-1 wizard (`spells-step.component.spec.ts`'s own `createWizardDraft` fixture —
 * species/background/ability-scores/class only, deliberately no skills/cantrips/spellbook picks:
 * the class's own level-1 grants already populate `spellcasting[0].slots` regardless of what the
 * player has chosen). Returns the persisted `char:<uuid>` stream id.
 */
export async function seedWizard(name = 'Elowen'): Promise<string> {
  const state = TestBed.runInInjectionContext(() => new CreateWizardState());
  state.name.set(name);
  state.gender.set('feminine');
  state.setDecision(`${SYSTEM_ID}@0/species`, ['srd-5e-2024:species/human']);
  state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
  state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
  state.setDecision(
    `${SYSTEM_ID}@0/ability-scores`,
    ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
    { method: 'standardArray' },
  );
  state.setDecision(`${SYSTEM_ID}@0/class`, ['srd-5e-2024:class/wizard']);

  return persist(state);
}

/**
 * Levels the character CURRENTLY LOADED in `CharacterStore` (via `seedFighter`/`seedWizard` above
 * — must already be persisted and loaded) from 1 to 2, through a real `LevelUpState` session:
 * `xp.awarded` → `LevelUpState` → scripted `rollHp` → `buildTransaction()` → `appendTx`, the exact
 * same `awardXp`/`createState`/`rollHp`/`buildTransaction` flow `level-up.state.spec.ts`'s own
 * binding spec drives (task-6-brief.md: "leveling a seeded fighter to 2 gives 2 hit dice — reuse
 * Task 1's specs"). `hpRoll` (default 5, matching that spec's own fixture — `floor(0.45 * 10) + 1
 * === 5` on a 1d10) is scripted via the same midpoint-fraction technique, generalized to whatever
 * hit die the pending class actually has (`(hpRoll - 0.5) / hitDie`) rather than hardcoding a d10
 * fraction, so this also works for `seedWizard`'s d6.
 *
 * Requires the loaded character's level-2 row to have NO outstanding choices — true for both
 * `seedFighter`'s fighter (level 3/4 are its only choice rows) and `seedWizard`'s wizard (same:
 * level 3 subclass, level 4 feat) — so `LevelUpState.complete()` is reachable off `rollHp` alone,
 * with no `setDecision` calls needed here.
 */
export async function levelUpToTwo(hpRoll = 5): Promise<void> {
  const characterStore = TestBed.inject(CharacterStore);
  await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);

  const state = TestBed.runInInjectionContext(() => new LevelUpState());
  const hitDie = state.hitDie();
  if (hitDie === undefined) {
    throw new Error('levelUpToTwo: no pending advancement with a resolvable hit die');
  }
  state.rollHp(() => (hpRoll - 0.5) / hitDie);
  if (!state.complete()) {
    throw new Error('levelUpToTwo: level-up session not complete after rolling HP');
  }

  await characterStore.appendTx(state.buildTransaction());
}
