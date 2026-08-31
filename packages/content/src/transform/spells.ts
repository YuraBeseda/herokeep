import { DiceSchema, type Entity } from '@hk/protocol';
import { spellId } from '../ids.ts';
import { type FixtureRecord, pkSlug, readFixture } from '../upstream.ts';
import { baseEntity, fieldBool, fieldNum, fieldOptionalStr, fieldStr, fieldStrArray, pkStr } from './common.ts';

type CastingTimeUnit = 'action' | 'bonus' | 'reaction' | 'minute' | 'hour';
type RangeKind = 'self' | 'touch' | 'feet' | 'miles' | 'sight' | 'unlimited' | 'special';
type DurationKind = 'instantaneous' | 'time' | 'untilDispelled' | 'special';
type DurationUnit = 'round' | 'minute' | 'hour' | 'day';
type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

interface CastingTime {
  value: number;
  unit: CastingTimeUnit;
  condition?: string;
}

interface SpellRange {
  kind: RangeKind;
  distance?: number;
}

interface Duration {
  kind: DurationKind;
  value?: number;
  unit?: DurationUnit;
}

/** The 8 SRD spell schools. Upstream `school` is already this lowercase slug. */
const SCHOOLS = new Set([
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
]);

/**
 * Upstream `casting_time` values (verified over all 339 records: action 256, bonus-action 23,
 * reaction 4, 1minute 40, 10minutes 1, 1hour 15) mapped to our `{value, unit}` shape.
 */
const CASTING_TIMES: Record<string, { value: number; unit: CastingTimeUnit }> = {
  action: { value: 1, unit: 'action' },
  'bonus-action': { value: 1, unit: 'bonus' },
  reaction: { value: 1, unit: 'reaction' },
  '1minute': { value: 1, unit: 'minute' },
  '10minutes': { value: 10, unit: 'minute' },
  '1hour': { value: 1, unit: 'hour' },
};

/** Upstream `saving_throw_ability` full ability names to our 3-letter ability keys. */
const SAVE_ABILITIES: Record<string, AbilityKey> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

/**
 * Upstream `range_text` values for the 141 records with `range: 0` (140 with `range_unit: null`
 * plus Freedom of Movement, which anomalously has `range_unit: 'feet'`, `range: 0`).
 */
const ZERO_RANGE_KINDS: Record<string, RangeKind> = {
  Self: 'self',
  Touch: 'touch',
  Special: 'special',
  Sight: 'sight',
  Unlimited: 'unlimited',
};

/** A range in feet, in multiples of this many feet, is reported in miles instead (5280 ft = 1 mi). */
const FEET_PER_MILE = 5280;

/** Both "until dispelled" upstream duration strings collapse to the same schema kind. */
const UNTIL_DISPELLED_DURATIONS = new Set(['until dispelled', 'until dispelled or triggered']);

/** Matches upstream durations like `1 round`, `10 minutes`, `1 hour`, `30 days`. */
const DURATION_TIME_RE = /^(\d+) (round|minute|hour|day)s?$/;

function mapSchool(fields: Record<string, unknown>, pk: FixtureRecord['pk']): string {
  const school = fieldStr(fields, 'school', pk);
  if (!SCHOOLS.has(school)) {
    throw new Error(`spells: fixture "${String(pk)}" has unknown school "${school}"`);
  }
  return school;
}

function mapCastingTime(fields: Record<string, unknown>, pk: FixtureRecord['pk']): CastingTime {
  const raw = fieldStr(fields, 'casting_time', pk);
  const base = CASTING_TIMES[raw];
  if (!base) {
    throw new Error(`spells: fixture "${String(pk)}" has unknown casting_time "${raw}"`);
  }
  const condition = fieldOptionalStr(fields, 'reaction_condition', pk);
  if (condition && condition.length > 200) {
    throw new Error(`spells: fixture "${String(pk)}" reaction_condition exceeds 200 chars (${condition.length})`);
  }
  return { ...base, ...(condition ? { condition } : {}) };
}

function mapRange(fields: Record<string, unknown>, pk: FixtureRecord['pk']): SpellRange {
  const range = fieldNum(fields, 'range', pk);
  const rangeText = fieldStr(fields, 'range_text', pk);
  if (range === 0) {
    const kind = ZERO_RANGE_KINDS[rangeText];
    if (!kind) {
      throw new Error(`spells: fixture "${String(pk)}" has range 0 with unrecognized range_text "${rangeText}"`);
    }
    return { kind };
  }
  const unit = fields['range_unit'];
  if (unit !== 'feet') {
    throw new Error(
      `spells: fixture "${String(pk)}" has non-zero range ${range} with unexpected range_unit "${String(unit)}"`,
    );
  }
  if (range % FEET_PER_MILE === 0) {
    return { kind: 'miles', distance: range / FEET_PER_MILE };
  }
  return { kind: 'feet', distance: range };
}

