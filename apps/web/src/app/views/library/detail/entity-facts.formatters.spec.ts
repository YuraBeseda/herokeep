import type { ClassEntity, Entity, ItemEntity, SpeciesEntity, SpellEntity } from '@hk/protocol';
import {
  factRowsFor,
  formatArmorClass,
  formatCastingTime,
  formatComponents,
  formatCost,
  formatDuration,
  formatRange,
  formatWeaponDamage,
} from './entity-facts.formatters';

// Minimal fixtures — just the fields each formatter reads, typed against the real protocol
// entity types so a schema change breaks this file loudly rather than silently drifting.
const fireballCastingTime: SpellEntity['castingTime'] = { value: 1, unit: 'action' };
const fireballRange: SpellEntity['range'] = { kind: 'feet', distance: 150 };
const fireballDuration: SpellEntity['duration'] = { kind: 'instantaneous' };
const fireballComponents: SpellEntity['components'] = {
  v: true,
  s: true,
  m: true,
  materialText: 'a ball of bat guano and sulfur',
};

describe('entity-facts.formatters', () => {
  describe('formatCastingTime', () => {
    it('keys a single action', () => {
      expect(formatCastingTime(fireballCastingTime)).toEqual({
        kind: 'key',
        key: 'fact.unit.action',
        params: { value: 1 },
      });
    });

    it('keys a multi-minute ritual casting time', () => {
      expect(formatCastingTime({ value: 10, unit: 'minute' })).toEqual({
        kind: 'key',
        key: 'fact.unit.minute',
        params: { value: 10 },
      });
    });

    it('throws for an unrecognized unit (schema drift guard)', () => {
      expect(() =>
        formatCastingTime({ value: 1, unit: 'fortnight' as SpellEntity['castingTime']['unit'] }),
      ).toThrow();
    });
  });

  describe('formatRange', () => {
    it('keys a feet distance', () => {
      expect(formatRange(fireballRange)).toEqual({
        kind: 'key',
        key: 'fact.unit.feet',
        params: { value: 150 },
      });
    });

    it('keys a miles distance', () => {
      expect(formatRange({ kind: 'miles', distance: 1 })).toEqual({
        kind: 'key',
        key: 'fact.unit.mile',
        params: { value: 1 },
      });
    });

    it.each(['self', 'touch', 'sight', 'unlimited', 'special'] as const)(
      'keys the %s range kind with no numeric distance',
      (rangeKind) => {
        expect(formatRange({ kind: rangeKind })).toEqual({
          kind: 'key',
          key: `fact.rangeKind.${rangeKind}`,
          params: {},
        });
      },
    );
  });

  describe('formatDuration', () => {
    it('keys instantaneous with no value', () => {
      expect(formatDuration(fireballDuration)).toEqual({
        kind: 'key',
        key: 'fact.durationKind.instantaneous',
        params: {},
      });
    });

    it('keys untilDispelled and special with no value', () => {
      expect(formatDuration({ kind: 'untilDispelled' })).toEqual({
        kind: 'key',
        key: 'fact.durationKind.untilDispelled',
        params: {},
      });
      expect(formatDuration({ kind: 'special' })).toEqual({
        kind: 'key',
        key: 'fact.durationKind.special',
        params: {},
      });
    });

    it('keys a time-kind duration by its unit and value', () => {
      expect(formatDuration({ kind: 'time', value: 1, unit: 'hour' })).toEqual({
        kind: 'key',
        key: 'fact.unit.hour',
        params: { value: 1 },
      });
    });

    it('defaults a time-kind duration with no unit to rounds', () => {
      expect(formatDuration({ kind: 'time', value: 1 })).toEqual({
        kind: 'key',
        key: 'fact.unit.round',
        params: { value: 1 },
      });
    });
  });

  describe('formatComponents', () => {
    it('formats V/S/M with the material text in parentheses', () => {
      expect(formatComponents(fireballComponents)).toEqual({
        kind: 'text',
        text: 'V, S, M (a ball of bat guano and sulfur)',
      });
    });

    it('omits absent letters and the material text when M is false', () => {
      expect(formatComponents({ v: true, s: false, m: false })).toEqual({
        kind: 'text',
        text: 'V',
      });
    });

    it('omits the material text when M is true but materialText is absent', () => {
      expect(formatComponents({ v: false, s: true, m: true })).toEqual({
        kind: 'text',
        text: 'S, M',
      });
    });
  });

  describe('formatCost / formatWeaponDamage / formatArmorClass', () => {
    it('formats an item cost as amount + currency', () => {
      expect(formatCost({ amount: 50, currency: 'gp' })).toEqual({ kind: 'text', text: '50 gp' });
    });

    it('formats weapon damage as dice + damage type', () => {
      const weapon: NonNullable<ItemEntity['weapon']> = {
        kind: 'melee',
        category: 'martial',
        damage: '1d8',
        damageType: 'slashing',
        properties: [],
      };
      expect(formatWeaponDamage(weapon)).toEqual({ kind: 'text', text: '1d8 slashing' });
    });

    it('formats armor class as its bare number', () => {
      const armor: NonNullable<ItemEntity['armor']> = {
        category: 'heavy',
        ac: 18,
        stealthDisadvantage: true,
      };
      expect(formatArmorClass(armor)).toEqual({ kind: 'text', text: '18' });
    });
  });

  describe('factRowsFor', () => {
    it('builds the full spell fact grid in order: level, school, castingTime, range, duration, components', () => {
      const spell: SpellEntity = {
        type: 'spell',
        id: 'srd-5e-2024:spell/fireball',
        name: 'Fireball',
        tags: [],
        prerequisites: [],
        effects: [],
        grants: [],
        choices: [],
        level: 3,
        school: 'evocation',
        castingTime: fireballCastingTime,
        range: fireballRange,
        components: fireballComponents,
        duration: fireballDuration,
        concentration: false,
        ritual: false,
        classes: [],
      };

      expect(factRowsFor(spell).map((row) => row.labelKey)).toEqual([
        'fact.level',
        'fact.school',
        'fact.castingTime',
        'fact.range',
        'fact.duration',
        'fact.components',
      ]);
      expect(factRowsFor(spell)[0]?.value).toEqual({ kind: 'text', text: '3' });
      expect(factRowsFor(spell)[1]?.value).toEqual({ kind: 'text', text: 'Evocation' });
    });

    it('builds only the item fact rows whose optional data is present', () => {
      const item: ItemEntity = {
        type: 'item',
        id: 'srd-5e-2024:item/dagger',
        name: 'Dagger',
        tags: [],
        prerequisites: [],
        effects: [],
        grants: [],
        choices: [],
        category: 'weapon',
        weapon: {
          kind: 'melee',
          category: 'simple',
          damage: '1d4',
          damageType: 'piercing',
          properties: [],
        },
      };

      expect(factRowsFor(item).map((row) => row.labelKey)).toEqual([
        'fact.category',
        'fact.damage',
      ]);
    });

    it('builds the class fact grid: hitDie, saves, primaryAbility', () => {
      const cls: ClassEntity = {
        type: 'class',
        id: 'srd-5e-2024:class/fighter',
        name: 'Fighter',
        tags: [],
        prerequisites: [],
        effects: [],
        grants: [],
        choices: [],
        hitDie: 10,
        primaryAbility: ['str', 'dex'],
        saves: ['str', 'con'],
        armorTraining: [],
        weaponProficiencies: [],
        toolProficiencies: [],
        skillChoice: { from: ['athletics'], count: 2 },
        subclassLevel: 3,
        levels: [{ level: 1, grants: [], choices: [] }],
      };

      const rows = factRowsFor(cls);
      expect(rows.map((row) => row.labelKey)).toEqual([
        'fact.hitDie',
        'fact.saves',
        'fact.primaryAbility',
      ]);
      expect(rows[0]?.value).toEqual({ kind: 'text', text: 'd10' });
      expect(rows[1]?.value).toEqual({ kind: 'text', text: 'STR, CON' });
      expect(rows[2]?.value).toEqual({ kind: 'text', text: 'STR, DEX' });
    });

    it('builds the species fact grid: size, speed', () => {
      const species: SpeciesEntity = {
        type: 'species',
        id: 'srd-5e-2024:species/elf',
        name: 'Elf',
        tags: [],
        prerequisites: [],
        effects: [],
        grants: [],
        choices: [],
        size: 'medium',
        speed: 30,
        creatureType: 'humanoid',
      };

      const rows = factRowsFor(species);
      expect(rows.map((row) => row.labelKey)).toEqual(['fact.size', 'fact.speed']);
      expect(rows[0]?.value).toEqual({ kind: 'text', text: 'Medium' });
      expect(rows[1]?.value).toEqual({ kind: 'key', key: 'fact.unit.feet', params: { value: 30 } });
    });

    it('returns no fact rows for types with description-only facts (e.g. a feat)', () => {
      const feat: Entity = {
        type: 'feat',
        id: 'srd-5e-2024:feat/alert',
        name: 'Alert',
        tags: [],
        prerequisites: [],
        effects: [],
        grants: [],
        choices: [],
        category: 'general',
        repeatable: false,
      };

      expect(factRowsFor(feat)).toEqual([]);
    });
  });
});
