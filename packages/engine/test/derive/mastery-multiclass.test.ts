import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 14 task 4 (ruling 7, OWNER-FLAG): the vendored multiclassing rules (Rule.json
// srd-2024_multiclassing_class-features: "Special rules apply to Extra Attack, Spellcasting, and
// features (such as Unarmored Defense) that give you alternative ways to calculate your Armor
// Class.") say nothing about Weapon Mastery. PHB-sourced ruling: `sheet.masteryCount` is the MAX
// over the active `mastery.grant` counts (not their sum), and the selections of EVERY
// `weapon-masteries` choice are honored in class order (`facts.classes[]`, order gained; each
// decision in its recorded order; a weapon picked twice counts once) up to that cap. A selection
// beyond the cap is silently not applied (no diagnostic): each choice's own decision stays
// individually valid against its own count. Real pack: fighter count row-extra 3 -> 4 at fighter
// level 4 (`fighter-weapon-mastery-count`), barbarian 2 below barbarian level 4.

const P = 'srd-5e-2024';
const fighter = `${P}:class/fighter`;
const barbarian = `${P}:class/barbarian`;
const item = (slug: string) => `${P}:item/${slug}`;
const WEAPONS = ['longsword', 'greatsword', 'handaxe', 'javelin', 'greataxe', 'maul'];

const index = createContentIndex([loadDistPack(P)]);
const rules: SystemRules = { restRules: index.system().restRules, hpRules: index.system().hpRules };
let seq = 0;
const ev = (type: string, payload: unknown): Event => {
  seq += 1;
  return {
    id: `018f7000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    stream: 'char:11111111-1111-7111-8111-111111111111',
    seq,
    ts: '2026-10-18T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const decide = (choiceId: string, selection: string[]) => ev('decision.made', { choiceId, selection });

/** Human Soldier, `classes` gained in order (each to its level), the six mastery weapons equipped. */
function char(classes: [string, number][], decisions: [string, string[]][]): Event[] {
  seq = 0;
  return [
    ev('character.created', {
      name: 'Brakka',
      system: '5e-2024',
      corePack: { id: P, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'feminine',
    }),
    decide(`${P}:system/5e-2024@0/species`, [`${P}:species/human`]),
    decide(`${P}:system/5e-2024@0/background`, [`${P}:background/soldier`]),
    decide(`${P}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
    decide(`${P}:system/5e-2024@0/ability-scores`, ['str:15', 'con:14', 'dex:13', 'wis:12', 'int:10', 'cha:8']),
    ...classes.flatMap(([classId, level]) =>
      Array.from({ length: level }, (_, i) =>
        ev('level.gained', { classId, level: i + 1, ...(i > 0 ? { hpRoll: 'average' } : {}) }),
      ),
    ),
    ...decisions.map(([c, s]) => decide(c, s)),
    ...WEAPONS.flatMap((slug, i) => {
      const instanceId = `22222222-2222-7222-8222-${String(i + 1).padStart(12, '0')}`;
      return [ev('item.added', { instanceId, itemId: item(slug), qty: 1 }), ev('item.equipped', { instanceId })];
    }),
  ];
}
const sheetOf = (evs: Event[]) => derive(reduce(evs, undefined, rules), index, rules);
/** weapon slug -> its row's surfaced mastery property (only the weapons whose mastery is honored). */
const honored = (evs: Event[]) =>
  sheetOf(evs)
    .attacks.filter((a) => a.mastery !== undefined)
    .map((a) => a.itemId.slice(`${P}:item/`.length))
    .sort();

const FIGHTER_MASTERIES = `${fighter}@1/weapon-masteries`;
const BARBARIAN_MASTERIES = `${barbarian}@1/weapon-masteries`;

describe('multiclass weapon mastery (plan 14 task 4, ruling 7 owner-flag)', () => {
  it('fighter 5 / barbarian 3: masteryCount is the max of the grants (4 = max(4, 2)), not their sum', () => {
    const s = sheetOf(
      char(
        [
          [fighter, 5],
          [barbarian, 3],
        ],
        [],
      ),
    );
    expect(s.masteryCount).toBe(4);
  });

  it('honors both classes’ choices in class order up to the cap; the selection beyond it is not applied', () => {
    // A fighter decision recorded at fighter 1-3 (3 picks; the count has since grown to 4) plus the
    // barbarian's 2 picks: fighter's 3, then the barbarian's FIRST, fill the 4 slots.
    const evs = char(
      [
        [fighter, 5],
        [barbarian, 3],
      ],
      [
        [FIGHTER_MASTERIES, [item('longsword'), item('greatsword'), item('handaxe')]],
        [BARBARIAN_MASTERIES, [item('greataxe'), item('maul')]],
      ],
    );
    expect(honored(evs)).toEqual(['greataxe', 'greatsword', 'handaxe', 'longsword']);
    const maul = sheetOf(evs).attacks.find((a) => a.itemId === item('maul'))!;
    expect(maul.mastery).toBeUndefined(); // the 5th selection: beyond the cap, silently not applied
    expect(sheetOf(evs).issues.map((d) => d.code)).not.toContain('selection.count');
  });

  it('class order, not choice id: barbarian first -> its picks fill the slots before the fighter’s', () => {
    const evs = char(
      [
        [barbarian, 3],
        [fighter, 5],
      ],
      [
        [FIGHTER_MASTERIES, [item('longsword'), item('greatsword'), item('handaxe'), item('javelin')]],
        [BARBARIAN_MASTERIES, [item('greataxe'), item('maul')]],
      ],
    );
    expect(sheetOf(evs).masteryCount).toBe(4);
    expect(honored(evs)).toEqual(['greataxe', 'greatsword', 'longsword', 'maul']);
  });

  it('a full fighter decision fills the cap: the barbarian’s picks are not applied', () => {
    const evs = char(
      [
        [fighter, 5],
        [barbarian, 3],
      ],
      [
        [FIGHTER_MASTERIES, [item('longsword'), item('greatsword'), item('handaxe'), item('javelin')]],
        [BARBARIAN_MASTERIES, [item('greataxe'), item('maul')]],
      ],
    );
    expect(honored(evs)).toEqual(['greatsword', 'handaxe', 'javelin', 'longsword']);
  });

  it('a weapon picked by both classes counts once (does not consume a second slot)', () => {
    const evs = char(
      [
        [fighter, 5],
        [barbarian, 3],
      ],
      [
        [FIGHTER_MASTERIES, [item('longsword'), item('greatsword'), item('handaxe')]],
        [BARBARIAN_MASTERIES, [item('longsword'), item('maul')]],
      ],
    );
    expect(honored(evs)).toEqual(['greatsword', 'handaxe', 'longsword', 'maul']);
  });

  it('single class is unchanged: fighter 5 alone keeps count 4 and all four picks', () => {
    const evs = char(
      [[fighter, 5]],
      [[FIGHTER_MASTERIES, [item('longsword'), item('greatsword'), item('handaxe'), item('javelin')]]],
    );
    expect(sheetOf(evs).masteryCount).toBe(4);
    expect(honored(evs)).toEqual(['greatsword', 'handaxe', 'javelin', 'longsword']);
  });
});
