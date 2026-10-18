import type { Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import type { AbilitiesResult } from '../../src/derive/abilities.ts';
import type { ActiveEffect, Composition } from '../../src/derive/composition.ts';
import { derive } from '../../src/derive/index.ts';
import { deriveResources } from '../../src/derive/resources.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';
import { loadDistPack } from '../support/golden.ts';

// Plan 13 task 3: a later `resource.define` re-declaring the SAME id may override the reset
// (Font of Inspiration: Bardic Inspiration becomes Short-Rest from bard level 5). Per field:
// `reset` is last-wins in `abilities.effects` order (composition's deterministic
// `source|feature|effect` sort); `max` keeps its pre-task-3 `sum-unique-key` stacking (same key ->
// highest wins); `name`/`display`/`source` stay first-wins. Pinned at the `deriveResources` seam
// with hand-built effects so the merge rule is tested independently of any pack content.

const index = createContentIndex([loadFixturePack('core-mini')]);
const comp: Composition = { entities: [], effects: [], classLevels: {}, totalLevel: 1, issues: [] };

const define = (
  feature: string,
  reset: 'shortRest' | 'longRest' | 'dawn' | 'never',
  max = '2',
  extra: { name?: string; display?: 'pips' | 'number' } = {},
): ActiveEffect => ({
  effect: {
    type: 'resource.define',
    id: 'pool',
    name: extra.name ?? 'Pool',
    max,
    reset,
    display: extra.display ?? 'pips',
  },
  source: 'x:class/a',
  feature,
});

const resourcesOf = (effects: ActiveEffect[]) =>
  deriveResources({ effects, prof: 2, abilities: {} } as unknown as AbilitiesResult, comp, emptyFacts('char:t'), index)
    .resources;

describe('resource.define merge (plan 13 task 3)', () => {
  it('a single define is unchanged: every field from that define (pre-task-3 characterization)', () => {
    expect(resourcesOf([define('x:feature/one', 'longRest', '3')])).toEqual([
      {
        id: 'pool',
        name: 'Pool',
        max: {
          value: 3,
          contributions: [
            {
              source: 'x:class/a',
              feature: 'x:feature/one',
              kind: 'resource.define',
              formula: '3',
              key: 'pool',
              amount: 3, // plan 14 task 6: evaluated amount next to the kept formula
            },
          ],
        },
        used: 0,
        reset: 'longRest',
        display: 'pips',
        source: 'x:feature/one',
      },
    ]);
  });

  it('a second define of the same id with a different reset: the later reset wins', () => {
    const [r] = resourcesOf([define('x:feature/one', 'longRest'), define('x:feature/two', 'shortRest')]);
    expect(r?.reset).toBe('shortRest');
  });

  it('three defines: the last one in effect order sets the reset', () => {
    const [r] = resourcesOf([
      define('x:feature/one', 'longRest'),
      define('x:feature/two', 'shortRest'),
      define('x:feature/three', 'dawn'),
    ]);
    expect(r?.reset).toBe('dawn');
  });

  it('a later define restating the same reset changes nothing', () => {
    const [r] = resourcesOf([define('x:feature/one', 'longRest'), define('x:feature/two', 'longRest')]);
    expect(r?.reset).toBe('longRest');
  });

  it('max stacking is unchanged: same id -> highest formula wins, both contributions listed', () => {
    const [r] = resourcesOf([define('x:feature/one', 'longRest', '2'), define('x:feature/two', 'shortRest', '5')]);
    expect(r?.max.value).toBe(5);
    expect(r?.max.contributions.map((c) => c.formula)).toEqual(['2', '5']);
    const [lower] = resourcesOf([define('x:feature/one', 'longRest', '5'), define('x:feature/two', 'shortRest', '2')]);
    expect(lower?.max.value).toBe(5);
  });

  it('name, display and source stay first-wins (only the reset is overridable)', () => {
    const [r] = resourcesOf([
      define('x:feature/one', 'longRest', '2', { name: 'First', display: 'pips' }),
      define('x:feature/two', 'shortRest', '2', { name: 'Second', display: 'number' }),
    ]);
    expect(r).toMatchObject({ name: 'First', display: 'pips', source: 'x:feature/one', reset: 'shortRest' });
  });
});

describe('resource.define merge across classes (derive-level)', () => {
  // Two classes each declaring the same resource id (patched onto the real pack's class entities):
  // the winner is fixed by composition's deterministic effect order, NOT by facts.classes order.
  const P = 'srd-5e-2024';
  const fighter = `${P}:class/fighter`;
  const wizard = `${P}:class/wizard`;
  const pack: Pack = structuredClone(loadDistPack(P));
  const withEffect = (id: string, effect: unknown) => {
    const e = pack.entities.find((x) => x.id === id) as unknown as { effects: unknown[] };
    e.effects.push(effect);
  };
  withEffect(fighter, { type: 'resource.define', id: 'test-pool', name: 'Test', max: '1', reset: 'longRest' });
  withEffect(wizard, { type: 'resource.define', id: 'test-pool', name: 'Test', max: '1', reset: 'shortRest' });
  const patched = createContentIndex([pack]);

  const resetWith = (classIds: string[]) => {
    const facts = emptyFacts('char:t');
    facts.classes = classIds.map((classId) => ({ classId, level: 1 }));
    return derive(facts, patched).resources.find((r) => r.id === 'test-pool')?.reset;
  };

  it('is independent of the order the classes were taken in', () => {
    expect(resetWith([fighter, wizard])).toBe('shortRest');
    expect(resetWith([wizard, fighter])).toBe('shortRest');
  });
});
