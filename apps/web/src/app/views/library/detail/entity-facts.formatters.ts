import type { ClassEntity, Entity, ItemEntity, SpeciesEntity, SpellEntity } from '@hk/protocol';

/**
 * A fact row's display value: either plain, already-final text, or a Transloco key (+ params) to
 * be resolved by the caller's own `t()` (needed for values with a plural form, e.g. "3 minutes").
 * Tagged with `kind` (rather than left as a duck-typed union) so the template can narrow it with
 * `@switch` — Angular's template type checker does not narrow a custom type-predicate function's
 * `@else` branch, and `@if (…; as x)` binds the condition's own result, not the narrowed operand.
 * See `entity-facts.component.ts`, the only consumer that calls `t()`.
 */
export type FactValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'key'; readonly key: string; readonly params: Record<string, unknown> };

export interface FactRow {
  readonly labelKey: string;
  readonly value: FactValue;
}

function plain(text: string): FactValue {
  return { kind: 'text', text };
}

function keyed(key: string, params: Record<string, unknown> = {}): FactValue {
  return { kind: 'key', key, params };
}

// Time units shared between a spell's `castingTime` and a `time`-kind `duration` — both are
// `{ value, unit }` pairs drawn from overlapping enums (`minute`/`hour` appear in both).
const TIME_UNIT_KEYS: Record<string, string> = {
  action: 'fact.unit.action',
  bonus: 'fact.unit.bonus',
  reaction: 'fact.unit.reaction',
  minute: 'fact.unit.minute',
  hour: 'fact.unit.hour',
  round: 'fact.unit.round',
  day: 'fact.unit.day',
};

/**
 * Bare pack enum slugs (spell school, item category/rarity, species size, …) have no translation
 * table of their own — the content pipeline only localizes `name`/`description` per entity today
 * (see `packages/content/translations/srd-5e-2024-ru-sample.json`). Until a future task adds
 * per-locale enum-value dictionaries, these render as their capitalized slug text, identically in
 * every locale — a deliberate, documented scope decision for this task (see task-12-report.md).
 */
function formatSlug(slug: string): FactValue {
  return plain(slug.length > 0 ? slug.charAt(0).toUpperCase() + slug.slice(1) : slug);
}

export function formatLevel(level: number): FactValue {
  return plain(String(level));
}

export function formatSchool(school: string): FactValue {
  return formatSlug(school);
}

export function formatCastingTime(castingTime: SpellEntity['castingTime']): FactValue {
  const key = TIME_UNIT_KEYS[castingTime.unit];
  if (!key) throw new Error(`formatCastingTime: unknown unit "${castingTime.unit}"`);
  return keyed(key, { value: castingTime.value });
}

export function formatRange(range: SpellEntity['range']): FactValue {
  switch (range.kind) {
    case 'feet':
      return keyed('fact.unit.feet', { value: range.distance ?? 0 });
    case 'miles':
      return keyed('fact.unit.mile', { value: range.distance ?? 0 });
    case 'self':
      return keyed('fact.rangeKind.self');
    case 'touch':
      return keyed('fact.rangeKind.touch');
    case 'sight':
      return keyed('fact.rangeKind.sight');
    case 'unlimited':
      return keyed('fact.rangeKind.unlimited');
    case 'special':
      return keyed('fact.rangeKind.special');
  }
}

export function formatDuration(duration: SpellEntity['duration']): FactValue {
  switch (duration.kind) {
    case 'instantaneous':
      return keyed('fact.durationKind.instantaneous');
    case 'untilDispelled':
      return keyed('fact.durationKind.untilDispelled');
    case 'special':
      return keyed('fact.durationKind.special');
    case 'time': {
      const unit = duration.unit ?? 'round';
      const key = TIME_UNIT_KEYS[unit];
      if (!key) throw new Error(`formatDuration: unknown unit "${unit}"`);
      return keyed(key, { value: duration.value ?? 0 });
    }
  }
}

