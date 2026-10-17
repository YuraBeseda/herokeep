import { abilitiesPickOptions, createContentIndex, derive, findChoice, reduce, validateSelection } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

// Plan 13 task 3 retrofits, over the real built pack:
// - Font of Inspiration (vendored ClassFeature/ClassFeatureItem srd-2024_bard_font-of-inspiration,
//   level 5: "You now regain all your expended uses of Bardic Inspiration when you finish a Short or
//   Long Rest.") -> a second `bardic-inspiration` resource.define with reset shortRest, overriding
//   the level-1 longRest (engine: reset is last-wins per id). The spell-slot-to-use conversion
//   ("In addition, you can expend a spell slot ...") stays text.
// - Grappler (vendored Feat srd-2024_grappler; FeatBenefit srd-2024_grappler_1 "Increase your
//   Strength or Dexterity score by 1, to a maximum of 20.") -> an abilities pick restricted with
//   `from: ['str', 'dex']`. Punch and Grab / Attack Advantage / Fast Wrestler (_2.._4) stay text.

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

/** A single-class character (Human, Soldier, STR 17 / DEX 14 after the background) at `level`. */
function char(classId: string, level: number, extra: [string, string[]][] = []): Event[] {
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
    decide(`${FP}:system/5e-2024@0/ability-scores`, ['str:15', 'dex:14', 'con:13', 'int:10', 'wis:10', 'cha:12']),
    ...Array.from({ length: level }, (_, i) => ev('level.gained', { classId, level: i + 1, hpRoll: 'average' })),
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const factsOf = (events: Event[]) => reduce(events, undefined, rules);
const sheetOf = (events: Event[], idx = index) => derive(factsOf(events), idx, rules);

const bardId = `${FP}:class/bard`;
const fontId = `${FP}:feature/bard-font-of-inspiration`;
const fighterId = `${FP}:class/fighter`;
const grappler = `${FP}:feat/grappler`;
const grapplerPick = `${grappler}@4/ability-score`;

describe('Font of Inspiration (bard 5): Bardic Inspiration regains on a Short Rest', () => {
  const pool = (level: number) => sheetOf(char(bardId, level)).resources.find((r) => r.id === 'bardic-inspiration');

  it('reset is longRest at bard 1-4 and shortRest from bard 5 (srd-2024_bard_font-of-inspiration, level 5)', () => {
    for (const level of [1, 4]) expect(pool(level)?.reset, `level ${level}`).toBe('longRest');
    for (const level of [5, 11, 20]) expect(pool(level)?.reset, `level ${level}`).toBe('shortRest');
  });

  it('max, name, display and source are unchanged by the override define', () => {
    const at4 = pool(4)!;
    const at5 = pool(5)!;
    expect(at5.max.value).toBe(at4.max.value); // CHA 12 -> +1
    expect({ name: at5.name, display: at5.display, source: at5.source }).toEqual({
      name: at4.name,
      display: at4.display,
      source: `${FP}:feature/bard-bardic-inspiration`,
    });
  });

  it('the override define sorts after the original in derive order (the last-wins precondition)', () => {
    expect(fontId > `${FP}:feature/bard-bardic-inspiration`).toBe(true);
  });

  it('the spell-slot conversion clause stays text; the hand-tracking flag is gone', () => {
    const font = index.get(fontId)!;
    const text = font.effects.find((e) => e.type === 'feature.text');
    expect(text && 'description' in text ? text.description : '').toContain('expend a spell slot');
    expect(JSON.stringify(font.effects)).not.toContain('by hand');
    expect(font.effects).toContainEqual(
      expect.objectContaining({ type: 'resource.define', id: 'bardic-inspiration', reset: 'shortRest' }),
    );
  });
});

describe('Grappler: +1 Strength or Dexterity (srd-2024_grappler_1)', () => {
  const withGrappler = (extra: [string, string[]][] = []) =>
    char(fighterId, 4, [[`${fighterId}@4/feat`, [grappler]], ...extra]);

  it('offers exactly Strength and Dexterity', () => {
    const found = findChoice(index, grapplerPick)!;
    const pick = found.choice.pick;
    if (!('abilities' in pick)) throw new Error('expected an abilities pick');
    expect(pick.abilities).toEqual({ count: 1, max: 20, improve: '+1', from: ['str', 'dex'] });
    expect(abilitiesPickOptions(pick, found.owner, index)).toEqual(['str', 'dex']);
  });

  it('is outstanding once the feat is taken; the +1 lands on the chosen score', () => {
    const before = sheetOf(withGrappler());
    expect(before.outstandingChoices.map((c) => c.choiceId)).toContain(grapplerPick);
    const after = sheetOf(withGrappler([[grapplerPick, ['dex:+1']]]));
    expect(after.outstandingChoices.map((c) => c.choiceId)).not.toContain(grapplerPick);
    expect(after.abilities['dex']!.score.value).toBe(before.abilities['dex']!.score.value + 1);
  });

  it('refuses any other ability; accepts Strength', () => {
    const facts = factsOf(withGrappler());
    const sheet = derive(facts, index, rules);
    const codes = (sel: string[]) => validateSelection(sheet, facts, index, grapplerPick, sel).map((d) => d.code);
    expect(codes(['con:+1'])).toEqual(['selection.abilityNotAllowed']);
    expect(codes(['str:+1'])).toEqual([]);
  });

  it('the other three benefits stay text; the ASI paragraph is gone from it', () => {
    const effects = index.get(grappler)!.effects;
    const text = JSON.stringify(effects.filter((e) => e.type === 'feature.text'));
    for (const benefit of ['Punch and Grab', 'Attack Advantage', 'Fast Wrestler']) expect(text).toContain(benefit);
    expect(text).not.toContain('Ability Score Increase');
  });
});

// Legacy stability: a log recorded against the pre-task-3 pack (Font of Inspiration text-only,
// Grappler without its pick) replays identically apart from the intended changes — never invalid.
describe('legacy logs replay identically apart from the retrofit', () => {
  const legacyPack = structuredClone(pack);
  for (const e of legacyPack.entities) {
    if (e.id === fontId) e.effects = e.effects.filter((x) => x.type !== 'resource.define');
    if (e.id === grappler) e.choices = [];
  }
  const legacyIndex = createContentIndex([legacyPack]);

  it('bard 11: only the Bardic Inspiration reset moves (longRest -> shortRest)', () => {
    const events = char(bardId, 11);
    const now = sheetOf(events);
    const before = sheetOf(events, legacyIndex);
    expect(before.resources.find((r) => r.id === 'bardic-inspiration')?.reset).toBe('longRest');
    const normalized = {
      ...now,
      resources: now.resources.map((r) =>
        r.id === 'bardic-inspiration'
          ? { ...r, reset: 'longRest', max: { ...r.max, contributions: r.max.contributions.slice(0, 1) } }
          : r,
      ),
    };
    expect(normalized).toEqual(before);
    expect(now.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('fighter 4 with Grappler: only the new outstanding ability pick is added', () => {
    const events = char(fighterId, 4, [[`${fighterId}@4/feat`, [grappler]]]);
    const now = sheetOf(events);
    const before = sheetOf(events, legacyIndex);
    const added = now.outstandingChoices.filter(
      (c) => !before.outstandingChoices.some((o) => o.choiceId === c.choiceId),
    );
    expect(added.map((c) => c.choiceId)).toEqual([grapplerPick]);
    expect({ ...now, outstandingChoices: now.outstandingChoices.filter((c) => c.choiceId !== grapplerPick) }).toEqual(
      before,
    );
    expect(now.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