function mapDuration(fields: Record<string, unknown>, pk: FixtureRecord['pk']): Duration {
  const raw = fieldStr(fields, 'duration', pk);
  if (raw === 'instantaneous') return { kind: 'instantaneous' };
  if (raw === 'special') return { kind: 'special' };
  if (UNTIL_DISPELLED_DURATIONS.has(raw)) return { kind: 'untilDispelled' };
  const match = DURATION_TIME_RE.exec(raw);
  if (!match) {
    throw new Error(`spells: fixture "${String(pk)}" has unmapped duration "${raw}"`);
  }
  const [, valueStr, unit] = match;
  return { kind: 'time', value: Number(valueStr), unit: unit as DurationUnit };
}

function mapDamage(
  fields: Record<string, unknown>,
  pk: FixtureRecord['pk'],
): { dice: string; type: string } | undefined {
  const rawDice = fieldStr(fields, 'damage_roll', pk);
  const types = fieldStrArray(fields, 'damage_types', pk);
  const dice = rawDice.replace(/\s+/g, '');
  const type = types[0];
  if (!dice || !type) return undefined;
  if (!DiceSchema.safeParse(dice).success) {
    throw new Error(`spells: fixture "${String(pk)}" has damage_roll "${rawDice}" that does not match DiceSchema`);
  }
  return { dice, type };
}

function mapSave(fields: Record<string, unknown>, pk: FixtureRecord['pk']): AbilityKey | undefined {
  const raw = fieldStr(fields, 'saving_throw_ability', pk);
  if (!raw) return undefined;
  const ability = SAVE_ABILITIES[raw];
  if (!ability) {
    throw new Error(`spells: fixture "${String(pk)}" has unknown saving_throw_ability "${raw}"`);
  }
  return ability;
}

function mapClasses(fields: Record<string, unknown>, pk: FixtureRecord['pk']): string[] {
  return fieldStrArray(fields, 'classes', pk).map((classPk) => pkSlug(classPk));
}

const MELEE_SPELL_ATTACK_RE = /melee spell attack/i;
const RANGED_SPELL_ATTACK_RE = /ranged spell attack/i;

/**
 * Per controller ruling R22: upstream `attack_roll` means "text interacts with attack rolls" (42
 * records), not "caster makes a spell attack" — only 13 of those 42 say "ranged spell attack" and
 * 8 say "melee spell attack" (verified over all 339 records); the other 24 (Bless, Bane, Hex,
 * Invisibility, ...) make no spell attack at all. So `attack` is derived from the spell's own SRD
 * `desc` text instead of `attack_roll`, which is otherwise ignored.
 */
function mapAttack(fields: Record<string, unknown>, pk: FixtureRecord['pk']): 'melee' | 'ranged' | undefined {
  const desc = fieldStr(fields, 'desc', pk);
  const isMelee = MELEE_SPELL_ATTACK_RE.test(desc);
  const isRanged = RANGED_SPELL_ATTACK_RE.test(desc);
  if (isMelee && isRanged) {
    throw new Error(`spells: fixture "${String(pk)}" desc matches both melee and ranged spell attack phrasing`);
  }
  if (isMelee) return 'melee';
  if (isRanged) return 'ranged';
  return undefined;
}

function mapMaterialText(fields: Record<string, unknown>, pk: FixtureRecord['pk']): string | undefined {
  const materialText = fieldOptionalStr(fields, 'material_specified', pk);
  if (materialText && materialText.length > 500) {
    throw new Error(`spells: fixture "${String(pk)}" material_specified exceeds 500 chars (${materialText.length})`);
  }
  return materialText;
}

/**
 * The 339 `Spell.json` records as `spell` entities. Every upstream vocabulary (casting_time,
 * school, saving_throw_ability, duration) is matched against an explicit lookup table or pattern;
 * an unrecognized value throws rather than silently falling through to a default.
 */
export function transformSpells(): Entity[] {
  return readFixture('Spell').map((rec): Entity => {
    const { fields, pk } = rec;
    const slug = pkSlug(pkStr(pk));
    const name = fieldStr(fields, 'name', pk);
    const materialText = mapMaterialText(fields, pk);
    const damage = mapDamage(fields, pk);
    const save = mapSave(fields, pk);
    const attack = mapAttack(fields, pk);
    const higherLevels = fieldOptionalStr(fields, 'higher_level', pk);
    return {
      type: 'spell',
      ...baseEntity(spellId(slug), name, fieldStr(fields, 'desc', pk)),
      level: fieldNum(fields, 'level', pk),
      school: mapSchool(fields, pk),
      castingTime: mapCastingTime(fields, pk),
      range: mapRange(fields, pk),
      components: {
        v: fieldBool(fields, 'verbal', pk),
        s: fieldBool(fields, 'somatic', pk),
        m: fieldBool(fields, 'material', pk),
        ...(materialText ? { materialText } : {}),
      },
      duration: mapDuration(fields, pk),
      concentration: fieldBool(fields, 'concentration', pk),
      ritual: fieldBool(fields, 'ritual', pk),
      classes: mapClasses(fields, pk),
      ...(damage ? { damage } : {}),
      ...(save ? { save } : {}),
      ...(attack ? { attack } : {}),
      ...(higherLevels ? { higherLevels } : {}),
    };
  });
}