export function formatComponents(components: SpellEntity['components']): FactValue {
  const letters = (['v', 's', 'm'] as const)
    .filter((letter) => components[letter])
    .map((letter) => letter.toUpperCase())
    .join(', ');
  const material = components.m && components.materialText ? ` (${components.materialText})` : '';
  return plain(`${letters}${material}`);
}

export function formatCategory(category: string): FactValue {
  return formatSlug(category);
}

export function formatCost(cost: NonNullable<ItemEntity['cost']>): FactValue {
  return plain(`${cost.amount} ${cost.currency}`);
}

export function formatWeight(weight: number): FactValue {
  return keyed('fact.unit.lb', { value: weight });
}

export function formatRarity(rarity: string): FactValue {
  return formatSlug(rarity);
}

export function formatWeaponDamage(weapon: NonNullable<ItemEntity['weapon']>): FactValue {
  return plain(`${weapon.damage} ${weapon.damageType}`);
}

export function formatArmorClass(armor: NonNullable<ItemEntity['armor']>): FactValue {
  return plain(String(armor.ac));
}

export function formatHitDie(hitDie: number): FactValue {
  return plain(`d${hitDie}`);
}

export function formatAbilityList(abilities: readonly string[]): FactValue {
  return plain(abilities.map((ability) => ability.toUpperCase()).join(', '));
}

export function formatSize(size: string): FactValue {
  return formatSlug(size);
}

export function formatSpeed(speed: number): FactValue {
  return keyed('fact.unit.feet', { value: speed });
}

function spellRows(entity: SpellEntity): FactRow[] {
  return [
    { labelKey: 'fact.level', value: formatLevel(entity.level) },
    { labelKey: 'fact.school', value: formatSchool(entity.school) },
    { labelKey: 'fact.castingTime', value: formatCastingTime(entity.castingTime) },
    { labelKey: 'fact.range', value: formatRange(entity.range) },
    { labelKey: 'fact.duration', value: formatDuration(entity.duration) },
    { labelKey: 'fact.components', value: formatComponents(entity.components) },
  ];
}

function itemRows(entity: ItemEntity): FactRow[] {
  const rows: FactRow[] = [{ labelKey: 'fact.category', value: formatCategory(entity.category) }];
  if (entity.cost) rows.push({ labelKey: 'fact.cost', value: formatCost(entity.cost) });
  if (entity.weight !== undefined)
    rows.push({ labelKey: 'fact.weight', value: formatWeight(entity.weight) });
  if (entity.rarity) rows.push({ labelKey: 'fact.rarity', value: formatRarity(entity.rarity) });
  if (entity.weapon)
    rows.push({ labelKey: 'fact.damage', value: formatWeaponDamage(entity.weapon) });
  if (entity.armor)
    rows.push({ labelKey: 'fact.armorClass', value: formatArmorClass(entity.armor) });
  return rows;
}

function classRows(entity: ClassEntity): FactRow[] {
  return [
    { labelKey: 'fact.hitDie', value: formatHitDie(entity.hitDie) },
    { labelKey: 'fact.saves', value: formatAbilityList(entity.saves) },
    { labelKey: 'fact.primaryAbility', value: formatAbilityList(entity.primaryAbility) },
  ];
}

function speciesRows(entity: SpeciesEntity): FactRow[] {
  return [
    { labelKey: 'fact.size', value: formatSize(entity.size) },
    { labelKey: 'fact.speed', value: formatSpeed(entity.speed) },
  ];
}

/**
 * The fact grid for `entity`, per its type — spell/item/class/species get the rows described in
 * the task brief; every other type (feature, feat, background, condition, skill, language, tool,
 * rule, ability, table, subclass, system) has no structured facts, only the description below it.
 */
export function factRowsFor(entity: Entity): FactRow[] {
  switch (entity.type) {
    case 'spell':
      return spellRows(entity);
    case 'item':
      return itemRows(entity);
    case 'class':
      return classRows(entity);
    case 'species':
      return speciesRows(entity);
    default:
      return [];
  }
}
