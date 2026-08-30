import { describe, expect, it } from 'vitest';
import { findChoice } from '../../src/content/choices.ts';
import { createContentIndex } from '../../src/content/index.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const core = loadFixturePack('core-mini');

describe('findChoice', () => {
  it('finds a choice nested in a class level row', () => {
    const index = createContentIndex([core]);
    const hit = findChoice(index, 'core-mini:class/fighter@1/fighting-style');
    expect(hit?.owner.id).toBe('core-mini:class/fighter');
    expect(hit?.choice.id).toBe('core-mini:class/fighter@1/fighting-style');
  });

  it('returns undefined for a choice that does not exist', () => {
    const index = createContentIndex([core]);
    expect(findChoice(index, 'core-mini:class/fighter@9/none')).toBeUndefined();
  });
});
