import { createContentIndex, derive, reduce } from '@hk/engine';
import type { Effect, Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

// Plan 13 task 5 retrofits over the real built pack (vendored sources, packages/content/upstream/
// open5e-srd-2024/):
// - Monk Unarmored Movement (ClassFeature srd-2024_monk_unarmored-movement; ClassFeatureItem column
//   srd-2024_monk_unarmored-movement_<L>: +10 ft. at 2-5, +15 at 6-9, +20 at 10-13, +25 at 14-17,
//   +30 at 18-20): the five stepped speed.bonus increments become ONE formula row with identical totals.
// - Ranger Roving (srd-2024_ranger_roving): "Your Speed increases by 10 feet while you aren't wearing
//   Heavy armor. You also have a Climb Speed and a Swim Speed equal to your Speed." -> climb/swim
//   speed.bonus 'speed(walk)'.
// - Paladin Aura of Courage (srd-2024_paladin_aura-of-courage) / Aura of Devotion
//   (srd-2024_paladin_oath-of-devotion_aura-of-devotion): "You and your allies have Immunity to the
//   Frightened [Charmed] condition while in your Aura of Protection." -> SELF part as condition.immunity,
//   gated like Aura of Protection ("The aura is inactive while you have the Incapacitated condition");
//   the ally part stays in the carried description.
// - Mindless Rage (srd-2024_path-of-the-berserker_mindless-rage): immunity only "while your Rage is
//   active" — no raging fact exists, so it stays text (an ungated immunity would be state-wrong).

const FP = 'srd-5e-2024';
const pack = buildPack();
const index = createContentIndex([pack]);
const rules = { restRules: index.system().restRules, hpRules: index.system().hpRules };

let seq = 0;
const ev = (type: string, payload: unknown): Event => {
  seq += 1;
  return {
    id: `018f7000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    stream: 'char:11111111-1111-7111-8111-111111111111',
    seq,
    ts: '2026-10-17T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const decide = (choiceId: string, selection: string[]) => ev('decision.made', { choiceId, selection });

/** A single-class character (Human, Soldier) at `level`, taking `subclassId` at level 3. */
function char(classId: string, level: number, subclassId?: string): Event[] {
  seq = 0;
  return [
    ev('character.created', {
      name: 'Lark',
      system: '5e-2024',
      corePack: { id: FP, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'feminine',
    }),
    decide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
    decide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
    decide(`${FP}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
    decide(`${FP}:system/5e-2024@0/ability-scores`, ['str:10', 'dex:15', 'con:13', 'int:10', 'wis:14', 'cha:12']),
    ...Array.from({ length: level }, (_, i) =>
      ev('level.gained', {
        classId,
        level: i + 1,
        hpRoll: 'average',
        ...(i + 1 === 3 && subclassId ? { subclassId } : {}),
      }),
    ),
  ];
}
/** Derives the character, wearing `items` (pack item slugs) and under `conditions` (condition slugs). */
function sheet(events: Event[], items: string[] = [], conditions: string[] = []) {
  const facts = reduce(events, undefined, rules);
  facts.inventory = items.map((s, i) => ({
    instanceId: `i${i}`,
    itemId: `${FP}:item/${s}`,
    qty: 1,
    equipped: true,
    attuned: false,
  }));
  facts.conditions = conditions.map((c) => ({ conditionId: `${FP}:condition/${c}`, sinceEventId: 'e' }));
  return derive(facts, index, rules);
}
const effectsOf = (slug: string): Effect[] => {
  const e = index.get(`${FP}:feature/${slug}`);
  if (e?.type !== 'feature') throw new Error(`no feature ${slug}`);
  return e.effects;
};

const monk = `${FP}:class/monk`;
const ranger = `${FP}:class/ranger`;
const paladin = `${FP}:class/paladin`;
const barbarian = `${FP}:class/barbarian`;
const devotion = `${FP}:subclass/oath-of-devotion`;
const berserker = `${FP}:subclass/path-of-the-berserker`;
const cond = (slug: string) => `${FP}:condition/${slug}`;

describe('Monk Unarmored Movement: one scaling formula row', () => {
  // vendored column: none at 1, +10 (2-5), +15 (6-9), +20 (10-13), +25 (14-17), +30 (18-20)
  const column = (l: number) => (l < 2 ? 0 : l < 6 ? 10 : l < 10 ? 15 : l < 14 ? 20 : l < 18 ? 25 : 30);

  it('is a single speed.bonus formula, gated on no armor, no shield and Monk level 2', () => {
    const rows = effectsOf('monk-unarmored-movement').filter((e) => e.type === 'speed.bonus');
    expect(rows).toEqual([
      {
        type: 'speed.bonus',
        mode: 'walk',
        value: '10 + 5 * floor((classLevel(monk) - 2) / 4)',
        key: 'monk-unarmored-movement',
        when: {
          all: [{ armor: { category: ['none'] } }, { shield: false }, { classLevel: { monk: { gte: 2 } } }],
        },
      },
    ]);
  });

  it('reproduces the vendored column at every Monk level 1-20 (species Speed 30)', () => {
    for (let l = 1; l <= 20; l++) expect(sheet(char(monk, l)).speed['walk']!.value, `level ${l}`).toBe(30 + column(l));
  });

  it('is suppressed by armor and by a shield alone', () => {
    expect(sheet(char(monk, 10)).speed['walk']!.value).toBe(50);
    expect(sheet(char(monk, 10), ['chain-mail']).speed['walk']!.value).toBe(30);
    expect(sheet(char(monk, 10), ['shield']).speed['walk']!.value).toBe(30);
  });
});

describe('Ranger Roving: Climb and Swim Speed equal to your Speed', () => {
  it('none before level 6', () => {
    expect(Object.keys(sheet(char(ranger, 5)).speed)).toEqual(['walk']);
  });

  it('from level 6: walk 40 (+10 out of Heavy armor), climb and swim equal to it', () => {
    const s = sheet(char(ranger, 6)).speed;
    expect(Object.keys(s)).toEqual(['climb', 'swim', 'walk']);
    expect([s['walk']!.value, s['climb']!.value, s['swim']!.value]).toEqual([40, 40, 40]);
  });

  it('in Heavy armor the walk bonus lapses and climb/swim follow the walk Speed down', () => {
    const s = sheet(char(ranger, 6), ['chain-mail']).speed;
    expect([s['walk']!.value, s['climb']!.value, s['swim']!.value]).toEqual([30, 30, 30]);
  });

  it('Roving is fully mechanized: no feature.text remains', () => {
    expect(effectsOf('ranger-roving').some((e) => e.type === 'feature.text')).toBe(false);
  });
});

describe('condition immunities on the sheet', () => {
  it('Aura of Courage (Paladin 10): Frightened, from the feature; absent before level 10', () => {
    expect(sheet(char(paladin, 9)).immunities).toBeUndefined();
    expect(sheet(char(paladin, 10)).immunities).toEqual([
      { condition: cond('frightened'), sources: [`${FP}:feature/paladin-aura-of-courage`] },
    ]);
  });

  it('Aura of Devotion (Oath of Devotion, Paladin 7): Charmed; both auras at 10', () => {
    expect(sheet(char(paladin, 6, devotion)).immunities).toBeUndefined();
    expect(sheet(char(paladin, 7, devotion)).immunities).toEqual([
      { condition: cond('charmed'), sources: [`${FP}:feature/paladin-oath-of-devotion-aura-of-devotion`] },
    ]);
    expect(sheet(char(paladin, 10, devotion)).immunities?.map((i) => i.condition)).toEqual([
      cond('charmed'),
      cond('frightened'),
    ]);
  });

  it('the auras are inactive while Incapacitated (same gate as Aura of Protection)', () => {
    expect(sheet(char(paladin, 10, devotion), [], ['incapacitated']).immunities).toBeUndefined();
  });

  it('Mindless Rage stays text: no ungated immunity while not raging', () => {
    expect(effectsOf('path-of-the-berserker-mindless-rage').some((e) => e.type === 'condition.immunity')).toBe(false);
    expect(sheet(char(barbarian, 6, berserker)).immunities).toBeUndefined();
  });
});
