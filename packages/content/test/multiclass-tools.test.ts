import {
  createContentIndex,
  derive,
  outstandingChoices,
  pendingAdvancements,
  reduce,
  validateSelection,
} from '@hk/engine';
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

// Plan 14 task 1 (choice scope + multiclass tool gains), over the real built pack.
// Vendored: `srd-2024_multiclassing_proficiencies` (Rule.json) — "When you gain your first level in a
// class other than your initial class, you gain only some of the new class's starting proficiencies,
// as detailed in each class's description" — and each class's Core Traits "Tool Proficiencies" row
// (ClassFeature.json): bard "Choose 3 Musical Instruments", monk "Choose one type of Artisan's Tools
// or Musical Instrument", rogue "Thieves' Tools". The per-class multiclass rows themselves are not
// vendored (owner-flag, transform/classes.ts MULTICLASS_GAINS): Bard grants one Musical Instrument,
// Rogue Thieves' Tools, Monk no tool. So: `bard@1/tools` and `monk@1/tools` are `scope: 'initial'`,
// a later Bard gets `bard@1/multiclass-tools` (count 1, `scope: 'later'`), a later Rogue gets
// Thieves' Tools from `multiclass.gains.toolProficiencies`.

const FP = 'srd-5e-2024';
const pack = buildPack();
const index = createContentIndex([pack]);
const rules = { restRules: index.system().restRules, hpRules: index.system().hpRules };

const BARD = `${FP}:class/bard`;
const MONK = `${FP}:class/monk`;
const ROGUE = `${FP}:class/rogue`;
const FIGHTER = `${FP}:class/fighter`;
const ACOLYTE = `${FP}:background/acolyte`;
const BARD_TOOLS = `${BARD}@1/tools`;
const BARD_MC_TOOLS = `${BARD}@1/multiclass-tools`;
const MONK_TOOLS = `${MONK}@1/tools`;
const instrument = (s: string) => `${FP}:item/musical-instrument-${s}`;
const INSTRUMENTS = ['bagpipes', 'drum', 'dulcimer', 'flute', 'horn', 'lute', 'lyre', 'pan-flute', 'shawm', 'viol'].map(
  instrument,
);

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

/** Human Acolyte (scores clear every multiclass prerequisite here), class levels in order, then decisions.
 * Acolyte's own tool (vendored srd-2024_acolyte_tool-proficiencies: Calligrapher's Supplies) is always among the rows. */
