import { describe, expect, it } from 'vitest';
import { ChoiceSchema, parseChoiceId } from '../src/pack/choice.ts';

describe('choice ids', () => {
  it('parses <entityId>@<level>/<slug>', () => {
    expect(parseChoiceId('srd-5e-2024:class/fighter@1/fighting-style')).toEqual({
      entityId: 'srd-5e-2024:class/fighter',
      level: 1,
      slug: 'fighting-style',
    });
    expect(parseChoiceId('srd-5e-2024:system/5e-2024@0/ability-scores')?.level).toBe(0);
    expect(parseChoiceId('srd-5e-2024:class/fighter/fighting-style')).toBeNull();
  });
});

describe('ChoiceSchema', () => {
  it('accepts every pick form', () => {
    const base = { prompt: 'Choose', at: { kind: 'classLevel', class: 'fighter', level: 1 } };
    const picks = [
      { static: ['srd-5e-2024:feat/defense', 'srd-5e-2024:feat/archery'] },
      { query: { type: 'feat', tags: ['fighting-style'] } },
      { query: { type: 'spell', level: 1, classes: ['wizard'] } },
      { abilities: { count: 1, improve: '+2/+1' } },
      { abilityGeneration: true },
      { literal: 'text' },
      {
        equipmentOption: [
          [{ item: 'srd-5e-2024:item/chain-mail' }],
          [{ item: 'srd-5e-2024:item/leather-armor', qty: 1 }],
        ],
      },
    ];
    picks.forEach((pick, i) => {
      const r = ChoiceSchema.safeParse({ id: `srd-5e-2024:class/fighter@1/c${i}`, ...base, pick });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });
  });

  it('applies defaults and rejects bad shapes', () => {
    const c = ChoiceSchema.parse({
      id: 'srd-5e-2024:class/fighter@4/asi',
      prompt: 'Ability Score Improvement or feat',
      at: { kind: 'classLevel', class: 'fighter', level: 4 },
      pick: { query: { type: 'feat', tags: ['general'] } },
      repeatableAt: [6, 8, 12, 14, 16, 19],
    });
    expect(c.count).toBe(1);
    expect(c.unique).toBe(true);
    expect(c.prerequisites).toEqual([]);
    expect(ChoiceSchema.safeParse({ ...c, at: { kind: 'classLevel', class: 'fighter' } }).success).toBe(false);
    expect(ChoiceSchema.safeParse({ ...c, pick: { static: [] } }).success).toBe(false);
    expect(ChoiceSchema.safeParse({ ...c, id: 'not-a-choice-id' }).success).toBe(false);
  });
});
