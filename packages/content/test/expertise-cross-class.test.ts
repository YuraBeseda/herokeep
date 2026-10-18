import {
  createContentIndex,
  derive,
  findChoice,
  isQueryPick,
  queryPickOptions,
  reduce,
  validateSelection,
} from '@hk/engine';
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

// Plan 14 task 4 (ruling 6) over the real built pack. Vendored sources (packages/content/upstream/
// open5e-srd-2024/): srd-2024_ranger_deft-explorer (level 2) "Choose one of your skill proficiencies
// with which you lack Expertise. You gain Expertise in that skill." and srd-2024_ranger_expertise
// (level 9) "Choose two of your skill proficiencies with which you lack Expertise." — "lack
// Expertise" is about the character, whichever class granted it: a Rogue 1 (Expertise: Stealth +
// Perception) -> Ranger multiclass must not be offered Stealth/Perception by either ranger pick.
// The Ranger's OWN earlier pick (@2 vs @9, same owner) stays the Choice.unique family's job
// (`selection.duplicate`), unchanged from plan 13.

const FP = 'srd-5e-2024';
const ROGUE = `${FP}:class/rogue`;
const RANGER = `${FP}:class/ranger`;
const pack = buildPack();
const index = createContentIndex([pack]);
const rules = { restRules: index.system().restRules, hpRules: index.system().hpRules };
const skill = (slug: string) => `${FP}:skill/${slug}`;

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

/** Human Soldier Rogue 1 (Expertise: stealth + perception) -> Ranger `rangerLevel` (bonus skill survival). */
function char(rangerLevel: number, extra: [string, string[]][] = []): Event[] {
  seq = 0;
  return [
    ev('character.created', {
      name: 'Wren',
      system: '5e-2024',
      corePack: { id: FP, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'feminine',
    }),
    decide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
    decide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
    decide(`${FP}:background/soldier@0/ability-scores`, ['dex:+2', 'con:+1']),
    decide(`${FP}:system/5e-2024@0/ability-scores`, ['dex:15', 'wis:14', 'con:13', 'str:12', 'int:10', 'cha:8']),
    ev('level.gained', { classId: ROGUE, level: 1 }),
    decide(`${ROGUE}@1/skills`, ['acrobatics', 'stealth', 'perception', 'sleight-of-hand']),
    decide(`${ROGUE}@1/expertise`, [skill('stealth'), skill('perception')]),
    ...Array.from({ length: rangerLevel }, (_, i) =>
      ev('level.gained', { classId: RANGER, level: i + 1, ...(i > 0 ? { hpRoll: 'average' } : {}) }),
    ),
    decide(`${RANGER}@1/multiclass-skills`, ['survival']),
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const factsOf = (events: Event[]) => reduce(events, undefined, rules);
const options = (events: Event[], choiceId: string) => {
  const found = findChoice(index, choiceId)!;
  if (!isQueryPick(found.choice.pick)) throw new Error(`${choiceId} is not a query pick`);
  return queryPickOptions(found.choice.pick, index, derive(factsOf(events), index, rules), found.owner.id).sort();
};
const refusals = (events: Event[], choiceId: string, selection: string[]) => {
  const facts = factsOf(events);
  return validateSelection(derive(facts, index, rules), facts, index, choiceId, selection).map((d) => d.code);
};

describe('expertise eligibility across classes (rogue -> ranger, real pack)', () => {
  it('Deft Explorer (ranger@2/expertise) skips the rogue-expertise skills', () => {
    expect(options(char(2), `${RANGER}@2/expertise`)).toEqual(
      ['acrobatics', 'athletics', 'intimidation', 'sleight-of-hand', 'survival'].map(skill),
    );
    expect(refusals(char(2), `${RANGER}@2/expertise`, [skill('perception')])).toEqual(['selection.notOffered']);
    expect(refusals(char(2), `${RANGER}@2/expertise`, [skill('survival')])).toEqual([]);
  });

  it('ranger@9/expertise also skips them; the ranger @2 pick stays the duplicate family', () => {
    const events = char(9, [[`${RANGER}@2/expertise`, [skill('acrobatics')]]]);
    const offered = options(events, `${RANGER}@9/expertise`);
    expect(offered).not.toContain(skill('stealth'));
    expect(offered).not.toContain(skill('perception'));
    expect(offered).toContain(skill('acrobatics')); // same owner: listed, refused as a duplicate below
    expect(refusals(events, `${RANGER}@9/expertise`, [skill('stealth'), skill('athletics')])).toEqual([
      'selection.notOffered',
    ]);
    expect(refusals(events, `${RANGER}@9/expertise`, [skill('acrobatics'), skill('athletics')])).toEqual([
      'selection.duplicate',
    ]);
    expect(refusals(events, `${RANGER}@9/expertise`, [skill('athletics'), skill('survival')])).toEqual([]);
  });

  it('a legacy ranger pick on a rogue-expertise skill keeps it at expertise and is reported', () => {
    const events = char(2, [[`${RANGER}@2/expertise`, [skill('stealth')]]]);
    const sheet = derive(factsOf(events), index, rules);
    expect(sheet.skills['stealth']!.proficiency).toBe('expertise');
    expect(sheet.skills['stealth']!.expertiseOwner).toBe(ROGUE);
    expect(refusals(events, `${RANGER}@2/expertise`, [skill('stealth')])).toEqual(['selection.notOffered']);
  });
});