function char(classes: [string, number][], extra: [string, string[]][] = []): Event[] {
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
    decide(`${FP}:system/5e-2024@0/background`, [ACOLYTE]),
    decide(`${FP}:background/acolyte@0/ability-scores`, ['wis:+2', 'cha:+1']),
    decide(`${FP}:system/5e-2024@0/ability-scores`, ['str:13', 'dex:15', 'con:13', 'int:10', 'wis:13', 'cha:14']),
    ...classes.flatMap(([classId, levels]) =>
      Array.from({ length: levels }, (_, i) => ev('level.gained', { classId, level: i + 1, hpRoll: 'average' })),
    ),
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const factsOf = (events: Event[]) => reduce(events, undefined, rules);
const sheetOf = (events: Event[]) => derive(factsOf(events), index, rules);
const toolChoices = (events: Event[]) =>
  outstandingChoices(factsOf(events), index).filter((r) => /@1\/(multiclass-)?tools$/.test(r.choiceId));
const tools = (events: Event[]) => sheetOf(events).proficiencies.filter((p) => p.kind === 'tool');

describe('class tool choices are scoped to the initial / a later class (plan 14 task 1)', () => {
  it('pack data: bard/monk @1/tools are initial-scoped; bard@1/multiclass-tools is later-scoped over the same 10 instruments; rogue gains Thieves’ Tools', () => {
    const cls = (id: string) => {
      const e = index.get(id);
      if (e?.type !== 'class') throw new Error(id);
      return e;
    };
    const choice = (id: string) =>
      cls(id.split('@')[0]!)
        .levels.flatMap((r) => r.choices)
        .find((c) => c.id === id);
    expect(choice(BARD_TOOLS)?.scope).toBe('initial');
    expect(choice(MONK_TOOLS)?.scope).toBe('initial');
    const mc = choice(BARD_MC_TOOLS);
    expect(mc).toMatchObject({ scope: 'later', count: 1, at: { kind: 'classLevel', class: 'bard', level: 1 } });
    expect(mc?.pick).toEqual({ static: INSTRUMENTS });
    expect(choice(BARD_TOOLS)?.pick).toEqual(mc?.pick);
    expect(cls(ROGUE).multiclass?.gains.toolProficiencies).toEqual(['thieves-tools']);
    expect(cls(BARD).multiclass?.gains.toolProficiencies).toEqual([]);
    expect(cls(MONK).multiclass?.gains.toolProficiencies).toEqual([]);
  });

  it('an initial-class bard is offered @1/tools (3) and not @1/multiclass-tools', () => {
    expect(toolChoices(char([[BARD, 1]]))).toEqual([{ choiceId: BARD_TOOLS, ownerId: BARD, count: 3 }]);
  });

  it('a later-class bard (rogue → bard) is offered @1/multiclass-tools (1) and not @1/tools', () => {
    expect(
      toolChoices(
        char([
          [ROGUE, 3],
          [BARD, 2],
        ]),
      ),
    ).toEqual([{ choiceId: BARD_MC_TOOLS, ownerId: BARD, count: 1 }]);
  });

  it('the later bard’s one instrument validates, lands as a tool row, and a second one is refused', () => {
    const base = char([
      [ROGUE, 3],
      [BARD, 2],
    ]);
    const facts = factsOf(base);
    const sheet = derive(facts, index, rules);
    expect(validateSelection(sheet, facts, index, BARD_MC_TOOLS, [instrument('lute')])).toEqual([]);
    expect(
      validateSelection(sheet, facts, index, BARD_MC_TOOLS, [instrument('lute'), instrument('flute')]).length,
    ).toBeGreaterThan(0);
    const answered = char(
      [
        [ROGUE, 3],
        [BARD, 2],
      ],
      [[BARD_MC_TOOLS, [instrument('lute')]]],
    );
    expect(toolChoices(answered)).toEqual([]);
    expect(tools(answered).map((p) => [p.target, p.sources])).toEqual([
      ['calligraphers-supplies', [ACOLYTE]],
      ['musical-instrument-lute', [BARD]],
      ['thieves-tools', [ROGUE]],
    ]);
  });

  it('an initial-class monk is offered its tool pick; a later-class monk (rogue → monk) is offered none', () => {
    expect(toolChoices(char([[MONK, 1]]))).toEqual([{ choiceId: MONK_TOOLS, ownerId: MONK, count: 1 }]);
    expect(
      toolChoices(
        char([
          [ROGUE, 1],
          [MONK, 1],
        ]),
      ),
    ).toEqual([]);
  });

  it('a later-class rogue (fighter → rogue) gains Thieves’ Tools from multiclass.gains', () => {
    expect(
      tools(
        char([
          [FIGHTER, 1],
          [ROGUE, 1],
        ]),
      ),
    ).toEqual([
      { kind: 'tool', target: 'calligraphers-supplies', level: 'proficient', sources: [ACOLYTE] },
      { kind: 'tool', target: 'thieves-tools', level: 'proficient', sources: [ROGUE] },
    ]);
  });

  it('legacy replay: a later-class bard log that answered @1/tools with three instruments still grants all three', () => {
    const legacy = char(
      [
        [ROGUE, 3],
        [BARD, 2],
      ],
      [[BARD_TOOLS, [instrument('lute'), instrument('flute'), instrument('drum')]]],
    );
    const sheet = sheetOf(legacy);
    expect(
      sheet.proficiencies
        .filter((p) => p.kind === 'tool')
        .map((p) => p.target)
        .sort(),
    ).toEqual([
      'calligraphers-supplies',
      'musical-instrument-drum',
      'musical-instrument-flute',
      'musical-instrument-lute',
      'thieves-tools',
    ]);
    expect(sheet.issues.map((i) => i.code)).not.toContain('decision.unknownChoice');
  });
});

describe('fix round 1: offers for legacy logs and level-up steps (plan 14 task 1)', () => {
  it('legacy replay: a later-class bard that answered @1/tools is not offered @1/multiclass-tools (no 4th instrument)', () => {
    const legacy = char(
      [
        [ROGUE, 3],
        [BARD, 2],
      ],
      [[BARD_TOOLS, [instrument('lute'), instrument('flute'), instrument('drum')]]],
    );
    expect(toolChoices(legacy)).toEqual([]);
  });

  it('level-up: a new-class bard is asked @1/multiclass-tools (1) only; a new-class monk is asked no tool pick', () => {
    const facts = factsOf(char([[ROGUE, 3]]));
    facts.xp = 10_000_000;
    const adv = pendingAdvancements(derive(facts, index, rules), facts, index);
    const steps = (classId: string) =>
      adv.find((a) => a.classId === classId && a.isNewClass)?.steps.filter((s) => s.choiceId.endsWith('tools'));
    expect(steps(BARD)).toEqual([{ choiceId: BARD_MC_TOOLS, ownerId: BARD, count: 1 }]);
    expect(steps(MONK)).toEqual([]);
  });
});
