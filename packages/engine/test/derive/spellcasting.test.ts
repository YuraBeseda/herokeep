import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { deriveAbilities } from '../../src/derive/abilities.ts';
import { deriveActions } from '../../src/derive/actions.ts';
import { deriveResources } from '../../src/derive/resources.ts';
import { deriveSpellcasting } from '../../src/derive/spellcasting.ts';
import { compose } from '../../src/derive/composition.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');

const withAbilities = (overrides: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>) => {
  const facts = baseFacts();
  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides };
  facts.decisions['core-mini:system/mini@0/ability-scores'] = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(
    (a) => `${a}:${scores[a]}`,
  );
  return facts;
};

const deriveAll = (facts: ReturnType<typeof baseFacts>) => {
  const comp = compose(facts, index);
  const abilities = deriveAbilities(facts, comp, index);
  return {
    comp,
    abilities,
    spellcasting: deriveSpellcasting(abilities, comp, facts, index),
    resources: deriveResources(abilities, comp, facts, index),
    actions: deriveActions(comp, index),
  };
};

describe('deriveSpellcasting', () => {
  it('computes spell DC and attack bonus from proficiency bonus and the casting ability mod', () => {
    const facts = withAbilities({ wis: 16 }); // mod +3
    facts.classes = [{ classId: 'core-mini:class/druid', level: 1 }]; // prof +2
    const { spellcasting } = deriveAll(facts);

    expect(spellcasting.blocks).toHaveLength(1);
    const block = spellcasting.blocks[0]!;
    expect(block.classId).toBe('core-mini:class/druid');
    expect(block.ability).toBe('wis');
    expect(block.dc.value).toBe(13); // 8 + 2 + 3
    expect(block.attack.value).toBe(5); // 2 + 3
    expect(block.ritual).toBe(true);
    expect(block.preparation).toBe('prepared');
  });

  it('derives the class-level-1 spell slot row from the system table, with a facts.slotsUsed overlay', () => {
    const facts = withAbilities({ wis: 16 });
    facts.classes = [{ classId: 'core-mini:class/druid', level: 1 }];
    facts.slotsUsed = { 1: 1 };
    const { spellcasting } = deriveAll(facts);

    expect(spellcasting.blocks[0]!.slots).toEqual([{ level: 1, max: 2, used: 1 }]);
  });

  it('derives the class-level-5 spell slot row from the system table, with a facts.slotsUsed overlay', () => {
    const facts = withAbilities({ wis: 16 });
    facts.classes = [{ classId: 'core-mini:class/druid', level: 5 }];
    facts.slotsUsed = { 1: 2, 2: 1 };
    const { spellcasting } = deriveAll(facts);

    expect(spellcasting.blocks[0]!.slots).toEqual([
      { level: 1, max: 4, used: 2 },
      { level: 2, max: 3, used: 1 },
      { level: 3, max: 2, used: 0 },
    ]);
  });

  it('prices preparedMax from the class level row extra, winning over the preparedCount formula, at level 1', () => {
    const facts = withAbilities({ wis: 16 });
    facts.classes = [{ classId: 'core-mini:class/druid', level: 1 }];
    const { spellcasting } = deriveAll(facts);

    // row extra at level 1 is 4; preparedCount formula ("classLevel(druid) + 2") would give 3 — row wins.
    expect(spellcasting.blocks[0]!.preparedMax).toBe(4);
  });

  it('prices preparedMax from the class level row extra, winning over the preparedCount formula, at level 5', () => {
    const facts = withAbilities({ wis: 16 });
    facts.classes = [{ classId: 'core-mini:class/druid', level: 5 }];
    const { spellcasting } = deriveAll(facts);

    // row extra at level 5 is 9; preparedCount formula would give 7 — row still wins.
    expect(spellcasting.blocks[0]!.preparedMax).toBe(9);
  });

  it('evaluates the cantripsKnown formula against the class level', () => {
    const facts1 = withAbilities({ wis: 16 });
    facts1.classes = [{ classId: 'core-mini:class/druid', level: 1 }];
    expect(deriveAll(facts1).spellcasting.blocks[0]!.cantripsKnown).toBe(2); // 2 + floor(1/4)

    const facts5 = withAbilities({ wis: 16 });
    facts5.classes = [{ classId: 'core-mini:class/druid', level: 5 }];
    expect(deriveAll(facts5).spellcasting.blocks[0]!.cantripsKnown).toBe(3); // 2 + floor(5/4)
  });

  it('reads prepared and known spell lists from facts, keyed by the resolved class id', () => {
    const facts = withAbilities({ wis: 16 });
    facts.classes = [{ classId: 'core-mini:class/druid', level: 1 }];
    facts.preparedSpells = { 'core-mini:class/druid': ['core-mini:spell/fireball'] };
    facts.knownSpells = { 'core-mini:class/druid': ['core-mini:spell/fireball'] };
    const { spellcasting } = deriveAll(facts);

    expect(spellcasting.blocks[0]!.prepared).toEqual(['core-mini:spell/fireball']);
    expect(spellcasting.blocks[0]!.known).toEqual(['core-mini:spell/fireball']);
  });

  it('surfaces active concentration stripped to just the spell id', () => {
    const facts = withAbilities({ wis: 16 });
    facts.classes = [{ classId: 'core-mini:class/druid', level: 1 }];
    facts.concentration = { spellId: 'core-mini:spell/fireball', sinceEventId: 'evt-1' };
    const { spellcasting } = deriveAll(facts);

    expect(spellcasting.concentration).toEqual({ spellId: 'core-mini:spell/fireball' });
  });

  it('produces no blocks and no concentration for a character with no active spellcasting.define effect', () => {
    const facts = withAbilities({});
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }];
    const { spellcasting } = deriveAll(facts);

    expect(spellcasting.blocks).toEqual([]);
    expect(spellcasting.concentration).toBeUndefined();
    expect(spellcasting.issues).toEqual([]);
  });

  it('is deterministic across repeated derivations of the same facts', () => {
    const facts = withAbilities({ wis: 16 });
    facts.classes = [{ classId: 'core-mini:class/druid', level: 5 }];
    facts.slotsUsed = { 1: 1 };
    const r1 = deriveAll(facts).spellcasting;
    const r2 = deriveAll(facts).spellcasting;

    expect(r1).toEqual(r2);
  });
});

