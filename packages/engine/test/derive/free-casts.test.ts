import type { Effect } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import type { AbilitiesResult } from '../../src/derive/abilities.ts';
import type { ActiveEffect, Composition } from '../../src/derive/composition.ts';
import { deriveFreeCasts } from '../../src/derive/free-casts.ts';
import { derive } from '../../src/derive/index.ts';
import { deriveResources } from '../../src/derive/resources.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

// Plan 13 task 4: `spell.grant.uses` is no longer a silent no-op.
// - Reference form `{resource}`: the free casts spend an EXISTING resource (no second counter).
// - Inline form `{count, per}`: materializes a counter keyed by the spell's slug, merged with any
//   `resource.define` of the same id under task 3's rules (so it can never duplicate one).
// Each grant with `uses` yields one `sheet.freeCasts` entry {spellId, resourceId, level}; the level is
// the grant's own `level` when authored, else the spell's base level (no upcast on the free lane).

const index = createContentIndex([loadFixturePack('core-mini')]);
const comp: Composition = { entities: [], effects: [], classLevels: {}, totalLevel: 1, issues: [] };
const fireball = 'core-mini:spell/fireball'; // level 3 in core-mini

const ae = (effect: Effect, feature = 'x:feature/one'): ActiveEffect => ({ effect, source: 'x:class/a', feature });
const grant = (uses: unknown, extra: Record<string, unknown> = {}): Effect =>
  ({ type: 'spell.grant', spell: fireball, alwaysPrepared: true, ...(uses ? { uses } : {}), ...extra }) as Effect;
const pool = (max = '2'): Effect => ({
  type: 'resource.define',
  id: 'pool',
  name: 'Pool',
  max,
  reset: 'longRest',
  display: 'pips',
});

const abilitiesOf = (effects: ActiveEffect[]) => ({ effects, prof: 2, abilities: {} }) as unknown as AbilitiesResult;
const resourcesOf = (effects: ActiveEffect[]) =>
  deriveResources(abilitiesOf(effects), comp, emptyFacts('char:t'), index).resources;
const freeCastsOf = (effects: ActiveEffect[]) => deriveFreeCasts(abilitiesOf(effects), index, resourcesOf(effects));

describe('spell.grant.uses — reference form', () => {
  it('links the grant to the existing resource; no extra resource is created', () => {
    const effects = [ae(grant({ resource: 'pool' })), ae(pool())];
    expect(resourcesOf(effects).map((r) => r.id)).toEqual(['pool']);
    expect(freeCastsOf(effects)).toEqual({
      freeCasts: [{ spellId: fireball, resourceId: 'pool', level: 3 }],
      issues: [],
    });
  });

  it('the grant level overrides the spell base level', () => {
    const effects = [ae(grant({ resource: 'pool' }, { level: 4 })), ae(pool())];
    expect(freeCastsOf(effects).freeCasts).toEqual([{ spellId: fireball, resourceId: 'pool', level: 4 }]);
  });

  it('a reference to a resource the sheet does not have is not offered, and warns', () => {
    const { freeCasts, issues } = freeCastsOf([ae(grant({ resource: 'missing' }))]);
    expect(freeCasts).toEqual([]);
    expect(issues.map((i) => [i.severity, i.code])).toEqual([['warning', 'derive.freeCastResourceMissing']]);
  });

  it('two grants of the same spell and resource yield one entry', () => {
    const effects = [ae(grant({ resource: 'pool' })), ae(grant({ resource: 'pool' }), 'x:feature/two'), ae(pool())];
    expect(freeCastsOf(effects).freeCasts).toHaveLength(1);
  });

  it('a grant without uses offers no free cast and creates no resource', () => {
    const effects = [ae(grant(undefined))];
    expect(resourcesOf(effects)).toEqual([]);
    expect(freeCastsOf(effects).freeCasts).toEqual([]);
  });
});

describe('spell.grant.uses — inline form', () => {
  it('materializes a counter keyed by the spell slug (name from the spell, reset from per, source the feature)', () => {
    const effects = [ae(grant({ count: 'prof', per: 'shortRest' }))];
    expect(resourcesOf(effects)).toEqual([
      {
        id: 'fireball',
        name: 'Fireball',
        max: {
          value: 2,
          contributions: [
            { source: 'x:class/a', feature: 'x:feature/one', kind: 'spell.grant', formula: 'prof', key: 'fireball' },
          ],
        },
        used: 0,
        reset: 'shortRest',
        display: 'pips',
        source: 'x:feature/one',
      },
    ]);
    expect(freeCastsOf(effects).freeCasts).toEqual([{ spellId: fireball, resourceId: 'fireball', level: 3 }]);
  });

  it('merges with a resource.define of the same id instead of duplicating it (highest max)', () => {
    const define: Effect = {
      type: 'resource.define',
      id: 'fireball',
      name: 'F',
      max: '5',
      reset: 'longRest',
      display: 'pips',
    };
    const effects = [ae(define), ae(grant({ count: '1', per: 'longRest' }), 'x:feature/two')];
    const resources = resourcesOf(effects);
    expect(resources.map((r) => [r.id, r.max.value])).toEqual([['fireball', 5]]);
  });
});

describe('Sheet.freeCasts', () => {
  it('is absent (not merely empty) when nothing grants a free cast', () => {
    expect('freeCasts' in derive(emptyFacts('char:t'), index)).toBe(false);
  });
});
