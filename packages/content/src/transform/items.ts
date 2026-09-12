import { DiceSchema, type Entity } from '@hk/protocol';
import { itemId } from '../ids.ts';
import { type FixtureRecord, pkSlug, readFixture } from '../upstream.ts';
import { baseEntity, fieldBool, fieldNum, fieldOptionalStr, fieldStr, pkStr } from './common.ts';

type ItemCategory = 'weapon' | 'armor' | 'shield' | 'gear' | 'tool' | 'consumable' | 'magic';
type WeaponKind = 'melee' | 'ranged';
type WeaponCategory = 'simple' | 'martial';
type ArmorCategory = 'light' | 'medium' | 'heavy';
type Rarity = 'common' | 'uncommon' | 'rare' | 'veryRare' | 'legendary' | 'artifact';

interface Cost {
  amount: number;
  currency: 'gp' | 'sp' | 'cp';
}

interface WeaponShape {
  kind: WeaponKind;
  category: WeaponCategory;
  damage: string;
  damageType: string;
  versatile?: string;
  properties: string[];
  mastery: string;
  range?: { normal: number; long: number };
}

interface ArmorShape {
  category: ArmorCategory;
  ac: number;
  dexCap?: number;
  strength?: number;
  stealthDisadvantage: boolean;
}

/** Upstream `category: 'tools'` (note the plural) maps 1:1 to our `tool` item category. */
const TOOL_UPSTREAM_CATEGORY = 'tools';
/** Upstream `category: 'potion' | 'scroll'` both become our `consumable` item category. */
const CONSUMABLE_UPSTREAM_CATEGORIES = new Set(['potion', 'scroll']);
/** The single Armor record that represents a shield rather than a suit of armor. */
const SHIELD_ARMOR_PK = 'srd-2024_shield';

/** Upstream `rarity` slugs (with `very-rare`'s hyphen) to our schema's rarity enum. */
const RARITY_MAP: Record<string, Rarity> = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  'very-rare': 'veryRare',
  legendary: 'legendary',
  artifact: 'artifact',
};

/**
 * SRD 5.2.1 weapons table: Dart is a Simple Ranged weapon (Finesse, Thrown, Vex) that carries no
 * Ammunition property — every other ranged weapon in the SRD does. So "ranged" is: has the
 * `ammunition` property, OR is explicitly listed here.
 */
const RANGED_WITHOUT_AMMUNITION = new Set(['srd-2024_dart']);

/**
 * SRD 5.2.1 anomaly: the Blowgun (`srd-2024_blowgun`) deals a flat 1 Piercing damage with no die
 * roll — confirmed against the official 2024 weapons table, so upstream's `damage_dice: "1"` is
 * correct, not a data error. `DiceSchema` only expresses `NdS(+/-M)` rolls, so a bare flat value
 * can't be represented directly. This encodes it as `0d4+1`: zero d4s (contributing nothing) plus
 * a flat +1, which always resolves to exactly 1 and satisfies `DiceSchema` without fabricating
 * variance the real weapon doesn't have. Flagged in the task report for reconsideration (e.g. a
 * dedicated flat-damage representation) — every other weapon's `damage_dice` is schema-valid as-is.
 */
const DAMAGE_DICE_OVERRIDES: Record<string, string> = {
  'srd-2024_blowgun': '0d4+1',
};

/**
 * Upstream cost is a decimal-gp string (e.g. `"15.00"`, `"0.05"`). Parsed to integer copper first,
 * then reported in the largest denomination that divides it exactly (gp, then sp, then cp) so
 * `amount` stays a clean integer. A zero cost (every MagicItem, plus a few free mundane items)
 * omits `cost` entirely, per the mapping contract.
 */
function parseCost(raw: string, pk: FixtureRecord['pk']): Cost | undefined {
  const gp = Number(raw);
  if (!Number.isFinite(gp) || gp < 0) {
    throw new Error(`items: fixture "${String(pk)}" has an unparseable cost "${raw}"`);
  }
  const cp = Math.round(gp * 100);
  if (cp === 0) return undefined;
  if (cp % 100 === 0) return { amount: cp / 100, currency: 'gp' };
  if (cp % 10 === 0) return { amount: cp / 10, currency: 'sp' };
  return { amount: cp, currency: 'cp' };
}

/**
 * `MagicItem.cost` is inconsistently typed upstream: 275 records carry the usual `"0.00"` decimal
 * string, the other 482 carry the bare JSON number `0` — but every MagicItem's cost is zero either
 * way (verified over all 757 records), so both forms collapse to "no cost" here. A non-zero numeric
 * cost would be a genuinely new shape and throws rather than being silently misparsed.
 */
