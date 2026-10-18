import { createContentIndex, derive, queryPickOptions, reduce, validateSelection } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

// Plan 14 task 2 (mixed-type picks) over the real built pack (vendored sources, packages/content/
// upstream/open5e-srd-2024/):
// - Skilled (FeatBenefit srd-2024_skilled_1): "You gain proficiency in any combination of three skills
//   or tools of your choice." -> ONE count-3 `queries` pick over every skill and every tool item
//   (`{type: 'item', category: 'tool'}`); the "Skilled (tools)" text fallback is retired.
// - Soldier (BackgroundBenefit srd-2024_soldier_tool-proficiencies): "Choose one kind of Gaming Set"
//   -> a count-1 static background pick `@0/tools` over the four Gaming Set items; the background no
//   longer carries the generic 'gaming-set' toolProficiency slug (which matched no item entity).

const FP = 'srd-5e-2024';
const pack = buildPack();
const index = createContentIndex([pack]);
const rules = { restRules: index.system().restRules, hpRules: index.system().hpRules };

const fighter = `${FP}:class/fighter`;
const soldier = `${FP}:background/soldier`;
const skilled = `${FP}:feat/skilled`;
const SKILLED_PICK = `${skilled}@1/skills`;
const SOLDIER_TOOLS = `${soldier}@0/tools`;
const GAMING_SETS = ['dice', 'dragonchess', 'playing-cards', 'three-dragon-ante'].map(
  (s) => `${FP}:item/gaming-set-${s}`,
);
const skill = (s: string) => `${FP}:skill/${s}`;
const item = (s: string) => `${FP}:item/${s}`;

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

