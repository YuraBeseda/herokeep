import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { findChoice } from '../../src/content/choices.ts';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { isQueryPick, queryPickOptions, validateSelection } from '../../src/derive/validation.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 14 task 4 (ruling 6): an Expertise pick (`proficiency: 'expertise'` + `requireProficient`)
// offers a skill only while the character is proficient in it AND no OTHER owner has already raised
// it to expertise. Rogue 1 (Expertise: Stealth + Perception) -> Ranger 2 (Deft Explorer, count 1):
// before this task the ranger's pick still offered Stealth/Perception, and a pick on either was
// silently wasted (already expertise). Real pack: the rogue/ranger @N/expertise row choices.

const P = 'srd-5e-2024';
const rogue = `${P}:class/rogue`;
const ranger = `${P}:class/ranger`;
const rogueExpertise = `${rogue}@1/expertise`;
const rangerExpertise = `${ranger}@2/expertise`;
const skill = (slug: string) => `${P}:skill/${slug}`;

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

/**
 * Human Soldier (athletics + intimidation) Rogue 1 (acrobatics, stealth, perception, sleight-of-hand;
 * Expertise: stealth + perception) -> Ranger 2 (multiclass bonus skill: survival), plus `extra`.
 */
function events(extra: [string, string[]][] = []): Event[] {
  seq = 0;
  return [
    ev('character.created', {
      name: 'Wren',
      system: '5e-2024',
      corePack: { id: P, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'feminine',
    }),
    decide(`${P}:system/5e-2024@0/species`, [`${P}:species/human`]),
    decide(`${P}:system/5e-2024@0/background`, [`${P}:background/soldier`]),
    decide(`${P}:background/soldier@0/ability-scores`, ['dex:+2', 'con:+1']),
    decide(`${P}:system/5e-2024@0/ability-scores`, ['dex:15', 'wis:14', 'con:13', 'str:12', 'int:10', 'cha:8']),
    ev('level.gained', { classId: rogue, level: 1 }),
    decide(`${rogue}@1/skills`, ['acrobatics', 'stealth', 'perception', 'sleight-of-hand']),
    decide(rogueExpertise, [skill('stealth'), skill('perception')]),
    ev('level.gained', { classId: ranger, level: 1 }),
    decide(`${ranger}@1/multiclass-skills`, ['survival']),
    ev('level.gained', { classId: ranger, level: 2, hpRoll: 'average' }),
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const factsOf = (evs: Event[]) => reduce(evs, undefined, rules);
const sheetOf = (evs: Event[]) => derive(factsOf(evs), index, rules);
const pickOf = (choiceId: string) => {
  const pick = findChoice(index, choiceId)!.choice.pick;
  if (!isQueryPick(pick)) throw new Error(`${choiceId} is not a query pick`);
  return pick;
};

describe('expertise eligibility across owners (plan 14 task 4, ruling 6)', () => {
  it('ranger 2 Deft Explorer offers only proficient skills the rogue has NOT already given expertise', () => {
    const sheet = sheetOf(events());
    expect(sheet.skills['stealth']!.proficiency).toBe('expertise');
    expect(queryPickOptions(pickOf(rangerExpertise), index, sheet, ranger).sort()).toEqual(
      ['acrobatics', 'athletics', 'intimidation', 'sleight-of-hand', 'survival'].map(skill),
    );
  });

  it('without an owner, every expertise-rank skill is excluded (no pick is exempt)', () => {
    const sheet = sheetOf(events());
    const ids = queryPickOptions(pickOf(rangerExpertise), index, sheet);
    expect(ids).not.toContain(skill('stealth'));
    expect(ids).not.toContain(skill('perception'));
    expect(ids).toContain(skill('acrobatics'));
  });

  it('refuses a ranger pick on a rogue-expertise skill with selection.notOffered', () => {
    const evs = events();
    const facts = factsOf(evs);
    const sheet = derive(facts, index, rules);
    expect(validateSelection(sheet, facts, index, rangerExpertise, [skill('stealth')]).map((d) => d.code)).toEqual([
      'selection.notOffered',
    ]);
    expect(validateSelection(sheet, facts, index, rangerExpertise, [skill('acrobatics')])).toEqual([]);
  });

  it("a pick's OWN recorded expertise never makes it ineligible (re-open / draft re-derive)", () => {
    const evs = events([[rangerExpertise, [skill('acrobatics')]]]);
    const facts = factsOf(evs);
    const sheet = derive(facts, index, rules);
    expect(sheet.skills['acrobatics']!.proficiency).toBe('expertise');
    expect(queryPickOptions(pickOf(rangerExpertise), index, sheet, ranger)).toContain(skill('acrobatics'));
    expect(validateSelection(sheet, facts, index, rangerExpertise, [skill('acrobatics')])).toEqual([]);
    // The rogue's own recorded pair stays valid too.
    expect(validateSelection(sheet, facts, index, rogueExpertise, [skill('stealth'), skill('perception')])).toEqual([]);
  });

  it('legacy log (Review Focus 5): a recorded ranger pick on Stealth keeps granting (no-op) AND surfaces the issue', () => {
    const before = sheetOf(events()).skills['stealth']!;
    const evs = events([[rangerExpertise, [skill('stealth')]]]);
    const facts = factsOf(evs);
    const sheet = derive(facts, index, rules);
    // Nothing is lost: Stealth stays at expertise with the same total (the upgrade is a no-op).
    expect(sheet.skills['stealth']!.proficiency).toBe('expertise');
    expect(sheet.skills['stealth']!.total.value).toBe(before.total.value);
    // The ranger's choice is answered (not re-asked)...
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).not.toContain(rangerExpertise);
    // ...but re-validating its recorded selection reports it, so the player can re-pick.
    expect(
      validateSelection(sheet, facts, index, rangerExpertise, facts.decisions[rangerExpertise]!).map((d) => d.code),
    ).toEqual(['selection.notOffered']);
    // Class order decides who owns the expertise: the EARLIER rogue pick stays valid.
    expect(validateSelection(sheet, facts, index, rogueExpertise, facts.decisions[rogueExpertise]!)).toEqual([]);
  });
});
