import type { Event, Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 12 task 5 fix round 1: a decided choice whose pick targets skill entities grants proficiency in
// the picked skills, whoever owns the choice. Exercised over a clone of the real pack with a skill-pick
// choice patched onto the (otherwise unrelated) Alert feat, so no shipped content is assumed.

const P = 'srd-5e-2024';
const fighter = `${P}:class/fighter`;
const alert = `${P}:feat/alert`;
const pickId = `${alert}@1/test-skills`;

function patchedPack(): Pack {
  const pack = structuredClone(loadDistPack(P));
  const feat = pack.entities.find((e) => e.id === alert) as unknown as { choices: unknown[] };
  feat.choices.push({
    id: pickId,
    prompt: 'Pick skills',
    at: { kind: 'level', level: 1 },
    pick: { query: { type: 'skill' } },
    count: 2,
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
    ts: '2026-09-27T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const decide = (choiceId: string, selection: string[]) => ev('decision.made', { choiceId, selection });

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
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const proficient = (evs: Event[]) =>
  Object.entries(derive(reduce(evs, undefined, rules), index, rules).skills)
    .filter(([, s]) => s.proficiency !== 'none')
    .map(([k]) => k)
    .sort();

describe('skill-typed pick selection grants skill proficiency', () => {
  it('grants the picked skills', () => {
    const base = proficient(events([]));
    const withPick = proficient(
      events([
        [`${fighter}@4/feat`, [alert]],
        [pickId, [`${P}:skill/arcana`, `${P}:skill/history`]],
      ]),
    );
    expect(withPick.filter((s) => !base.includes(s))).toEqual(['arcana', 'history']);
  });

  it('does not double-grant a skill already proficient (union)', () => {
    const base = proficient(events([]));
    const already = base[0]!;
    const withPick = proficient(
      events([
        [`${fighter}@4/feat`, [alert]],
        [pickId, [`${P}:skill/${already}`, `${P}:skill/arcana`]],
      ]),
    );
    expect(withPick).toEqual([...new Set([...base, 'arcana'])].sort());
  });
});
