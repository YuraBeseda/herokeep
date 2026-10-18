import type { Event, Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { findChoice } from '../../src/content/choices.ts';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { queryPickOptions, validateSelection } from '../../src/derive/validation.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 13 task 1: an expertise-capable skill pick (`pick.query{type:'skill'}` + `proficiency:
// 'expertise'` + `requireProficient: true`). Exercised over a clone of the real pack with such a
// pick patched onto the (otherwise unrelated) Alert feat — same harness as skill-pick.test.ts — so
// the mechanism is pinned independently of which SRD classes author it.

const P = 'srd-5e-2024';
const fighter = `${P}:class/fighter`;
const alert = `${P}:feat/alert`;
const pickId = `${alert}@1/test-expertise`;
const skill = (slug: string) => `${P}:skill/${slug}`;

function patchedPack(): Pack {
  const pack = structuredClone(loadDistPack(P));
  const feat = pack.entities.find((e) => e.id === alert) as unknown as { choices: unknown[] };
  feat.choices.push({
    id: pickId,
    prompt: 'Pick an expertise',
    at: { kind: 'level', level: 1 },
    pick: { query: { type: 'skill' }, proficiency: 'expertise', requireProficient: true },
    count: 1,
    unique: true,
    repeatableAt: [],
    prerequisites: [],
  });
  return pack;
}

const index = createContentIndex([patchedPack()]);
const rules: SystemRules = { restRules: index.system().restRules, hpRules: index.system().hpRules };
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

/** Fighter 4 (prof +2), Soldier (athletics + intimidation proficient), STR 17 (mod +3), Alert taken. */
function events(extra: [string, string[]][]): Event[] {
  seq = 0;
  return [
    ev('character.created', {
      name: 'Aldric',
      system: '5e-2024',
      corePack: { id: P, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'masculine',
    }),
    decide(`${P}:system/5e-2024@0/species`, [`${P}:species/human`]),
    decide(`${P}:system/5e-2024@0/background`, [`${P}:background/soldier`]),
    decide(`${P}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
    decide(`${P}:system/5e-2024@0/ability-scores`, ['str:15', 'dex:14', 'con:14', 'int:10', 'wis:12', 'cha:8']),
    ...[1, 2, 3, 4].map((level) => ev('level.gained', { classId: fighter, level, hpRoll: 'average' })),
    decide(`${fighter}@4/feat`, [alert]),
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const factsOf = (evs: Event[]) => reduce(evs, undefined, rules);
const sheetOf = (evs: Event[]) => derive(factsOf(evs), index, rules);

describe('expertise skill pick: application (derive)', () => {
  it('upgrades a proficient skill to expertise: total = mod + 2 x prof (not 3 x — union, ranked once)', () => {
    const before = sheetOf(events([])).skills['athletics']!;
    expect(before.proficiency).toBe('proficient');
    expect(before.total.value).toBe(3 + 2);
    const after = sheetOf(events([[pickId, [skill('athletics')]]])).skills['athletics']!;
    expect(after.proficiency).toBe('expertise');
    expect(after.total.value).toBe(3 + 2 * 2);
  });

  it('applies after every other proficiency source (a class-skill decision recorded later still qualifies)', () => {
    const s = sheetOf(
      events([
        [pickId, [skill('perception')]],
        [`${fighter}@1/skills`, ['perception', 'insight']],
      ]),
    );
    expect(s.skills['perception']!.proficiency).toBe('expertise');
    expect(s.skills['insight']!.proficiency).toBe('proficient');
  });

  it('never CREATES proficiency: a recorded selection of a non-proficient skill applies nothing', () => {
    const base = sheetOf(events([])).skills['arcana']!;
    const s = sheetOf(events([[pickId, [skill('arcana')]]])).skills['arcana']!;
    expect(base.proficiency).toBe('none');
    expect(s).toEqual(base);
  });
});

describe('expertise skill pick: offer gating + refusal (Review Focus 1)', () => {
  const facts = factsOf(events([]));
  const sheet = derive(facts, index, rules);
  const { owner, choice } = findChoice(index, pickId)!;
  const pick = choice.pick;

  it('offers only the skills the character is currently proficient in', () => {
    if (!('query' in pick)) throw new Error('expected a query pick');
    expect(queryPickOptions(pick, index, sheet, owner.id).sort()).toEqual([skill('athletics'), skill('intimidation')]);
    // With no sheet to read proficiency from, a requireProficient pick offers nothing.
    expect(queryPickOptions(pick, index, undefined, owner.id)).toEqual([]);
  });

  it('refuses a non-proficient target with selection.notOffered', () => {
    const issues = validateSelection(sheet, facts, index, pickId, [skill('arcana')]);
    expect(issues.map((d) => d.code)).toEqual(['selection.notOffered']);
  });

  it('accepts a proficient target', () => {
    expect(validateSelection(sheet, facts, index, pickId, [skill('athletics')])).toEqual([]);
  });

  it('leaves a plain skill query pick ungated (every skill offered)', () => {
    expect(queryPickOptions({ query: { type: 'skill' } }, index, sheet, owner.id)).toHaveLength(
      index.system().skills.length,
    );
  });
});
