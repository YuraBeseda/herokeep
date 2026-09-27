import { DiceOrFlatSchema } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { transformItems } from '../src/transform/items.ts';
import { expectAllValid } from './support/valid.ts';

describe('item transform', () => {
  const items = transformItems();
  const byId = new Map(items.map((i) => [i.id, i]));

  it('every item validates; mundane + magic counts add up', () => {
    expectAllValid(items);
    // Pinned from `readFixture('MagicItem').length` against the vendored open5e-srd-2024 snapshot (R4/step 2).
    const nMagic = 757;
    expect(items).toHaveLength(203 + nMagic);
    expect(nMagic).toBeGreaterThanOrEqual(200);
  });

  it('spot golden: Longsword (SRD 5.2.1)', () => {
    expect(byId.get('srd-5e-2024:item/longsword')).toMatchObject({
      category: 'weapon',
      weapon: {
        kind: 'melee',
        category: 'martial',
        damage: '1d8',
        damageType: 'slashing',
        versatile: '1d10',
        mastery: 'sap',
      },
      cost: { amount: 15, currency: 'gp' },
    });
  });

  it('spot golden: Chain Mail and Shield (SRD 5.2.1)', () => {
    expect(byId.get('srd-5e-2024:item/chain-mail')).toMatchObject({
      category: 'armor',
      // Heavy armor adds no Dex bonus at all (SRD 5.2.1) — dexCap must be explicit 0, not absent:
      // derive/defense.ts's tested contract treats an absent dexCap as "uncapped", not "no Dex".
      armor: { category: 'heavy', ac: 16, dexCap: 0, strength: 13, stealthDisadvantage: true },
      cost: { amount: 75, currency: 'gp' },
    });
    expect(byId.get('srd-5e-2024:item/shield')).toMatchObject({ category: 'shield', shield: { ac: 2 } });
  });

  it('armor dexCap is principled by category: every heavy armor is 0, medium keeps its upstream cap, light is uncapped', () => {
    const armors = items.filter(
      (i): i is typeof i & { armor: { category: string; dexCap?: number } } =>
        (i as { category?: string }).category === 'armor',
    );
    expect(armors.length).toBeGreaterThanOrEqual(10);

    const heavy = armors.filter((a) => a.armor.category === 'heavy');
    expect(heavy.length).toBeGreaterThanOrEqual(4);
    for (const a of heavy) expect(a.armor.dexCap, a.id).toBe(0);

    // Spot golden: Breastplate is medium armor, capped at +2 Dex (SRD 5.2.1).
    expect(byId.get('srd-5e-2024:item/breastplate')).toMatchObject({ armor: { category: 'medium', dexCap: 2 } });

    const light = armors.filter((a) => a.armor.category === 'light');
    expect(light.length).toBeGreaterThanOrEqual(3);
    for (const a of light) expect(a.armor.dexCap, a.id).toBeUndefined();
  });

  it('every weapon has exactly one mastery and a valid dice-or-flat damage value', () => {
    const weapons = items.filter((i) => (i as { category?: string }).category === 'weapon');
    expect(weapons.length).toBeGreaterThanOrEqual(30);
    for (const w of weapons) {
      const wp = (w as { weapon?: { mastery?: string; damage?: unknown } }).weapon;
      expect(wp?.mastery, w.id).toBeTruthy();
      expect(DiceOrFlatSchema.safeParse(wp?.damage).success, w.id).toBe(true);
    }
  });

  it('spot golden: Blowgun deals a flat 1 Piercing damage, not a zero-count-die hack (ruling 6, SRD 5.2.1)', () => {
    // Confirmed against the vendored snapshot: Weapon.json's `srd-2024_blowgun.damage_dice` is the
    // bare string "1" (every other weapon's `damage_dice` matches `NdS` notation) — the ONLY weapon
    // in this vendored SRD 5.2.1 subset without die-roll damage (verified via a full scan). Rule.json's
    // own "Damage Rolls" entry confirms this is intentional SRD text: "you don't add your ability
    // modifier to a fixed damage amount that doesn't use a roll, such as the damage of a Blowgun."
    expect(byId.get('srd-5e-2024:item/blowgun')).toMatchObject({
      category: 'weapon',
      weapon: { kind: 'ranged', category: 'martial', damage: { flat: 1 }, damageType: 'piercing' },
    });
  });

  it('magic items carry rarity and attunement where required', () => {
    const magic = items.filter((i) => (i as { category?: string }).category === 'magic');
    expect(magic.some((m) => (m as { attunement?: { required: boolean } }).attunement?.required)).toBe(true);
    for (const m of magic) expect((m as { rarity?: string }).rarity, m.id).toBeTruthy();
  });
});
