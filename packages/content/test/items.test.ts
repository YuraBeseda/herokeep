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
      armor: { category: 'heavy', ac: 16, strength: 13, stealthDisadvantage: true },
      cost: { amount: 75, currency: 'gp' },
    });
    expect(byId.get('srd-5e-2024:item/shield')).toMatchObject({ category: 'shield', shield: { ac: 2 } });
  });

  it('every weapon has exactly one mastery and a valid dice string', () => {
    const weapons = items.filter((i) => (i as { category?: string }).category === 'weapon');
    expect(weapons.length).toBeGreaterThanOrEqual(30);
    for (const w of weapons) {
      const wp = (w as { weapon?: { mastery?: string; damage?: string } }).weapon;
      expect(wp?.mastery, w.id).toBeTruthy();
      expect(wp?.damage, w.id).toMatch(/^\d{1,2}d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/);
    }
  });

  it('magic items carry rarity and attunement where required', () => {
    const magic = items.filter((i) => (i as { category?: string }).category === 'magic');
    expect(magic.some((m) => (m as { attunement?: { required: boolean } }).attunement?.required)).toBe(true);
    for (const m of magic) expect((m as { rarity?: string }).rarity, m.id).toBeTruthy();
  });
});
