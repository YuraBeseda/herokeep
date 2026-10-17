import type { Event, Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { findChoice } from '../../src/content/choices.ts';
import { createContentIndex } from '../../src/content/index.ts';
import { abilitiesPickOptions } from '../../src/derive/abilities.ts';
import { derive } from '../../src/derive/index.ts';
import { validateSelection } from '../../src/derive/validation.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 13 task 3: an `abilities` pick restricted to a fixed subset (`pick.abilities.from`, e.g.
// Grappler's "Strength or Dexterity +1"). Exercised over a clone of the real pack with such a pick
// patched onto the (otherwise unrelated) Alert feat — the expertise-pick.test.ts harness — so the
// mechanism is pinned independently of which SRD feat authors it.

const P = 'srd-5e-2024';
const fighter = `${P}:class/fighter`;
const alert = `${P}:feat/alert`;
const pickId = `${alert}@1/test-ability`;

function patchedPack(): Pack {
  const pack = structuredClone(loadDistPack(P));
  const feat = pack.entities.find((e) => e.id === alert) as unknown as { choices: unknown[] };
  feat.choices.push({
    id: pickId,
    prompt: 'Increase Strength or Dexterity',
    at: { kind: 'level', level: 1 },
    pick: { abilities: { count: 1, max: 20, improve: '+1', from: ['dex', 'str'] } },
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

/** Fighter 4, Soldier (str/dex/con background list), STR 17, Alert taken. */
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

const optionsFor = (choiceId: string) => {
  const found = findChoice(index, choiceId)!;
  const pick = found.choice.pick;
  if (!('abilities' in pick)) throw new Error(`${choiceId} is not an abilities pick`);
  return abilitiesPickOptions(pick, found.owner, index);
};

describe('restricted abilities pick: offered set', () => {
  it('a pick with `from` offers exactly those abilities, in system order', () => {
    expect(optionsFor(pickId)).toEqual(['str', 'dex']);
  });

  it('a pick without `from` on an unrestricted owner (the ASI feat) offers every system ability', () => {
    expect(optionsFor(`${P}:feat/ability-score-improvement@4/ability-scores`)).toEqual(
      index.system().abilities.map((a) => a.id),
    );
  });

  it("a background's own abilityScores list still narrows its pick (unchanged)", () => {
    expect(optionsFor(`${P}:background/soldier@0/ability-scores`)).toEqual(['str', 'dex', 'con']);
  });
});

describe('restricted abilities pick: refusal + application', () => {
  const facts = factsOf(events([]));
  const sheet = derive(facts, index, rules);

  it('refuses an ability outside `from` with selection.abilityNotAllowed', () => {
    const issues = validateSelection(sheet, facts, index, pickId, ['con:+1']);
    expect(issues.map((d) => d.code)).toEqual(['selection.abilityNotAllowed']);
  });

  it('accepts an ability inside `from`, and the +1 lands on the score', () => {
    expect(validateSelection(sheet, facts, index, pickId, ['dex:+1'])).toEqual([]);
    const after = derive(factsOf(events([[pickId, ['dex:+1']]])), index, rules);
    expect(after.abilities['dex']!.score.value).toBe(sheet.abilities['dex']!.score.value + 1);
  });
});