function parseMagicItemCost(fields: Record<string, unknown>, pk: FixtureRecord['pk']): Cost | undefined {
  const value = fields['cost'];
  if (typeof value === 'number') {
    if (value !== 0) {
      throw new Error(`items: magic item "${String(pk)}" has an unexpected numeric cost ${value}`);
    }
    return undefined;
  }
  return parseCost(fieldStr(fields, 'cost', pk), pk);
}

/** Upstream weight is a decimal-lb string (e.g. `"3.000"`); a zero weight omits `weight` entirely. */
function parseWeight(raw: string, pk: FixtureRecord['pk']): number | undefined {
  const lb = Number(raw);
  if (!Number.isFinite(lb) || lb < 0) {
    throw new Error(`items: fixture "${String(pk)}" has an unparseable weight "${raw}"`);
  }
  return lb === 0 ? undefined : lb;
}

/** Like `fieldNum`, but a `null` field value is a legitimate "absent" reading rather than an error. */
function fieldOptionalNum(fields: Record<string, unknown>, key: string, pk: FixtureRecord['pk']): number | undefined {
  const value = fields[key];
  if (value === null) return undefined;
  if (typeof value !== 'number') {
    throw new Error(`items: fixture "${String(pk)}" has a non-numeric, non-null field "${key}"`);
  }
  return value;
}

function assertDice(dice: string, pk: FixtureRecord['pk'], label: string): string {
  if (!DiceSchema.safeParse(dice).success) {
    throw new Error(`items: weapon "${String(pk)}" has ${label} "${dice}" that does not satisfy DiceSchema`);
  }
  return dice;
}

interface PropertyInfo {
  slug: string;
  isMastery: boolean;
}

/**
 * `WeaponProperty` pks distinguish ordinary properties (suffix `-wp`, `fields.type === null`) from
 * weapon mastery properties (suffix `-mastery`, `fields.type === 'Mastery'`) — verified over all 17
 * records (9 `-wp`, 8 `-mastery`; no other `type` value occurs). The property/mastery slug is the
 * pk slug with that suffix stripped, e.g. `srd-2024_sap-mastery` -> `sap`.
 */
function loadWeaponProperties(): Map<string, PropertyInfo> {
  const properties = new Map<string, PropertyInfo>();
  for (const rec of readFixture('WeaponProperty')) {
    const pk = pkStr(rec.pk);
    const type = rec.fields['type'];
    if (type !== null && type !== 'Mastery') {
      throw new Error(`items: WeaponProperty "${pk}" has unexpected type ${JSON.stringify(type)}`);
    }
    const isMastery = type === 'Mastery';
    const slug = pkSlug(pk).replace(isMastery ? /-mastery$/ : /-wp$/, '');
    properties.set(pk, { slug, isMastery });
  }
  return properties;
}

interface WeaponAssignment {
  propertyPk: string;
  detail?: string;
}

/** Groups `WeaponPropertyAssignment` records by their `weapon` pk. */
function loadAssignmentsByWeapon(): Map<string, WeaponAssignment[]> {
  const byWeapon = new Map<string, WeaponAssignment[]>();
  for (const rec of readFixture('WeaponPropertyAssignment')) {
    const weaponPk = fieldStr(rec.fields, 'weapon', rec.pk);
    const propertyPk = fieldStr(rec.fields, 'property', rec.pk);
    const detail = fieldOptionalStr(rec.fields, 'detail', rec.pk);
    const list = byWeapon.get(weaponPk) ?? [];
    list.push({ propertyPk, ...(detail !== undefined ? { detail } : {}) });
    byWeapon.set(weaponPk, list);
  }
  return byWeapon;
}

