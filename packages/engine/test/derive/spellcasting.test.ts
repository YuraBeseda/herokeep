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

// `slots-mini` (phase 4 plan 11 task 3): system-entity overrides adding `spellSlots.half/third/pact`
// and `tables.multiclassSlots`, plus fixture classes exercising each progression — see
// packages/protocol/test/fixtures/packs/slots-mini.json for the exact tables (the `multiclassSlots`
// table is the real 2024 SRD Multiclass Spellcaster table, verbatim).
const slotsIndex = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('slots-mini')]);

const withAbilitiesSlots = (overrides: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>) => {
  const facts = baseFacts();
  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides };
  facts.decisions['core-mini:system/mini@0/ability-scores'] = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(
    (a) => `${a}:${scores[a]}`,
  );
  return facts;
};

const deriveSlots = (facts: ReturnType<typeof baseFacts>) => {
  const comp = compose(facts, slotsIndex);
  const abilities = deriveAbilities(facts, comp, slotsIndex);
  return { comp, abilities, spellcasting: deriveSpellcasting(abilities, comp, facts, slotsIndex) };
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

describe('deriveSpellcasting: slot progressions + multiclass table (phase 4 plan 11 task 3, ruling 2)', () => {
  it("reads a half-caster's own per-class slot table when it is the only spellcasting class", () => {
    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: 'slots-mini:class/paladin', level: 4 }];
    const { spellcasting } = deriveSlots(facts);

    expect(spellcasting.blocks).toHaveLength(1);
    expect(spellcasting.blocks[0]!.slots).toEqual([{ level: 1, max: 3, used: 0 }]);
    expect(spellcasting.blocks[0]!.pact).toBeUndefined();
  });

  it("reads a third-caster's own per-class slot table when it is the only spellcasting class", () => {
    const facts = withAbilitiesSlots({ int: 16 });
    facts.classes = [{ classId: 'slots-mini:class/arcane-trickster', level: 3 }];
    const { spellcasting } = deriveSlots(facts);

    expect(spellcasting.blocks).toHaveLength(1);
    expect(spellcasting.blocks[0]!.slots).toEqual([{ level: 1, max: 2, used: 0 }]);
  });

  it('a pact caster gets level+count from system.tables.spellSlots.pact and used from facts.pactSlots (never facts.slotsUsed)', () => {
    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: 'slots-mini:class/warlock', level: 5 }];
    facts.pactSlots = { used: 1 };
    facts.slotsUsed = { 3: 9 }; // a decoy regular-slot entry at the SAME spell level — must not leak into `pact`
    const { spellcasting } = deriveSlots(facts);

    expect(spellcasting.blocks).toHaveLength(1);
    expect(spellcasting.blocks[0]!.slots).toEqual([]);
    expect(spellcasting.blocks[0]!.pact).toEqual({ level: 3, count: 2, used: 1 });
  });

  it('a level 1 warlock has one level-1 pact slot', () => {
    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: 'slots-mini:class/warlock', level: 1 }];
    const { spellcasting } = deriveSlots(facts);

    expect(spellcasting.blocks[0]!.pact).toEqual({ level: 1, count: 1, used: 0 });
  });

  it(
    'combines two full-caster classes at their SUMMED level on system.tables.multiclassSlots, ' +
      'overriding both blocks’ own per-class tables identically (a pooled resource)',
    () => {
      const facts = withAbilitiesSlots({ cha: 16, wis: 16 });
      facts.classes = [
        { classId: 'slots-mini:class/sorcerer', level: 3 }, // solo full[2] would be [4,2]
        { classId: 'slots-mini:class/cleric', level: 2 }, // solo full[1] would be [3]
      ];
      const { spellcasting } = deriveSlots(facts);

      expect(spellcasting.blocks).toHaveLength(2);
      const expectedRow = [
        { level: 1, max: 4, used: 0 },
        { level: 2, max: 3, used: 0 },
        { level: 3, max: 2, used: 0 },
      ];
      // combined caster level = 3 + 2 = 5 -> multiclassSlots.slots[4] = [4,3,2] (SRD table row 5) -
      // NEITHER class's own solo `full` table at its own level is [4,3,2] (see the comments above),
      // so this can only pass if the combined table is actually being used, not either solo table.
      expect(spellcasting.blocks[0]!.slots).toEqual(expectedRow);
      expect(spellcasting.blocks[1]!.slots).toEqual(expectedRow);
    },
  );

  it(
    "combines a full caster and a half caster reproducing the SRD's own worked example " +
      '(Ranger 4 / Sorcerer 3 -> caster level 5 -> 4/3/2 slots), rounding the half-caster UP per class before summing',
    () => {
      const facts = withAbilitiesSlots({ cha: 16, wis: 16 });
      facts.classes = [
        { classId: 'slots-mini:class/paladin', level: 4 }, // half: ceil(4/2) = 2
        { classId: 'slots-mini:class/sorcerer', level: 3 }, // full: floor(3/1) = 3 -> combined level 5
      ];
      const { spellcasting } = deriveSlots(facts);

      const expectedRow = [
        { level: 1, max: 4, used: 0 },
        { level: 2, max: 3, used: 0 },
        { level: 3, max: 2, used: 0 },
      ];
      expect(spellcasting.blocks[0]!.slots).toEqual(expectedRow);
      expect(spellcasting.blocks[1]!.slots).toEqual(expectedRow);
    },
  );

  it(
    'a Fighter/Paladin multiclass with the Spellcasting feature from only ONE class keeps that ' +
      'class\'s own solo table (vendored 2024 SRD, pk srd-2024_multiclassing_spellcasting: "If you ' +
      'multiclass but have the Spellcasting feature from only one class, follow the rules for that class.")',
    () => {
      const facts = withAbilitiesSlots({ cha: 16 });
      facts.classes = [
        { classId: 'core-mini:class/fighter', level: 3 }, // grants no spellcasting.define effect
        { classId: 'slots-mini:class/paladin', level: 1 }, // half[0] = [] (no slots yet at level 1)
      ];
      const { spellcasting } = deriveSlots(facts);

      // If the gate were wrongly `facts.classes.length > 1` instead of "more than one Spellcasting
      // feature", this would wrongly combine to multiclassSlots.slots[0] = [2] (one level-1 slot).
      expect(spellcasting.blocks).toHaveLength(1);
      expect(spellcasting.blocks[0]!.classId).toBe('slots-mini:class/paladin');
      expect(spellcasting.blocks[0]!.slots).toEqual([]);
    },
  );

  it('pools slot usage across combined classes via the single facts.slotsUsed counter (no per-class split)', () => {
    const facts = withAbilitiesSlots({ cha: 16, wis: 16 });
    facts.classes = [
      { classId: 'slots-mini:class/paladin', level: 4 },
      { classId: 'slots-mini:class/sorcerer', level: 3 },
    ];
    facts.slotsUsed = { 1: 2, 3: 1 };
    const { spellcasting } = deriveSlots(facts);

    const expectedRow = [
      { level: 1, max: 4, used: 2 },
      { level: 2, max: 3, used: 0 },
      { level: 3, max: 2, used: 1 },
    ];
    for (const block of spellcasting.blocks) expect(block.slots).toEqual(expectedRow);
  });

  it('cantripsKnown: a class level-row extra wins over the cantripsKnown formula (closes the task-1-report.md fallback gap)', () => {
    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: 'slots-mini:class/sorcerer', level: 1 }];
    const { spellcasting } = deriveSlots(facts);

    // row extra 'sorcerer-cantrips-known' at level 1 is 4; the formula ("2 + floor(classLevel/4)") would give 2 — row wins.
    expect(spellcasting.blocks[0]!.cantripsKnown).toBe(4);
  });

  it('cantripsKnown stays undefined when a class defines neither a row extra nor a cantripsKnown formula', () => {
    const facts = withAbilitiesSlots({ wis: 16 });
    facts.classes = [{ classId: 'slots-mini:class/cleric', level: 1 }];
    const { spellcasting } = deriveSlots(facts);

    expect(spellcasting.blocks[0]!.cantripsKnown).toBeUndefined();
  });

  it('a class defining spellcasting TWICE counts as ONE caster for the combined-table gate (dedupe by classId)', () => {
    const pack = structuredClone(loadFixturePack('slots-mini'));
    const holder = pack.entities.find((e) =>
      e.effects.some((f) => f.type === 'spellcasting.define' && f.class.endsWith('paladin')),
    )!;
    const def = holder.effects.find((f) => f.type === 'spellcasting.define')!;
    holder.effects = [...holder.effects, structuredClone(def)];
    const dupIndex = createContentIndex([loadFixturePack('core-mini'), pack]);

    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: 'slots-mini:class/paladin', level: 4 }];
    const comp = compose(facts, dupIndex);
    const abilities = deriveAbilities(facts, comp, dupIndex);
    const { blocks } = deriveSpellcasting(abilities, comp, facts, dupIndex);

    expect(blocks.length).toBeGreaterThanOrEqual(1);
    // Solo paladin 4 keeps its OWN half-caster row, not the combined multiclass row.
    for (const b of blocks) expect(b.slots).toEqual([{ level: 1, max: 3, used: 0 }]);
  });

  it('is deterministic across repeated derivations of a multiclass combined-table facts object', () => {
    const facts = withAbilitiesSlots({ cha: 16, wis: 16 });
    facts.classes = [
      { classId: 'slots-mini:class/paladin', level: 4 },
      { classId: 'slots-mini:class/sorcerer', level: 3 },
    ];
    const r1 = deriveSlots(facts).spellcasting;
    const r2 = deriveSlots(facts).spellcasting;
    expect(r1).toEqual(r2);
  });
});