describe('deriveResources', () => {
  it('evaluates a resource max formula against the class level', () => {
    const facts1 = withAbilities({});
    facts1.classes = [{ classId: 'core-mini:class/druid', level: 1 }];
    const wildShape1 = deriveAll(facts1).resources.resources.find((r) => r.id === 'wild-shape')!;
    expect(wildShape1.max.value).toBe(1); // 1 + floor(1/4)

    const facts5 = withAbilities({});
    facts5.classes = [{ classId: 'core-mini:class/druid', level: 5 }];
    const wildShape5 = deriveAll(facts5).resources.resources.find((r) => r.id === 'wild-shape')!;
    expect(wildShape5.max.value).toBe(2); // 1 + floor(5/4)
  });

  it('overlays used from facts.resourcesUsed and passes through name/reset/display/source', () => {
    const facts = withAbilities({});
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 1 }]; // grants second-wind (max: "2")
    facts.resourcesUsed = { 'second-wind': 1 };
    const { resources } = deriveAll(facts);

    const secondWind = resources.resources.find((r) => r.id === 'second-wind')!;
    expect(secondWind.name).toBe('Second Wind');
    expect(secondWind.max.value).toBe(2);
    expect(secondWind.used).toBe(1);
    expect(secondWind.reset).toBe('shortRest');
    expect(secondWind.display).toBe('pips');
    expect(secondWind.source).toBe('core-mini:feature/second-wind');
  });

  it('defaults used to 0 when facts carries no entry for the resource', () => {
    const facts = withAbilities({});
    facts.classes = [{ classId: 'core-mini:class/druid', level: 1 }];
    const wildShape = deriveAll(facts).resources.resources.find((r) => r.id === 'wild-shape')!;
    expect(wildShape.used).toBe(0);
  });

  it('produces no resources for a character with no active resource.define effect', () => {
    const facts = withAbilities({});
    const { resources } = deriveAll(facts);
    expect(resources.resources).toEqual([]);
    expect(resources.issues).toEqual([]);
  });
});

describe('deriveActions', () => {
  it('derives an action with its resource linkage', () => {
    const facts = withAbilities({});
    facts.classes = [{ classId: 'core-mini:class/druid', level: 1 }];
    const { actions } = deriveAll(facts);

    const wildShape = actions.actions.find((a) => a.id === 'wild-shape')!;
    expect(wildShape).toBeDefined();
    expect(wildShape.name).toBe('Wild Shape');
    expect(wildShape.kind).toBe('action');
    expect(wildShape.description).toBe('Transform into a beast.');
    expect(wildShape.resource).toBe('wild-shape');
    expect(wildShape.source).toBe('core-mini:feature/wild-shape');
  });

  it('derives an action with no resource field when the effect declares none', () => {
    const facts = withAbilities({});
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 2 }]; // grants action-surge (no `resource`)
    const { actions } = deriveAll(facts);

    const actionSurge = actions.actions.find((a) => a.id === 'action-surge')!;
    expect(actionSurge).toBeDefined();
    expect(actionSurge.resource).toBeUndefined();
  });

  it('produces no actions for a character with no active action.define effect', () => {
    const facts = withAbilities({});
    const { actions } = deriveAll(facts);
    expect(actions.actions).toEqual([]);
  });

  it('is deterministic across repeated derivations of the same facts', () => {
    const facts = withAbilities({});
    facts.classes = [
      { classId: 'core-mini:class/fighter', level: 2 },
      { classId: 'core-mini:class/druid', level: 1 },
    ];
    const r1 = deriveAll(facts).actions;
    const r2 = deriveAll(facts).actions;
    expect(r1).toEqual(r2);
  });
});
