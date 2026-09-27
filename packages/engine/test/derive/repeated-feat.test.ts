import { type Event, type Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { findChoice, occurrenceChoiceId, splitOccurrence } from '../../src/content/choices.ts';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { validateSelection } from '../../src/derive/validation.ts';
import { createLocalizer } from '../../src/i18n/localizer.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 11 final wave F1 — a repeatable feat acquired TWICE (the SRD's Ability Score Improvement,
// offered at Fighter 4 and 6) must surface its nested sub-choice once PER ACQUISITION. Occurrence
// #1 keeps the pack-authored choice id verbatim (every pre-existing event log keeps resolving to
// it); occurrence #2+ get a distinct, engine-derived id.

const P = 'srd-5e-2024';
const fighter = `${P}:class/fighter`;
const asi = `${P}:feat/ability-score-improvement`;
const asiChoice = `${asi}@4/ability-scores`;
const stream = 'char:11111111-1111-7111-8111-111111111111';

const pack = loadDistPack(P);
const index = createContentIndex([pack]);
const rules: SystemRules = { restRules: index.system().restRules, hpRules: index.system().hpRules };

let seq = 0;
const ev = (type: string, payload: unknown): Event => {
  seq += 1;
  return {
    id: `018f7000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    stream,
    seq,
    ts: '2026-09-27T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const decide = (choiceId: string, selection: string[], context?: Record<string, unknown>) =>
  ev('decision.made', { choiceId, selection, ...(context ? { context } : {}) });

/** A Fighter 6 (standard array, Soldier) whose level-4 feat is ASI (default str:+2). */
function fighter6(firstAsi: string[] = ['str:+2']): Event[] {
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
    decide(`${P}:system/5e-2024@0/ability-scores`, ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'], {
      method: 'standardArray',
    }),
    ...[1, 2, 3, 4].map((level) => ev('level.gained', { classId: fighter, level, hpRoll: 'average' })),
    decide(`${fighter}@4/feat`, [asi]),
    decide(asiChoice, firstAsi),
    ...[5, 6].map((level) => ev('level.gained', { classId: fighter, level, hpRoll: 'average' })),
  ];
}

const featChoicesOutstanding = (events: Event[], idx = index) =>
  derive(reduce(events, undefined, rules), idx, rules).outstandingChoices.filter((c) => c.ownerId === asi);

describe('repeated feat acquisition (occurrence-scoped nested choices)', () => {
  it('surfaces a second nested ability-scores choice once the same feat is taken again', () => {
    const events = [...fighter6(), decide(`${fighter}@6/feat`, [asi])];
    const surfaced = featChoicesOutstanding(events);
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0]!.choiceId).not.toBe(asiChoice); // occurrence #1's id is already decided
    expect(surfaced[0]!.count).toBe(1);
  });

  it('applies the second occurrence answer on top of the first', () => {
    const base = [...fighter6(), decide(`${fighter}@6/feat`, [asi])];
    const second = featChoicesOutstanding(base)[0]!.choiceId;
    const facts = reduce([...base, decide(second, ['dex:+2'])], undefined, rules);
    const sheet = derive(facts, index, rules);
    expect(sheet.outstandingChoices.filter((c) => c.ownerId === asi)).toEqual([]);
    expect(sheet.abilities['str']!.score.value).toBe(19); // 15 + 2 (Soldier) + 2 (ASI #1)
    expect(sheet.abilities['dex']!.score.value).toBe(15); // 13 + 2 (ASI #2)
    expect(sheet.issues.filter((i) => i.code === 'decision.unknownChoice')).toEqual([]);
  });

  it('stacks two occurrences improving the SAME ability', () => {
    const base = [...fighter6(['con:+2']), decide(`${fighter}@6/feat`, [asi])];
    const second = featChoicesOutstanding(base)[0]!.choiceId;
    const sheet = derive(reduce([...base, decide(second, ['con:+2'])], undefined, rules), index, rules);
    expect(sheet.abilities['con']!.score.value).toBe(19); // 14 + 1 (Soldier) + 2 + 2
  });

  it('accepts the repeatable feat again at a later level (no selection.duplicate)', () => {
    const facts = reduce(fighter6(), undefined, rules);
    const sheet = derive(facts, index, rules);
    const issues = validateSelection(sheet, facts, index, `${fighter}@6/feat`, [asi]);
    expect(issues.filter((i) => i.code === 'selection.duplicate')).toEqual([]);
  });

  it('still rejects a NON-repeatable feat taken again (selection.duplicate)', () => {
    const events = fighter6().map((e) =>
      e.type === 'decision.made' && (e.payload as { choiceId: string }).choiceId === `${fighter}@4/feat`
        ? { ...e, payload: { choiceId: `${fighter}@4/feat`, selection: [`${P}:feat/alert`] } }
        : e,
    );
    const facts = reduce(events, undefined, rules);
    const sheet = derive(facts, index, rules);
    const issues = validateSelection(sheet, facts, index, `${fighter}@6/feat`, [`${P}:feat/alert`]);
    expect(issues.map((i) => i.code)).toContain('selection.duplicate');
  });

  it('validates an occurrence-scoped decision against the base choice', () => {
    const base = [...fighter6(), decide(`${fighter}@6/feat`, [asi])];
    const second = featChoicesOutstanding(base)[0]!.choiceId;
    const facts = reduce(base, undefined, rules);
    const sheet = derive(facts, index, rules);
    expect(validateSelection(sheet, facts, index, second, ['dex:+2'])).toEqual([]);
    expect(validateSelection(sheet, facts, index, second, ['str:+2']).map((i) => i.code)).toEqual([
      'selection.abilityMax',
    ]); // 19 + 2 > 20
  });

  it('keeps a legacy single-acquisition log byte-identical (occurrence #1 id unchanged)', () => {
    const facts = reduce(fighter6(), undefined, rules);
    const sheet = derive(facts, index, rules);
    expect(Object.keys(facts.decisions)).toContain(asiChoice);
    expect(sheet.abilities['str']!.score.value).toBe(19);
    expect(sheet.outstandingChoices.filter((c) => c.ownerId === asi)).toEqual([]);
  });

  it('resolves occurrence-scoped ids only for feat/feature owners, and only for ordinals ≥ 2', () => {
    expect(occurrenceChoiceId(asiChoice, 1)).toBe(asiChoice);
    expect(findChoice(index, occurrenceChoiceId(asiChoice, 3))?.choice.id).toBe(asiChoice);
    expect(findChoice(index, `${asiChoice}--1`)).toBeUndefined();
    expect(findChoice(index, `${fighter}@4/feat--2`)).toBeUndefined(); // class-owned: never re-acquired
    expect(splitOccurrence(`${asiChoice}--2`)).toEqual({ baseId: asiChoice, occurrence: 2 });
    const localizer = createLocalizer(index, 'en');
    expect(localizer.choicePrompt(occurrenceChoiceId(asiChoice, 2))).toEqual(localizer.choicePrompt(asiChoice));
    expect(localizer.choicePrompt(asiChoice).text).not.toBe('');
  });

  it('surfaces a third occurrence once the second is answered', () => {
    const base = [...fighter6(), decide(`${fighter}@6/feat`, [asi])];
    const second = featChoicesOutstanding(base)[0]!.choiceId;
    const events = [
      ...base,
      decide(second, ['dex:+2']),
      ev('level.gained', { classId: fighter, level: 7, hpRoll: 'average' }),
      ev('level.gained', { classId: fighter, level: 8, hpRoll: 'average' }),
      decide(`${fighter}@8/feat`, [asi]),
    ];
    expect(featChoicesOutstanding(events).map((c) => c.choiceId)).toEqual([occurrenceChoiceId(asiChoice, 3)]);
  });

  // Reviewer sub-question: `Composition.entities` dedupes by entity id, so a twice-taken feat's
  // DIRECT (passive) effects apply once. Pinned with `it.fails` as a slice-2 carry (see
  // final-wave-report.md): no shipped repeatable feat (ASI, Skilled, Magic Initiate) carries a
  // direct effect — their benefits all flow through nested choices, which ARE per-occurrence now.
  it.fails('stacks a twice-taken repeatable feat’s direct effects (slice-2 carry)', () => {
    const patched: Pack = structuredClone(pack);
    const feat = patched.entities.find((e) => e.id === asi)!;
    feat.effects = [...feat.effects, { type: 'ability.bonus', ability: 'wis', value: 1 }] as typeof feat.effects;
    const idx = createContentIndex([patched]);
    const events = [...fighter6(), decide(`${fighter}@6/feat`, [asi])];
    const sheet = derive(reduce(events, undefined, rules), idx, rules);
    expect(sheet.abilities['wis']!.score.value).toBe(14); // 12 + 1 + 1
  });
});
