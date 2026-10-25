import { type Event, type Pack, parseEvent } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { type ContentIndex, createContentIndex } from '../../src/content/index.ts';
import { masteryOfferCount } from '../../src/derive/attacks.ts';
import { compose } from '../../src/derive/composition.ts';
import { derive, outstandingChoices, pendingAdvancements, validateSelection } from '../../src/derive/index.ts';
import type { Facts, SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack, loadGoldens } from '../support/golden.ts';

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

// --- Plan 16 Task 6 ----------------------------------------------------------------------------

/** The SRD pack with its system's `multiclass.masteryCount` set to `rule` (or removed). */
function indexWithRule(rule: 'max' | 'sum' | undefined): ContentIndex {
  const pack: Pack = structuredClone(loadDistPack(P));
  const system = pack.entities.find((e) => e.type === 'system');
  if (system?.type !== 'system' || !system.multiclass) throw new Error('SRD system has no multiclass data');
  if (rule === undefined) delete system.multiclass.masteryCount;
  else system.multiclass.masteryCount = rule;
  return createContentIndex([pack]);
}
const factsOf = (evs: Event[]) => reduce(evs, undefined, rules);
const offerOf = (choiceId: string, facts: Facts, idx: ContentIndex = index) =>
  masteryOfferCount(choiceId, facts, compose(facts, idx), idx);
const requestFor = (choiceId: string, facts: Facts, idx: ContentIndex = index) =>
  outstandingChoices(facts, idx).find((r) => r.choiceId === choiceId);
const FIGHTER_FOUR: [string, string[]] = [
  FIGHTER_MASTERIES,
  [item('longsword'), item('greatsword'), item('handaxe'), item('javelin')],
];
const BARBARIAN_TWO: [string, string[]] = [BARBARIAN_MASTERIES, [item('greataxe'), item('maul')]];

describe('the multiclass mastery combine rule is pack data (plan 16 ruling 9)', () => {
  it("'sum': fighter 5 / barbarian 3 knows 6 = 4 + 2, and both classes' picks are all honored", () => {
    const sum = indexWithRule('sum');
    const facts = factsOf(
      char(
        [
          [fighter, 5],
          [barbarian, 3],
        ],
        [FIGHTER_FOUR, BARBARIAN_TWO],
      ),
    );
    const sheet = derive(facts, sum, rules);
    expect(sheet.masteryCount).toBe(6);
    expect(sheet.attacks.filter((a) => a.mastery !== undefined)).toHaveLength(6);
  });

  it("an absent rule is 'max' (today's behavior): 4 = max(4, 2)", () => {
    const facts = factsOf(
      char(
        [
          [fighter, 5],
          [barbarian, 3],
        ],
        [],
      ),
    );
    expect(derive(facts, indexWithRule(undefined), rules).masteryCount).toBe(4);
    expect(derive(facts, indexWithRule('max'), rules).masteryCount).toBe(4);
  });
});

