import type { Event, Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { validateSelection } from '../../src/derive/validation.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 13 task 2: tool proficiency on the derive surface. `Sheet.proficiencies` (the kind+target
// union of armor/weapon/tool/language) now carries kind 'tool' from (1) the INITIAL class's own
// `toolProficiencies` (a later class contributes only its `multiclass.gains`, which carries no tool
// list — ruling 7's restriction, same as armor/weapons), (2) every active background's
// `toolProficiency`, and (3) any decided pick whose selections resolve to a tool (an item of
// category 'tool') — the tool analogue of "a decided pick of skill entities grants proficiency".
// Targets are SLUGS (the item slug; class/background tool fields already are), so the same tool
// from two sources merges into one row. The pick mechanism is exercised over a clone of the real
// pack with a static tool pick patched onto the (otherwise unrelated) Alert feat — same harness as
// skill-pick.test.ts / expertise-pick.test.ts.

const P = 'srd-5e-2024';
const fighter = `${P}:class/fighter`;
const rogue = `${P}:class/rogue`;
const druid = `${P}:class/druid`;
const alert = `${P}:feat/alert`;
const soldier = `${P}:background/soldier`;
const criminal = `${P}:background/criminal`;
const pickId = `${alert}@1/test-tools`;
const item = (slug: string) => `${P}:item/${slug}`;

function patchedPack(): Pack {
  const pack = structuredClone(loadDistPack(P));
  const feat = pack.entities.find((e) => e.id === alert) as unknown as { choices: unknown[] };
  feat.choices.push({
    id: pickId,
    prompt: 'Pick tools',
    at: { kind: 'level', level: 1 },
    pick: { static: [item('musical-instrument-lute'), item('thieves-tools'), item('longsword')] },
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
    ts: '2026-10-17T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const decide = (choiceId: string, selection: string[]) => ev('decision.made', { choiceId, selection });

/** Human, `background`, the given class levels in order (first entry = initial class), then `extra` decisions. */
function events(background: string, classes: [string, number][], extra: [string, string[]][] = []): Event[] {
  seq = 0;
  const bgSlug = background.split('/').at(-1)!;
  return [
    ev('character.created', {
      name: 'Aldric',
      system: '5e-2024',
      corePack: { id: P, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'masculine',
    }),
    decide(`${P}:system/5e-2024@0/species`, [`${P}:species/human`]),
    decide(`${P}:system/5e-2024@0/background`, [background]),
    decide(
      `${P}:background/${bgSlug}@0/ability-scores`,
      bgSlug === 'soldier' ? ['str:+2', 'con:+1'] : ['dex:+2', 'con:+1'],
    ),
    decide(`${P}:system/5e-2024@0/ability-scores`, ['str:15', 'dex:14', 'con:14', 'int:10', 'wis:13', 'cha:8']),
    ...classes.flatMap(([classId, levels]) =>
      Array.from({ length: levels }, (_, i) => ev('level.gained', { classId, level: i + 1, hpRoll: 'average' })),
    ),
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const factsOf = (evs: Event[]) => reduce(evs, undefined, rules);
const sheetOf = (evs: Event[]) => derive(factsOf(evs), index, rules);
const tools = (evs: Event[]) => sheetOf(evs).proficiencies.filter((p) => p.kind === 'tool');

describe('tool proficiencies (derive)', () => {
  it("lists a class's fixed tools and the background's tool, each with its source", () => {
    expect(tools(events(soldier, [[rogue, 1]]))).toEqual([
      { kind: 'tool', target: 'gaming-set', level: 'proficient', sources: [soldier] },
      { kind: 'tool', target: 'thieves-tools', level: 'proficient', sources: [rogue] },
    ]);
    expect(tools(events(soldier, [[druid, 1]])).map((p) => p.target)).toEqual(['gaming-set', 'herbalism-kit']);
  });

  it('merges the same tool from class and background into one row with both sources', () => {
    expect(tools(events(criminal, [[rogue, 1]]))).toEqual([
      { kind: 'tool', target: 'thieves-tools', level: 'proficient', sources: [criminal, rogue] },
    ]);
  });

  it('a class with no fixed tools contributes none (only the background tool lands)', () => {
    expect(tools(events(soldier, [[fighter, 1]])).map((p) => p.target)).toEqual(['gaming-set']);
  });

  it('a LATER class contributes only its multiclass.gains (no tool list there), as for armor/weapons', () => {
    // Ruling 7 restriction (deriveProficiencies): gains carries no tool list, so a fighter -> rogue
    // multiclass does not gain the rogue's Thieves' Tools from the class (residual: needs a
    // gains-level tool vocabulary; see task-2-report.md).
    expect(
      tools(
        events(soldier, [
          [fighter, 1],
          [rogue, 1],
        ]),
      ).map((p) => p.target),
    ).toEqual(['gaming-set']);
  });

  it('a decided pick selecting tool items grants proficiency in them (slug targets, owner as source)', () => {
    const t = tools(
      events(
        soldier,
        [[fighter, 4]],
        [
          [`${fighter}@4/feat`, [alert]],
          [pickId, [item('musical-instrument-lute'), item('thieves-tools')]],
        ],
      ),
    );
    expect(t).toEqual([
      { kind: 'tool', target: 'gaming-set', level: 'proficient', sources: [soldier] },
      { kind: 'tool', target: 'musical-instrument-lute', level: 'proficient', sources: [alert] },
      { kind: 'tool', target: 'thieves-tools', level: 'proficient', sources: [alert] },
    ]);
  });

  it('a selected item that is not a tool grants no tool proficiency', () => {
    const evs = events(
      soldier,
      [[fighter, 4]],
      [
        [`${fighter}@4/feat`, [alert]],
        [pickId, [item('longsword'), item('thieves-tools')]],
      ],
    );
    expect(tools(evs).map((p) => p.target)).toEqual(['gaming-set', 'thieves-tools']);
    expect(sheetOf(evs).proficiencies.some((p) => p.target === 'longsword')).toBe(false);
  });

  it('a static tool pick refuses a tool outside its list', () => {
    const evs = events(soldier, [[fighter, 4]], [[`${fighter}@4/feat`, [alert]]]);
    const facts = factsOf(evs);
    const codes = validateSelection(derive(facts, index, rules), facts, index, pickId, [
      item('musical-instrument-lute'),
      item('smiths-tools'),
    ]).map((d) => d.code);
    expect(codes).toEqual(['selection.notOffered']);
  });
});
