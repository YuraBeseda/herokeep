import { describe, expect, it } from 'vitest';
import { EntityIdSchema, isEntityId, makeEntityId, parseEntityId } from '../src/ids.ts';

describe('entity ids', () => {
  it('parses a well-formed id', () => {
    expect(parseEntityId('srd-5e-2024:spell/fireball')).toEqual({
      packId: 'srd-5e-2024',
      type: 'spell',
      slug: 'fireball',
    });
  });

  it.each([
    ['Srd:spell/fireball', 'uppercase pack id'],
    ['ab:spell/fireball', 'pack id shorter than 3'],
    ['srd-5e-2024:spell', 'missing slug'],
    ['srd-5e-2024:dragon/fireball', 'unknown type'],
    ['srd-5e-2024:spell/-fireball', 'slug starting with dash'],
    ['srd-5e-2024:spell/Fire Ball', 'spaces'],
    ['', 'empty'],
  ])('rejects %s (%s)', (id) => {
    expect(parseEntityId(id)).toBeNull();
    expect(isEntityId(id)).toBe(false);
    expect(EntityIdSchema.safeParse(id).success).toBe(false);
  });

  it('round-trips through makeEntityId', () => {
    const id = makeEntityId('ivan-homebrew', 'species', 'catfolk');
    expect(id).toBe('ivan-homebrew:species/catfolk');
    expect(EntityIdSchema.parse(id)).toBe(id);
  });
});