function buildWeaponShape(
  weaponRec: FixtureRecord,
  properties: Map<string, PropertyInfo>,
  assignmentsByWeapon: Map<string, WeaponAssignment[]>,
): WeaponShape {
  const pk = pkStr(weaponRec.pk);
  const assignments = assignmentsByWeapon.get(pk) ?? [];

  const normalSlugs: string[] = [];
  let mastery: string | undefined;
  let versatile: string | undefined;
  let hasAmmunition = false;

  for (const assignment of assignments) {
    const info = properties.get(assignment.propertyPk);
    if (!info) {
      throw new Error(`items: weapon "${pk}" references unknown WeaponProperty "${assignment.propertyPk}"`);
    }
    if (info.isMastery) {
      if (mastery) {
        throw new Error(`items: weapon "${pk}" has more than one mastery property ("${mastery}", "${info.slug}")`);
      }
      mastery = info.slug;
      continue;
    }
    normalSlugs.push(info.slug);
    if (info.slug === 'ammunition') hasAmmunition = true;
    if (info.slug === 'versatile') {
      if (!assignment.detail) {
        throw new Error(`items: weapon "${pk}" has a versatile property with no detail dice`);
      }
      versatile = assertDice(assignment.detail, pk, 'versatile damage');
    }
  }
  if (!mastery) {
    throw new Error(`items: weapon "${pk}" has no mastery property assigned`);
  }

  const rawDamage = DAMAGE_DICE_OVERRIDES[pk] ?? fieldStr(weaponRec.fields, 'damage_dice', pk);
  const damage = assertDice(rawDamage, pk, 'damage');

  const kind: WeaponKind = hasAmmunition || RANGED_WITHOUT_AMMUNITION.has(pk) ? 'ranged' : 'melee';
  const category: WeaponCategory = fieldBool(weaponRec.fields, 'is_simple', pk) ? 'simple' : 'martial';

  const normal = fieldNum(weaponRec.fields, 'range', pk);
  const long = fieldNum(weaponRec.fields, 'long_range', pk);
  let range: { normal: number; long: number } | undefined;
  if (normal > 0) {
    if (long <= 0) {
      throw new Error(`items: weapon "${pk}" has range ${normal} but long_range is ${long}`);
    }
    range = { normal, long };
  }

  return {
    kind,
    category,
    damage,
    damageType: fieldStr(weaponRec.fields, 'damage_type', pk),
    ...(versatile ? { versatile } : {}),
    properties: normalSlugs,
    mastery,
    ...(range ? { range } : {}),
  };
}

/**
 * Armor category derivation (SRD 5.2.1's light/medium/heavy split, expressed via open5e's dex-cap
 * fields): a Dex bonus with no cap is light; a Dex bonus capped at +2 is medium; no Dex bonus at
 * all is heavy. No SRD armor falls outside these three shapes — anything else throws.
 */
function deriveArmorCategory(addDex: boolean, capDex: number | undefined, pk: FixtureRecord['pk']): ArmorCategory {
  if (addDex && capDex === undefined) return 'light';
  if (capDex === 2) return 'medium';
  if (!addDex) return 'heavy';
  throw new Error(`items: armor "${String(pk)}" doesn't match the light/medium/heavy derivation rule`);
}

/**
 * Effective `dexCap` by category, principled (not a one-off): heavy armor adds no Dex bonus at
 * all, so it must emit an explicit `dexCap: 0` — the engine's own tested contract
 * (`derive/defense.ts`, `derive/defense.test.ts`) treats an ABSENT `dexCap` as "uncapped", not
 * "no Dex", so leaving it off heavy armor silently over-counts the wearer's Dex mod into AC.
 * Medium armor keeps upstream's numeric `ac_cap_dexmod` (always `2` in the SRD) verbatim. Light
 * armor (and shields) stay uncapped — `dexCap` is omitted entirely, matching "full Dex applies".
 */
function effectiveDexCap(category: ArmorCategory, upstreamDexCap: number | undefined): number | undefined {
  return category === 'heavy' ? 0 : upstreamDexCap;
}

function buildArmorShape(armorRec: FixtureRecord): ArmorShape {
  const pk = pkStr(armorRec.pk);
  const addDex = fieldBool(armorRec.fields, 'ac_add_dexmod', pk);
  const upstreamDexCap = fieldOptionalNum(armorRec.fields, 'ac_cap_dexmod', pk);
  const strength = fieldOptionalNum(armorRec.fields, 'strength_score_required', pk);
  const category = deriveArmorCategory(addDex, upstreamDexCap, pk);
  const dexCap = effectiveDexCap(category, upstreamDexCap);

  return {
    category,
    ac: fieldNum(armorRec.fields, 'ac_base', pk),
    ...(dexCap !== undefined ? { dexCap } : {}),
    ...(strength !== undefined ? { strength } : {}),
    stealthDisadvantage: fieldBool(armorRec.fields, 'grants_stealth_disadvantage', pk),
  };
}

