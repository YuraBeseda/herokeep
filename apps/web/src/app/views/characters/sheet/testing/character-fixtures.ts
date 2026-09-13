import { TestBed } from '@angular/core/testing';
import { CharacterStore } from '@shared/stores/character.store';
import { CreateWizardState } from '../../create-wizard/create-wizard.state';

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
 */
export async function seedFighter(name = 'Ivan'): Promise<string> {
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
  state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
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