describe('shared-cap-aware mastery offers (plan 16 ruling 10)', () => {
  const fighterThenBarbarian = (decisions: [string, string[]][]) =>
    factsOf(
      char(
        [
          [fighter, 5],
          [barbarian, 3],
        ],
        decisions,
      ),
    );

  it("the initial class's choice and any non-mastery choice have no override", () => {
    const facts = fighterThenBarbarian([FIGHTER_FOUR]);
    expect(offerOf(FIGHTER_MASTERIES, facts)).toBeUndefined();
    expect(offerOf(`${barbarian}@3/subclass`, facts)).toBeUndefined();
  });

  it("'max': a later class is offered cap − the earlier classes' honored picks; 0 → not offered", () => {
    const facts = fighterThenBarbarian([FIGHTER_FOUR]);
    expect(offerOf(BARBARIAN_MASTERIES, facts)).toBe(0);
    expect(requestFor(BARBARIAN_MASTERIES, facts)).toBeUndefined();
    // Not offered, so any selection is over its count of 0.
    const codes = validateSelection(derive(facts, index, rules), facts, index, BARBARIAN_MASTERIES, [
      item('greataxe'),
    ]).map((d) => d.code);
    expect(codes).toContain('selection.count');
  });

  it("'max': barbarian first (2 picks) → the later fighter is offered 4 − 2 = 2, validated at 2", () => {
    const facts = factsOf(
      char(
        [
          [barbarian, 3],
          [fighter, 5],
        ],
        [BARBARIAN_TWO],
      ),
    );
    expect(offerOf(FIGHTER_MASTERIES, facts)).toBe(2);
    expect(requestFor(FIGHTER_MASTERIES, facts)).toEqual({
      choiceId: FIGHTER_MASTERIES,
      ownerId: fighter,
      count: 2,
    });
    const sheet = derive(facts, index, rules);
    const countCodes = (selection: string[]) =>
      validateSelection(sheet, facts, index, FIGHTER_MASTERIES, selection)
        .map((d) => d.code)
        .filter((c) => c === 'selection.count');
    expect(countCodes([item('longsword'), item('greatsword')])).toEqual([]);
    expect(countCodes(FIGHTER_FOUR[1])).toEqual(['selection.count']);
  });

  it("'sum': the later class keeps its own count (never more): 2 = min(2, 6 − 4)", () => {
    const sum = indexWithRule('sum');
    const facts = fighterThenBarbarian([FIGHTER_FOUR]);
    expect(offerOf(BARBARIAN_MASTERIES, facts, sum)).toBe(2);
    expect(requestFor(BARBARIAN_MASTERIES, facts, sum)?.count).toBe(2);
  });

  it('a later class is never offered more than its own count, even with the earlier picks missing', () => {
    expect(offerOf(BARBARIAN_MASTERIES, fighterThenBarbarian([]))).toBe(2);
  });

  it('recorded decisions keep granting up to the cap exactly as before (an over-offer pick stays honored)', () => {
    // Fighter's 3 picks leave 1 slot: the barbarian is offered 1, yet its recorded 2-pick decision
    // still fills that slot with its first pick — and is not re-asked.
    const facts = fighterThenBarbarian([
      [FIGHTER_MASTERIES, [item('longsword'), item('greatsword'), item('handaxe')]],
      BARBARIAN_TWO,
    ]);
    expect(offerOf(BARBARIAN_MASTERIES, facts)).toBe(1);
    expect(requestFor(BARBARIAN_MASTERIES, facts)).toBeUndefined();
    const sheet = derive(facts, index, rules);
    expect(sheet.attacks.filter((a) => a.mastery !== undefined).map((a) => a.itemId)).toHaveLength(4);
    expect(sheet.attacks.find((a) => a.itemId === item('greataxe'))?.mastery).toBe('cleave');
    expect(sheet.attacks.find((a) => a.itemId === item('maul'))?.mastery).toBeUndefined();
  });

  it('level-up: multiclassing into barbarian after 4 fighter picks asks no weapon-masteries step', () => {
    const evs = [...char([[fighter, 5]], [FIGHTER_FOUR]), ev('xp.awarded', { amount: 100_000 })];
    const facts = factsOf(evs);
    const entry = pendingAdvancements(derive(facts, index, rules), facts, index).find((a) => a.classId === barbarian);
    expect(entry?.isNewClass).toBe(true);
    expect(entry?.steps.map((s) => s.choiceId)).not.toContain(BARBARIAN_MASTERIES);
  });

  it('level-up: multiclassing into fighter after 2 barbarian picks asks for 3 − 2 = 1', () => {
    const evs = [...char([[barbarian, 3]], [BARBARIAN_TWO]), ev('xp.awarded', { amount: 100_000 })];
    const facts = factsOf(evs);
    const entry = pendingAdvancements(derive(facts, index, rules), facts, index).find((a) => a.classId === fighter);
    expect(entry?.steps.find((s) => s.choiceId === FIGHTER_MASTERIES)).toEqual({
      choiceId: FIGHTER_MASTERIES,
      ownerId: fighter,
      count: 1,
    });
  });

  // The golden harness pins `expect` paths only (no outstanding-choices serialization), so the
  // multi-fighter5-barbarian3-mastery offer count is pinned here, on the golden's own events.
  it('the multi-fighter5-barbarian3-mastery golden: the barbarian is offered 4 − 3 = 1', () => {
    const golden = loadGoldens().find((g) => g.name === 'multi-fighter5-barbarian3-mastery')!;
    const events = golden.events.map((e) => {
      const r = parseEvent(e);
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      return r.event;
    });
    const facts = factsOf(events);
    expect(offerOf(BARBARIAN_MASTERIES, facts)).toBe(1);
    // Its recorded 2-pick decision is not re-asked; the fighter's grown count (3 → 4) still is.
    expect(requestFor(BARBARIAN_MASTERIES, facts)).toBeUndefined();
    expect(requestFor(FIGHTER_MASTERIES, facts)?.count).toBe(4);
    // Without the barbarian decision, it is asked for 1.
    const undecided = factsOf(
      events.filter(
        (e) => !(e.type === 'decision.made' && (e.payload as { choiceId: string }).choiceId === BARBARIAN_MASTERIES),
      ),
    );
    expect(requestFor(BARBARIAN_MASTERIES, undecided)).toEqual({
      choiceId: BARBARIAN_MASTERIES,
      ownerId: barbarian,
      count: 1,
    });
  });
});
