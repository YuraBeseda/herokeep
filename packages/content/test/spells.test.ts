import { describe, expect, it } from 'vitest';
import { transformSpells } from '../src/transform/spells.ts';
import { expectAllValid } from './support/valid.ts';

describe('spell transform', () => {
  const spells = transformSpells();
  const byId = new Map(spells.map((s) => [s.id, s]));

  it('produces 339 schema-valid spells', () => {
    expect(spells).toHaveLength(339);
    expectAllValid(spells);
  });

  it('spot golden: Fireball (hand-checked against SRD 5.2.1)', () => {
    const f = byId.get('srd-5e-2024:spell/fireball');
    expect(f).toMatchObject({
      type: 'spell',
      name: 'Fireball',
      level: 3,
      school: 'evocation',
      concentration: false,
      ritual: false,
      components: { v: true, s: true, m: true },
      range: { kind: 'feet', distance: 150 },
      damage: { dice: '8d6', type: 'fire' },
      save: 'dex',
    });
    expect((f as { classes?: string[] })?.classes).toContain('wizard');
    expect((f as { higherLevels?: string })?.higherLevels).toBeTruthy();
  });

  it('spot golden: Mage Armor and a cantrip', () => {
    expect(byId.get('srd-5e-2024:spell/mage-armor')).toMatchObject({ level: 1, range: { kind: 'touch' } });
    const cantrips = spells.filter((s) => (s as { level?: number }).level === 0);
    // SRD 5.2.1: the 24 cantrips of SRD 5.1 + Elementalism, Sorcerous Burst, Starry Wisp (ruling R13; the plan's ≥30 was wrong)
    expect(cantrips).toHaveLength(27);
  });

  it('keeps special-cased ranges/durations rare', () => {
    const specialRange = spells.filter((s) => (s as { range?: { kind: string } }).range?.kind === 'special').length;
    const specialDuration = spells.filter(
      (s) => (s as { duration?: { kind: string } }).duration?.kind === 'special',
    ).length;
    expect(specialRange, 'range special-cases').toBeLessThanOrEqual(30);
    expect(specialDuration, 'duration special-cases').toBeLessThanOrEqual(40);
  });

  describe('attack (R22: derived from desc text, not attack_roll)', () => {
    it('Bless makes no spell attack: attack is omitted even though upstream attack_roll is true', () => {
      const bless = byId.get('srd-5e-2024:spell/bless') as { attack?: string };
      expect(bless?.attack).toBeUndefined();
    });

    it('Fire Bolt ("ranged spell attack" in its desc) is attack: ranged', () => {
      expect(byId.get('srd-5e-2024:spell/fire-bolt')).toMatchObject({ attack: 'ranged' });
    });

    it('Shocking Grasp ("melee spell attack" in its desc) is attack: melee', () => {
      expect(byId.get('srd-5e-2024:spell/shocking-grasp')).toMatchObject({ attack: 'melee' });
    });

    it('exactly 13 spells are attack: ranged and 8 are attack: melee (desc-regex sweep of all 339)', () => {
      const withAttack = spells.filter((s) => (s as { attack?: string }).attack !== undefined) as {
        attack: string;
      }[];
      expect(withAttack.filter((s) => s.attack === 'ranged')).toHaveLength(13);
      expect(withAttack.filter((s) => s.attack === 'melee')).toHaveLength(8);
    });
  });
});
