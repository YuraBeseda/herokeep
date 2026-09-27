import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const baseFacts = () => emptyFacts('char:test');

const wand = 'core-mini:item/wand-of-sparks'; // charges: { max: "3", reset: "dawn" }
const longsword = 'core-mini:item/longsword'; // no `charges` field at all

/**
 * Ruling 3 (phase 4, plan 11 task 4 — "item charges = per-instance resources"): `deriveResources`
 * (packages/engine/src/derive/resources.ts) materializes one `ResourceView` per ACTIVE
 * (equipped-or-attuned — composition.ts:228's own gate, mirrored here per-instance since
 * `facts.inventory` entries, unlike `Composition.entities`, are never deduplicated by itemId) item
 * whose entity declares `charges`, keyed `item:<instanceId>` — reusing the exact same
 * `ModifierTable`/`facts.resourcesUsed` machinery a `resource.define` effect gets, with zero new
 * events (`resource.spent`/`resource.restored` already carry any `resourceId`, widened additively
 * in `@hk/protocol` to accept this shape — see `packages/protocol/src/events/character.ts`).
 */
describe('deriveResources: item charges (ruling 3)', () => {
  it('materializes a resource for an EQUIPPED charged item, keyed item:<instanceId>', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: wand, qty: 1, equipped: true, attuned: false }];
    const sheet = derive(facts, index);

    expect(sheet.resources).toEqual([
      {
        id: 'item:i1',
        name: 'Wand of Sparks',
        max: { value: 3, contributions: [expect.objectContaining({ kind: 'item.charges', formula: '3' })] },
        used: 0,
        reset: 'dawn',
        display: 'number',
        source: wand,
      },
    ]);
  });

  it('materializes for an ATTUNED-but-not-equipped charged item too', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: wand, qty: 1, equipped: false, attuned: true }];
    const sheet = derive(facts, index);

    expect(sheet.resources.map((r) => r.id)).toEqual(['item:i1']);
  });

  it('does NOT materialize a resource for an INACTIVE charged item (neither equipped nor attuned)', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: wand, qty: 1, equipped: false, attuned: false }];
    const sheet = derive(facts, index);

    expect(sheet.resources).toEqual([]);
  });

  it('reads `used` from facts.resourcesUsed under the SAME item:<instanceId> key', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: wand, qty: 1, equipped: true, attuned: false }];
    facts.resourcesUsed = { 'item:i1': 2 };
    const sheet = derive(facts, index);

    expect(sheet.resources[0]).toMatchObject({ id: 'item:i1', used: 2 });
  });

  it('two equipped instances of the SAME charged item type get independent resources', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: wand, qty: 1, equipped: true, attuned: false },
      { instanceId: 'i2', itemId: wand, qty: 1, equipped: true, attuned: false },
    ];
    facts.resourcesUsed = { 'item:i1': 1 };
    const sheet = derive(facts, index);

    expect(sheet.resources.map((r) => ({ id: r.id, used: r.used }))).toEqual([
      { id: 'item:i1', used: 1 },
      { id: 'item:i2', used: 0 },
    ]);
  });

  it('an equipped item with no `charges` field contributes no resource', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: longsword, qty: 1, equipped: true, attuned: false }];
    const sheet = derive(facts, index);

    expect(sheet.resources).toEqual([]);
  });

  it('an unresolved itemId (deleted/unknown) contributes no resource and no crash', () => {
    const facts = baseFacts();
    facts.inventory = [
      { instanceId: 'i1', itemId: 'core-mini:item/does-not-exist', qty: 1, equipped: true, attuned: false },
    ];
    const sheet = derive(facts, index);

    expect(sheet.resources).toEqual([]);
  });

  it('re-equipping preserves a previously-accrued used count (facts.resourcesUsed persists while inactive)', () => {
    const facts = baseFacts();
    facts.inventory = [{ instanceId: 'i1', itemId: wand, qty: 1, equipped: false, attuned: false }];
    facts.resourcesUsed = { 'item:i1': 3 }; // spent while it was active; now unequipped
    const inactive = derive(facts, index);
    expect(inactive.resources).toEqual([]); // definition disappears while inactive (documented v1 choice)

    facts.inventory[0]!.equipped = true;
    const reactivated = derive(facts, index);
    expect(reactivated.resources[0]).toMatchObject({ id: 'item:i1', used: 3 }); // used count survived
  });
});
