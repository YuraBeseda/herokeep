import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EFFECT_TYPES, EffectSchema } from '../src/pack/effects.ts';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/effects-one-of-each.json', import.meta.url), 'utf8'),
) as unknown[];

describe('EffectSchema', () => {
  it('accepts one example of every effect type', () => {
    for (const example of fixture) {
      const r = EffectSchema.safeParse(example);
      expect(r.success, JSON.stringify(example) + '\n' + JSON.stringify(r.error?.issues)).toBe(true);
    }
  });

  it('covers every EFFECT_TYPES entry exactly once', () => {
    const types = fixture.map((e) => (e as { type: string }).type).sort();
    expect(types).toEqual([...EFFECT_TYPES].sort());
    expect(new Set(types).size).toBe(EFFECT_TYPES.length);
  });

  it('rejects unknown types, extra keys and bad values', () => {
    expect(EffectSchema.safeParse({ type: 'ability.boost', ability: 'str', value: 2 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'ability.bonus', ability: 'str', value: 2, extra: 1 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'ability.bonus', ability: 'strength', value: 2 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'speed.set', mode: 'teleport', value: 30 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'slot.bonus', level: 10, count: 1 }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'advantage.grant', on: 'everything' }).success).toBe(false);
  });

  it('applies defaults', () => {
    const r = EffectSchema.parse({ type: 'proficiency.grant', kind: 'weapon', target: 'martial' });
    expect(r).toMatchObject({ level: 'proficient' });
    const s = EffectSchema.parse({ type: 'ability.set', ability: 'str', value: 19 });
    expect(s).toMatchObject({ ifHigher: true });
  });
});