function buildMundaneItem(
  rec: FixtureRecord,
  weaponsByPk: Map<string, FixtureRecord>,
  armorsByPk: Map<string, FixtureRecord>,
  properties: Map<string, PropertyInfo>,
  assignmentsByWeapon: Map<string, WeaponAssignment[]>,
): Entity {
  const pk = pkStr(rec.pk);
  const slug = pkSlug(pk);
  const name = fieldStr(rec.fields, 'name', pk);
  const upstreamCategory = fieldStr(rec.fields, 'category', pk);
  const weaponLink = fieldOptionalStr(rec.fields, 'weapon', pk);
  const armorLink = fieldOptionalStr(rec.fields, 'armor', pk);

  const weaponRec = weaponLink ? weaponsByPk.get(weaponLink) : undefined;
  if (weaponLink && !weaponRec) {
    throw new Error(`items: item "${pk}" links weapon "${weaponLink}" which has no Weapon fixture`);
  }
  const armorRec = armorLink ? armorsByPk.get(armorLink) : undefined;
  if (armorLink && !armorRec) {
    throw new Error(`items: item "${pk}" links armor "${armorLink}" which has no Armor fixture`);
  }

  let category: ItemCategory;
  let extra: { weapon: WeaponShape } | { shield: { ac: number } } | { armor: ArmorShape } | Record<string, never>;
  if (weaponRec) {
    category = 'weapon';
    extra = { weapon: buildWeaponShape(weaponRec, properties, assignmentsByWeapon) };
  } else if (armorRec) {
    if (armorLink === SHIELD_ARMOR_PK) {
      category = 'shield';
      extra = { shield: { ac: fieldNum(armorRec.fields, 'ac_base', armorRec.pk) } };
    } else {
      category = 'armor';
      extra = { armor: buildArmorShape(armorRec) };
    }
  } else if (upstreamCategory === TOOL_UPSTREAM_CATEGORY) {
    category = 'tool';
    extra = {};
  } else if (CONSUMABLE_UPSTREAM_CATEGORIES.has(upstreamCategory)) {
    category = 'consumable';
    extra = {};
  } else {
    category = 'gear';
    extra = {};
  }

  const cost = parseCost(fieldStr(rec.fields, 'cost', pk), pk);
  const weight = parseWeight(fieldStr(rec.fields, 'weight', pk), pk);

  return {
    type: 'item',
    ...baseEntity(itemId(slug), name, fieldStr(rec.fields, 'desc', pk)),
    category,
    ...(cost ? { cost } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...extra,
  };
}

function buildMagicItem(rec: FixtureRecord): Entity {
  const pk = pkStr(rec.pk);
  const slug = pkSlug(pk);
  const name = fieldStr(rec.fields, 'name', pk);
  const rawRarity = fieldStr(rec.fields, 'rarity', pk);
  const rarity = RARITY_MAP[rawRarity];
  if (!rarity) {
    throw new Error(`items: magic item "${pk}" has unknown rarity "${rawRarity}"`);
  }
  const requiresAttunement = fieldBool(rec.fields, 'requires_attunement', pk);
  const cost = parseMagicItemCost(rec.fields, pk);
  const weight = parseWeight(fieldStr(rec.fields, 'weight', pk), pk);

  return {
    type: 'item',
    ...baseEntity(itemId(slug), name, fieldStr(rec.fields, 'desc', pk)),
    category: 'magic',
    rarity,
    ...(requiresAttunement ? { attunement: { required: true } } : {}),
    ...(cost ? { cost } : {}),
    ...(weight !== undefined ? { weight } : {}),
  };
}

/**
 * The 203 `Item.json` records plus the vendored `MagicItem.json` records as `item` entities. Items
 * that link a `Weapon`/`Armor` fixture become `weapon`/`armor` (or `shield` for the Shield); every
 * other mundane item falls back on its upstream `category` (R16). Magic items always become
 * `category: 'magic'` with `rarity`/`attunement`, regardless of their upstream sub-category.
 */
export function transformItems(): Entity[] {
  const weaponsByPk = new Map(readFixture('Weapon').map((rec) => [pkStr(rec.pk), rec]));
  const armorsByPk = new Map(readFixture('Armor').map((rec) => [pkStr(rec.pk), rec]));
  const properties = loadWeaponProperties();
  const assignmentsByWeapon = loadAssignmentsByWeapon();

  const mundane = readFixture('Item').map((rec) =>
    buildMundaneItem(rec, weaponsByPk, armorsByPk, properties, assignmentsByWeapon),
  );
  const magic = readFixture('MagicItem').map((rec) => buildMagicItem(rec));

  const entities = [...mundane, ...magic];
  const seenIds = new Set<string>();
  for (const e of entities) {
    if (seenIds.has(e.id)) {
      throw new Error(`items: duplicate item id "${e.id}" (a mundane item and a magic item share a slug)`);
    }
    seenIds.add(e.id);
  }
  return entities;
}