describe('deriveSpellcasting: always-prepared spell.grant (phase 4 plan 12 task 3)', () => {
  const OATH = 'core-mini:spell/bless';
  const OTHER = 'core-mini:spell/shield';
  const PALADIN = 'slots-mini:class/paladin';
  const SORCERER = 'slots-mini:class/sorcerer';

  /** slots-mini with `spell.grant`s appended to the named class entity's own effects. */
  const grantIndex = (grants: Record<string, string[]>, alwaysPrepared = true) => {
    const pack = structuredClone(loadFixturePack('slots-mini'));
    for (const [classId, spells] of Object.entries(grants)) {
      const holder = pack.entities.find((e) => e.id === classId)!;
      for (const spell of spells) {
        holder.effects = [...holder.effects, { type: 'spell.grant', spell, alwaysPrepared } as never];
      }
    }
    return createContentIndex([loadFixturePack('core-mini'), pack]);
  };
  const run = (idx: ReturnType<typeof grantIndex>, facts: ReturnType<typeof baseFacts>) => {
    const comp = compose(facts, idx);
    const abilities = deriveAbilities(facts, comp, idx);
    return deriveSpellcasting(abilities, comp, facts, idx).blocks;
  };

  it('an alwaysPrepared grant appears in the granting class block prepared list and in alwaysPrepared', () => {
    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: PALADIN, level: 4 }];
    facts.preparedSpells[PALADIN] = [OTHER];
    const [block] = run(grantIndex({ [PALADIN]: [OATH] }), facts);

    expect(block!.prepared).toEqual([OTHER, OATH]);
    expect(block!.alwaysPrepared).toEqual([OATH]);
  });

  it('does not count against preparedMax (the cap is unchanged; counted = prepared minus alwaysPrepared)', () => {
    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: PALADIN, level: 4 }];
    facts.preparedSpells[PALADIN] = [OTHER];
    const plain = run(grantIndex({}), facts)[0]!;
    const granted = run(grantIndex({ [PALADIN]: [OATH] }), facts)[0]!;

    expect(granted.preparedMax).toBe(plain.preparedMax);
    expect(granted.prepared.length - granted.alwaysPrepared!.length).toBe(plain.prepared.length);
  });

  it('a non-alwaysPrepared spell.grant never touches the prepared list; blocks carry no alwaysPrepared key', () => {
    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: PALADIN, level: 4 }];
    const [block] = run(grantIndex({ [PALADIN]: [OATH] }, false), facts);
    expect(block!.prepared).toEqual([]);
    expect('alwaysPrepared' in block!).toBe(false);
  });

  it('multiclass: the grant binds to the granting class block only', () => {
    const facts = withAbilitiesSlots({ cha: 16, wis: 16 });
    facts.classes = [
      { classId: PALADIN, level: 4 },
      { classId: SORCERER, level: 3 },
    ];
    const blocks = run(grantIndex({ [PALADIN]: [OATH] }), facts);
    const pal = blocks.find((b) => b.classId === PALADIN)!;
    const sor = blocks.find((b) => b.classId === SORCERER)!;

    expect(blocks).toHaveLength(2);
    expect(pal.prepared).toEqual([OATH]);
    expect(sor.prepared).toEqual([]);
    expect(sor.alwaysPrepared).toBeUndefined();
  });

  it('dedupes by spell id within a block (same spell granted twice, or already prepared manually)', () => {
    const facts = withAbilitiesSlots({ cha: 16 });
    facts.classes = [{ classId: PALADIN, level: 4 }];
    facts.preparedSpells[PALADIN] = [OATH];
    const [block] = run(grantIndex({ [PALADIN]: [OATH, OATH] }), facts);

    expect(block!.prepared).toEqual([OATH]);
    expect(block!.alwaysPrepared).toEqual([OATH]);
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
