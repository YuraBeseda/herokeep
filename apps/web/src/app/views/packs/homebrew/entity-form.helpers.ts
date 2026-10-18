import type { ContentIndex, Localizer } from '@hk/engine';
import {
  DiceSchema,
  parseEntityId,
  type Effect,
  type FeatEntity,
  type ItemEntity,
  type SpeciesEntity,
  type SpellEntity,
} from '@hk/protocol';

/**
 * Shared pieces of the four quick-homebrew forms (plan 15 Task 7, ruling 10): the entity types
 * they author, the protocol enum values their selects offer (typed against the entity schemas,
 * so a schema change breaks the build instead of the form), the open-slug vocabulary harvested
 * from the core content (damage types, properties, masteries, schools, sizes, creature types,
 * classes — DATA, never a 5e list in TypeScript), and the entity-shell builders.
 *
 * Mechanics stay text-only (`feature.text` for traits and feat text) except the structural fields
 * each schema requires; the forms never author effects, grants, choices or prerequisites.
 */

export const HOMEBREW_FORM_TYPES = ['item', 'spell', 'feat', 'species'] as const;
export type HomebrewFormType = (typeof HOMEBREW_FORM_TYPES)[number];

export function isHomebrewFormType(value: string): value is HomebrewFormType {
  return (HOMEBREW_FORM_TYPES as readonly string[]).includes(value);
}

export const ITEM_CATEGORIES = [
  'weapon',
  'armor',
  'shield',
  'gear',
  'tool',
  'consumable',
  'magic',
] as const satisfies readonly ItemEntity['category'][];
export const RARITIES = [
  'common',
  'uncommon',
  'rare',
  'veryRare',
  'legendary',
  'artifact',
] as const satisfies readonly NonNullable<ItemEntity['rarity']>[];
export const WEAPON_KINDS = ['melee', 'ranged'] as const satisfies readonly NonNullable<
  ItemEntity['weapon']
>['kind'][];
export const WEAPON_CATEGORIES = ['simple', 'martial'] as const satisfies readonly NonNullable<
  ItemEntity['weapon']
>['category'][];
export const ARMOR_CATEGORIES = [
  'light',
  'medium',
  'heavy',
] as const satisfies readonly NonNullable<ItemEntity['armor']>['category'][];
export const TIME_UNITS = [
  'action',
  'bonus',
  'reaction',
  'minute',
  'hour',
] as const satisfies readonly SpellEntity['castingTime']['unit'][];
export const RANGE_KINDS = [
  'self',
  'touch',
  'feet',
  'miles',
  'sight',
  'unlimited',
  'special',
] as const satisfies readonly SpellEntity['range']['kind'][];
export const DURATION_KINDS = [
  'instantaneous',
  'time',
  'untilDispelled',
  'special',
] as const satisfies readonly SpellEntity['duration']['kind'][];
export const DURATION_UNITS = [
  'round',
  'minute',
  'hour',
  'day',
] as const satisfies readonly NonNullable<SpellEntity['duration']['unit']>[];
export const FEAT_CATEGORIES = [
  'origin',
  'general',
  'fightingStyle',
  'epicBoon',
] as const satisfies readonly FeatEntity['category'][];

/** Scope-relative (`packs`) i18n key of the generic "required" field message. */
export const REQUIRED_KEY = 'homebrew.field.required';

/** Field name → scope-relative i18n key of the message shown under it. */
export type FieldErrors = Readonly<Record<string, string>>;

/** The base fields every homebrew entity carries (no mechanics beyond what the form adds). */
export function entityShell(id: string, name: string, description: string) {
  const text = description.trim();
  return {
    id,
    name: name.trim(),
    ...(text ? { description: text } : {}),
    tags: [],
    prerequisites: [],
    effects: [] as Effect[],
    grants: [],
    choices: [],
  };
}

/** A text-only mechanic: shown on the sheet as a named feature, never evaluated. */
export function featureText(name: string, description: string): Effect {
  return { type: 'feature.text', name: name.trim(), description: description.trim() };
}

export function isDice(value: string): boolean {
  return DiceSchema.safeParse(value.trim()).success;
}

/** `null`/NaN-safe integer read of a number field (`null` when empty or not a whole number). */
export function wholeNumber(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isInteger(value) ? null : value;
}

/** A class the spell form offers: the slug the spell records, and its localized name. */
export interface ClassOption {
  readonly slug: string;
  readonly name: string;
}

/** Open-slug values the forms offer, harvested from the installed core content. */
export interface HomebrewVocabulary {
  readonly damageTypes: readonly string[];
  readonly weaponProperties: readonly string[];
  readonly masteries: readonly string[];
  readonly schools: readonly string[];
  readonly sizes: readonly string[];
  readonly creatureTypes: readonly string[];
  readonly classes: readonly ClassOption[];
}

const sortedUnique = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function harvestVocabulary(index: ContentIndex, localizer: Localizer): HomebrewVocabulary {
  const weapons = (index.byType('item') as ItemEntity[]).flatMap((item) =>
    item.weapon ? [item.weapon] : [],
  );
  const spells = index.byType('spell') as SpellEntity[];
  const species = index.byType('species') as SpeciesEntity[];
  const classes = index
    .byType('class')
    .map((entity) => ({
      slug: parseEntityId(entity.id)?.slug ?? entity.id,
      name: localizer.name(entity.id),
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return {
    damageTypes: sortedUnique([
      ...weapons.map((w) => w.damageType),
      ...spells.flatMap((s) => (s.damage ? [s.damage.type] : [])),
    ]),
    weaponProperties: sortedUnique(weapons.flatMap((w) => w.properties)),
    masteries: sortedUnique(weapons.flatMap((w) => (w.mastery ? [w.mastery] : []))),
    schools: sortedUnique(spells.map((s) => s.school)),
    sizes: sortedUnique(species.map((s) => s.size)),
    creatureTypes: sortedUnique(species.map((s) => s.creatureType)),
    classes,
  };
}

/** The vocabulary's first value (the form's initial pick), else `''`. */
export function firstOf(values: readonly string[]): string {
  return values[0] ?? '';
}
