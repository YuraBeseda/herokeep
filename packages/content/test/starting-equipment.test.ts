import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';
import { parseStartingEquipment, startingEquipmentFor } from '../src/transform/starting-equipment.ts';

const P = 'srd-5e-2024:item/';
const fixture = (text: string) => parseStartingEquipment(text, (n) => ({ item: P + n.toLowerCase().replace(/\W+/g, '-') }));

describe('parseStartingEquipment', () => {
  it('barbarian: A items + gp, B gold only', () => {
    expect(
      fixture("Choose A or B: (A) Greataxe, 4 Handaxes, Explorer's Pack, and 15 GP; or (B) 75 GP").map((o) => [o.label, o.items.length, o.gp]),
    ).toEqual([['A', 3, 15], ['B', 0, 75]]);
  });
  it('notes land in notes; unknown names throw naming the item and source', () => {
    const r = parseStartingEquipment('(A) Lute, 2 GP', () => ({ note: 'An instrument' }));
    expect(r[0]).toEqual({ label: 'A', items: [], notes: ['An instrument'], gp: 2 });
    expect(() => startingEquipmentFor('(A) Unobtainium Sword, 2 GP', 'class x')).toThrow(/Unobtainium Sword.*class x/);
  });
});

describe('startingEquipment in the pack', () => {
  const pack = buildPack();
  const get = (id: string) =>
    pack.entities.find((e) => e.id === id) as unknown as { startingEquipment: { label: string; items: { item: string; qty: number }[]; gp: number }[] };

  it('barbarian, fighter and soldier match the SRD', () => {
    const barb = get('srd-5e-2024:class/barbarian').startingEquipment;
    expect(barb[0]!.items).toEqual([
      { item: P + 'greataxe', qty: 1 },
      { item: P + 'handaxe', qty: 4 },
      { item: P + 'explorers-pack', qty: 1 },
    ]);
    expect([barb[0]!.gp, barb[1]!.gp]).toEqual([15, 75]);
    const fighter = get('srd-5e-2024:class/fighter').startingEquipment;
    expect(fighter.map((o) => o.label)).toEqual(['A', 'B', 'C']);
    expect(fighter[2]!.gp).toBe(155);
    const soldier = get('srd-5e-2024:background/soldier').startingEquipment;
    expect([soldier[0]!.gp, soldier[1]!.gp]).toEqual([14, 50]);
  });

  it('all 12 classes and every background have options whose items resolve to item entities', () => {
    const items = new Set(pack.entities.filter((e) => e.type === 'item').map((e) => e.id));
    const owners = pack.entities.filter((e) => e.type === 'class' || e.type === 'background');
    expect(owners.filter((e) => e.type === 'class')).toHaveLength(12);
    for (const e of owners) {
      const opts = (e as unknown as { startingEquipment?: { items: { item: string }[] }[] }).startingEquipment;
      expect(opts, e.id).toBeDefined();
      for (const o of opts!) for (const i of o.items) expect(items.has(i.item), `${e.id} -> ${i.item}`).toBe(true);
    }
  });
});