/** Human Soldier fighter at `level` (Skilled taken at fighter 4 when `level >= 4`), then `extra`. */
function char(level: number, extra: [string, string[]][] = []): Event[] {
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
    decide(`${FP}:system/5e-2024@0/background`, [soldier]),
    decide(`${FP}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
    decide(`${FP}:system/5e-2024@0/ability-scores`, ['str:15', 'dex:14', 'con:13', 'int:10', 'wis:12', 'cha:8']),
    ...Array.from({ length: level }, (_, i) =>
      ev('level.gained', { classId: fighter, level: i + 1, hpRoll: 'average' }),
    ),
    ...(level >= 4 ? [decide(`${fighter}@4/feat`, [skilled])] : []),
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const factsOf = (events: Event[]) => reduce(events, undefined, rules);
const sheetOf = (events: Event[]) => derive(factsOf(events), index, rules);
const toolRows = (events: Event[]) => sheetOf(events).proficiencies.filter((p) => p.kind === 'tool');
const refusals = (events: Event[], choiceId: string, selection: string[]) =>
  validateSelection(sheetOf(events), factsOf(events), index, choiceId, selection).map((d) => d.code);

const choiceOf = (ownerId: string, choiceId: string) => {
  const owner = pack.entities.find((e) => e.id === ownerId) as unknown as {
    choices: { id: string; pick: unknown; count: unknown; at: unknown; scope?: unknown }[];
    effects?: { type: string; name?: string }[];
  };
  return { owner, choice: owner.choices.find((c) => c.id === choiceId) };
};

const allSkills = pack.entities.filter((e) => e.type === 'skill').map((e) => e.id);
const allTools = pack.entities.filter((e) => e.type === 'item' && e.category === 'tool').map((e) => e.id);

describe('Skilled: three skills or tools in any combination (srd-2024_skilled_1)', () => {
  it('is one count-3 queries pick over every skill and every tool item; the text fallback is gone', () => {
    const { owner, choice } = choiceOf(skilled, SKILLED_PICK);
    expect(choice?.pick).toEqual({ queries: [{ type: 'skill' }, { type: 'item', category: 'tool' }] });
    expect(choice?.count).toBe(3);
    expect(owner.choices).toHaveLength(1);
    expect((owner.effects ?? []).some((e) => e.name === 'Skilled (tools)')).toBe(false);
  });

  it('offers every skill and every tool item exactly once', () => {
    const { choice } = choiceOf(skilled, SKILLED_PICK);
    const ids = queryPickOptions(choice!.pick as Parameters<typeof queryPickOptions>[0], index, undefined);
    expect(allSkills).toHaveLength(18);
    expect(allTools.length).toBeGreaterThan(0);
    expect([...ids].sort()).toEqual([...allSkills, ...allTools].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a decision of 2 skills + 1 tool grants 2 skill proficiencies and 1 tool row', () => {
    const picks = [skill('arcana'), skill('history'), item('smiths-tools')];
    expect(refusals(char(4), SKILLED_PICK, picks)).toEqual([]);
    const before = sheetOf(char(4));
    const events = char(4, [[SKILLED_PICK, picks]]);
    const sheet = sheetOf(events);
    expect(before.skills['arcana']?.proficiency).not.toBe('proficient');
    expect(before.skills['history']?.proficiency).not.toBe('proficient');
    expect(sheet.skills['arcana']?.proficiency).toBe('proficient');
    expect(sheet.skills['history']?.proficiency).toBe('proficient');
    expect(toolRows(events).filter((p) => p.sources.includes(skilled))).toEqual([
      { kind: 'tool', target: 'smiths-tools', level: 'proficient', sources: [skilled] },
    ]);
    expect(sheet.outstandingChoices.filter((c) => c.ownerId === skilled)).toEqual([]);
  });

  it('refuses a non-skill, non-tool selection and a short selection', () => {
    expect(refusals(char(4), SKILLED_PICK, [skill('arcana'), skill('history'), item('longsword')])).toEqual([
      'selection.notOffered',
    ]);
    expect(refusals(char(4), SKILLED_PICK, [skill('arcana'), item('smiths-tools')])).toEqual(['selection.count']);
  });

  it('a recorded skills-only Skilled decision keeps granting exactly as before (replay)', () => {
    const events = char(4, [[SKILLED_PICK, [skill('arcana'), skill('history'), skill('nature')]]]);
    const sheet = sheetOf(events);
    for (const s of ['arcana', 'history', 'nature']) expect(sheet.skills[s]?.proficiency, s).toBe('proficient');
    expect(toolRows(events).filter((p) => p.sources.includes(skilled))).toEqual([]);
  });
});

describe('Soldier: choose one kind of Gaming Set (srd-2024_soldier_tool-proficiencies)', () => {
  it('is a count-1 creation pick over exactly the four Gaming Sets, unscoped; no generic tool slug', () => {
    const { choice } = choiceOf(soldier, SOLDIER_TOOLS);
    expect(choice?.pick).toEqual({ static: GAMING_SETS });
    expect(choice?.count).toBe(1);
    expect(choice?.at).toEqual({ kind: 'creation' });
    expect(choice && 'scope' in choice).toBe(false);
    const bg = pack.entities.find((e) => e.id === soldier);
    expect(bg?.type === 'background' ? bg.toolProficiency : 'not-a-background').toBeUndefined();
    for (const id of GAMING_SETS) {
      const e = index.get(id);
      expect(e?.type === 'item' ? e.category : undefined, id).toBe('tool');
    }
  });

  it('every background tool slug resolves to a real tool item (no generic non-entity slug left)', () => {
    for (const bg of pack.entities) {
      if (bg.type !== 'background' || bg.toolProficiency === undefined) continue;
      const e = index.get(`${FP}:item/${bg.toolProficiency}`);
      expect(e?.type === 'item' ? e.category : undefined, bg.id).toBe('tool');
    }
  });

  it('the pick is outstanding until answered; the chosen set lands as a tool row; no generic row', () => {
    expect(sheetOf(char(1)).outstandingChoices.map((c) => c.choiceId)).toContain(SOLDIER_TOOLS);
    expect(toolRows(char(1))).toEqual([]);
    const events = char(1, [[SOLDIER_TOOLS, [item('gaming-set-dice')]]]);
    expect(sheetOf(events).outstandingChoices.map((c) => c.choiceId)).not.toContain(SOLDIER_TOOLS);
    expect(toolRows(events)).toEqual([
      { kind: 'tool', target: 'gaming-set-dice', level: 'proficient', sources: [soldier] },
    ]);
    expect(toolRows(events).some((p) => p.target === 'gaming-set')).toBe(false);
  });

  it('refuses a non-gaming-set tool and a second set', () => {
    expect(refusals(char(1), SOLDIER_TOOLS, [item('thieves-tools')])).toEqual(['selection.notOffered']);
    expect(refusals(char(1), SOLDIER_TOOLS, [item('gaming-set-dice'), item('gaming-set-dragonchess')])).toEqual([
      'selection.count',
    ]);
  });
});
