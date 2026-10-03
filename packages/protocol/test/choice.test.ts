import { describe, expect, it } from 'vitest';
import { ChoiceSchema, EntityQuerySchema, parseChoiceId } from '../src/pack/choice.ts';

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

describe('ChoiceSchema count (plan 12 task 2: progression-driven counts)', () => {
  const base = {
    id: 'srd-5e-2024:class/fighter@1/weapon-masteries',
    prompt: 'Weapon Masteries',
    at: { kind: 'classLevel', class: 'fighter', level: 1 },
    pick: { query: { type: 'item', hasField: ['weapon.mastery'] } },
  };

  it('keeps an integer count byte-identical', () => {
    expect(ChoiceSchema.parse({ ...base, count: 3 }).count).toBe(3);
    expect(ChoiceSchema.safeParse({ ...base, count: 0 }).success).toBe(false);
    expect(ChoiceSchema.safeParse({ ...base, count: 1.5 }).success).toBe(false);
  });

  it('accepts a formula-string count (resolved by the engine against the character)', () => {
    const f = '3 + min(1, floor(classLevel(fighter) / 4))';
    expect(ChoiceSchema.parse({ ...base, count: f }).count).toBe(f);
    expect(ChoiceSchema.safeParse({ ...base, count: '' }).success).toBe(false);
    expect(ChoiceSchema.safeParse({ ...base, count: 'DROP TABLE;' }).success).toBe(false);
  });
});

describe('EntityQuerySchema hasField (ruling 4: weapon-mastery choices as real entity queries)', () => {
  it('accepts a dot-path field-presence filter, alone or combined with tags (AND semantics)', () => {
    expect(EntityQuerySchema.safeParse({ type: 'item', hasField: ['weapon.mastery'] }).success).toBe(true);
    expect(EntityQuerySchema.safeParse({ type: 'item', hasField: ['weapon.mastery'], tags: ['martial'] }).success).toBe(
      true,
    );
    expect(EntityQuerySchema.safeParse({ type: 'item', hasField: ['armor.stealthDisadvantage'] }).success).toBe(true);
  });

  it('rejects malformed paths', () => {
    expect(EntityQuerySchema.safeParse({ type: 'item', hasField: ['weapon mastery'] }).success).toBe(false);
    expect(EntityQuerySchema.safeParse({ type: 'item', hasField: ['.weapon'] }).success).toBe(false);
    expect(EntityQuerySchema.safeParse({ type: 'item', hasField: [''] }).success).toBe(false);
  });
});
