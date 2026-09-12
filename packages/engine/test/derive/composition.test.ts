import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { compose } from '../../src/derive/composition.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');

describe('compose', () => {
  it('activates a species and its granted features (recursive grants, unconditional)', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/species'] = ['homebrew-mini:species/catfolk'];
    const c = compose(facts, index);

    expect(c.entities).toEqual(
      ['core-mini:feature/darkvision', 'homebrew-mini:feature/cat-reflexes', 'homebrew-mini:species/catfolk'].sort(),
    );
    expect(c.issues).toEqual([]);

    const sense = c.effects.find((e) => e.effect.type === 'sense.grant');
    expect(sense).toMatchObject({ source: 'homebrew-mini:species/catfolk', feature: 'core-mini:feature/darkvision' });

    const init = c.effects.find((e) => e.effect.type === 'initiative.bonus');
    expect(init).toMatchObject({
      source: 'homebrew-mini:species/catfolk',
      feature: 'homebrew-mini:feature/cat-reflexes',
    });
  });

  it('gates class-level-row grants by classLevels, and a failing classLevel predicate keeps a grant inactive', () => {
    const facts = baseFacts();
    facts.classes = [{ classId: 'core-mini:class/fighter', level: 3 }];
    const c = compose(facts, index);

    expect(c.classLevels).toEqual({ 'core-mini:class/fighter': 3 });
    expect(c.totalLevel).toBe(3);

    // rows at level 1 and 2 are <= 3: their grants contribute.
    expect(c.entities).toContain('core-mini:feature/second-wind');
    expect(c.entities).toContain('core-mini:feature/action-surge');
    // row at level 5 is > 3: it does not contribute.
    expect(c.entities).not.toContain('core-mini:feature/extra-attack');
    // row at level 3 is <= 3 (active), but its grant's own `when` (classLevel fighter >= 10) fails.
    expect(c.entities).not.toContain('core-mini:feature/weapon-master');
  });

  it('reports an unresolved decision id as a warning instead of throwing', () => {
    const facts = baseFacts();
    facts.decisions['core-mini:system/mini@0/species'] = ['homebrew-mini:species/nonexistent'];

    let c: ReturnType<typeof compose> | undefined;
    expect(() => {
      c = compose(facts, index);
    }).not.toThrow();

    expect(c!.entities).toEqual([]);
    expect(c!.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'derive.unresolvedEntity',
        entityId: 'homebrew-mini:species/nonexistent',
      }),
    ]);
  });

  it('activates an equipped item and its effects, but not an unequipped one', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/cloak-of-protection', qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: 'core-mini:item/ring-of-warmth', qty: 1, equipped: false, attuned: false },
    ];
    const c = compose(facts, index);

    expect(c.entities).toEqual(['core-mini:item/cloak-of-protection']);
    expect(c.effects.some((e) => e.effect.type === 'damage.resistance')).toBe(false);

    const acBonus = c.effects.find((e) => e.effect.type === 'ac.bonus' && e.effect.key === 'cloak');
    expect(acBonus).toMatchObject({ source: 'core-mini:item/cloak-of-protection' });
    expect(acBonus?.deferred).toBeUndefined();
  });

  it('marks an effect whose predicate needs ability scores as deferred, without evaluating it', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/cloak-of-protection', qty: 1, equipped: true, attuned: false },
    ];
    const c = compose(facts, index);

    const gated = c.effects.find((e) => e.effect.type === 'ac.bonus' && e.effect.key === 'str-gated');
    expect(gated).toMatchObject({ source: 'core-mini:item/cloak-of-protection', deferred: true });
  });
});
