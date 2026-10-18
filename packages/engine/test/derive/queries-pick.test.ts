import type { Event, Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { queryPickOptions, validateSelection } from '../../src/derive/validation.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 14 task 2: mixed-type picks. A `queries` pick offers the deduplicated UNION of several entity
// queries as ONE option list, and the choice's `count` applies to that union. `EntityQuery.category`
// filters items by their category. The two pre-existing grant paths stay untouched and BOTH fire for
// one mixed decision: a selected skill entity grants a skill proficiency (derive/abilities.ts), a
// selected tool item a tool proficiency row (derive/index.ts). The mechanism is exercised over a
// clone of the real pack with a `queries` pick patched onto the (otherwise unrelated) Alert feat —
// the same harness as tool-proficiencies.test.ts / expertise-pick.test.ts.

const P = 'srd-5e-2024';
const fighter = `${P}:class/fighter`;
const alert = `${P}:feat/alert`;
const criminal = `${P}:background/criminal`;
const pickId = `${alert}@1/test-mixed`;
const dupPickId = `${alert}@1/test-overlap`;
const item = (slug: string) => `${P}:item/${slug}`;
const skill = (slug: string) => `${P}:skill/${slug}`;

const SKILL_OR_TOOL = { queries: [{ type: 'skill' }, { type: 'item', category: 'tool' }] };
const OVERLAPPING = {
  queries: [
    { type: 'item', category: 'tool' },
    { type: 'item', category: 'tool' },
  ],
};

function patchedPack(): Pack {
  const pack = structuredClone(loadDistPack(P));
  const feat = pack.entities.find((e) => e.id === alert) as unknown as { choices: unknown[] };
  const choice = (id: string, pick: unknown) => ({
    id,
    prompt: 'Pick',
    at: { kind: 'level', level: 1 },
    pick,
    count: 3,
    unique: true,
    repeatableAt: [],
    prerequisites: [],
  });
  feat.choices.push(choice(pickId, SKILL_OR_TOOL), choice(dupPickId, OVERLAPPING));
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
    ts: '2026-10-18T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const decide = (choiceId: string, selection: string[]) => ev('decision.made', { choiceId, selection });

/** Human Criminal fighter 1 (Alert is the Criminal origin feat), then `extra` decisions. */
function events(extra: [string, string[]][] = []): Event[] {
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
    decide(`${P}:system/5e-2024@0/background`, [criminal]),
    decide(`${P}:background/criminal@0/ability-scores`, ['dex:+2', 'con:+1']),
    decide(`${P}:system/5e-2024@0/ability-scores`, ['str:15', 'dex:14', 'con:14', 'int:10', 'wis:13', 'cha:8']),
    ev('level.gained', { classId: fighter, level: 1, hpRoll: 'average' }),
    ...extra.map(([c, s]) => decide(c, s)),
  ];
}
const factsOf = (evs: Event[]) => reduce(evs, undefined, rules);
const sheetOf = (evs: Event[]) => derive(factsOf(evs), index, rules);
const refusals = (choiceId: string, selection: string[]) => {
  const evs = events();
  return validateSelection(sheetOf(evs), factsOf(evs), index, choiceId, selection).map((d) => d.code);
};

const allSkills = index.byType('skill').map((e) => e.id);
const allTools = index
  .byType('item')
  .filter((e) => e.type === 'item' && e.category === 'tool')
  .map((e) => e.id);

describe('EntityQuery.category (item category filter)', () => {
  it('selects exactly the items of that category', () => {
    expect(allTools.length).toBeGreaterThan(0);
    expect(index.query({ type: 'item', category: 'tool' }).map((e) => e.id)).toEqual(allTools);
    expect(index.query({ type: 'item', category: 'tool' }).map((e) => e.id)).not.toContain(item('longsword'));
  });

  it('matches no non-item entity', () => {
    expect(index.query({ type: 'skill', category: 'tool' })).toEqual([]);
  });
});

describe('queries pick (union of entity queries)', () => {
  const pickOf = (pick: unknown) => pick as Parameters<typeof queryPickOptions>[0];

  it('offers every skill and every tool, each exactly once, as one list', () => {
    const ids = queryPickOptions(pickOf(SKILL_OR_TOOL), index, undefined);
    expect(allSkills).toHaveLength(18);
    expect(ids).toEqual([...allSkills, ...allTools]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dedups an entity matched by more than one query', () => {
    expect(queryPickOptions(pickOf(OVERLAPPING), index, undefined)).toEqual(allTools);
  });

  it('counts the selection over the union and refuses anything outside it', () => {
    expect(refusals(pickId, [skill('athletics'), skill('perception'), item('smiths-tools')])).toEqual([]);
    expect(refusals(pickId, [item('smiths-tools'), item('thieves-tools'), item('gaming-set-dice')])).toEqual([]);
    expect(refusals(pickId, [skill('athletics'), item('smiths-tools')])).toEqual(['selection.count']);
    expect(refusals(pickId, [skill('athletics'), skill('perception'), item('longsword')])).toEqual([
      'selection.notOffered',
    ]);
    expect(refusals(pickId, [skill('athletics'), skill('athletics'), item('smiths-tools')])).toEqual([
      'selection.duplicate',
    ]);
  });

  it('one decision of 2 skills + 1 tool grants 2 skill proficiencies and 1 tool row', () => {
    const before = sheetOf(events());
    expect(before.skills['athletics']?.proficiency).toBe('none');
    expect(before.skills['perception']?.proficiency).toBe('none');
    const sheet = sheetOf(events([[pickId, [skill('athletics'), skill('perception'), item('smiths-tools')]]]));
    expect(sheet.skills['athletics']?.proficiency).toBe('proficient');
    expect(sheet.skills['perception']?.proficiency).toBe('proficient');
    expect(sheet.proficiencies.filter((p) => p.kind === 'tool')).toEqual([
      { kind: 'tool', target: 'smiths-tools', level: 'proficient', sources: [alert] },
      { kind: 'tool', target: 'thieves-tools', level: 'proficient', sources: [criminal] },
    ]);
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).not.toContain(pickId);
  });
});
