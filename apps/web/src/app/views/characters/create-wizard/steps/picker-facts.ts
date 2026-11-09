import type { Entity } from '@hk/protocol';
import { factRowsFor } from '../../../library/detail/entity-facts.formatters';

/** One labelled plain-text fact of an option (`Medium`, `d10`, `1d8 slashing`, `Sap`). */
export interface PickerFact {
  readonly key: string;
  readonly value: string;
}

/** The most facts a card or row shows next to its name. */
const MAX_META = 3;
/** A filter is useful when it splits the options into a few groups, not one and not dozens. */
const MIN_FACET_VALUES = 2;
const MAX_FACET_VALUES = 8;
/** Longest description excerpt a card carries; the drawer holds the rest. */
const EXCERPT_LENGTH = 120;

function capitalized(slug: string): string {
  return slug.length > 0 ? slug.charAt(0).toUpperCase() + slug.slice(1) : slug;
}

/**
 * The plain-text facts of an option, read off the entity's own fields (the library's fact rows, plus
 * a weapon's mastery property). Values with a plural form (`30 ft`) need a translation call and are
 * left to the drawer. Pure presentation of pack data: no rule lives here.
 */
export function pickerFacts(entity: Entity): PickerFact[] {
  const facts: PickerFact[] = [];
  // A weapon's mastery leads: it is what a mastery pick is about.
  if (entity.type === 'item' && entity.weapon?.mastery) {
    facts.push({ key: 'fact.mastery', value: capitalized(entity.weapon.mastery) });
  }
  for (const row of factRowsFor(entity)) {
    if (row.value.kind === 'text' && row.value.text.length > 0) {
      facts.push({ key: row.labelKey, value: row.value.text });
    }
  }
  return facts;
}

export function pickerMeta(entity: Entity, exclude: readonly string[] = []): string[] {
  return pickerFacts(entity)
    .filter((fact) => !exclude.includes(fact.key))
    .slice(0, MAX_META)
    .map((fact) => fact.value);
}

/**
 * The fact that best splits a set of options into filter chips: the first one (in the entity type's
 * own row order) with between two and eight distinct values. `undefined` when none does, so a
 * picker of backgrounds or feats simply has no filter.
 */
export function pickerFacet(
  entities: readonly Entity[],
): { key: string; values: string[] } | undefined {
  const byKey = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const entity of entities) {
    for (const fact of pickerFacts(entity)) {
      if (!byKey.has(fact.key)) {
        byKey.set(fact.key, new Set());
        order.push(fact.key);
      }
      byKey.get(fact.key)!.add(fact.value);
    }
  }
  for (const key of order) {
    const values = byKey.get(key)!;
    if (values.size >= MIN_FACET_VALUES && values.size <= MAX_FACET_VALUES) {
      return { key, values: [...values] };
    }
  }
  return undefined;
}

/** A card's one-line description: the first sentence of the plain text, cut to a fixed length. */
export function descriptionExcerpt(markdown: string): string | null {
  const plain = markdown
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length === 0) return null;
  const sentence = /^.*?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain;
  return sentence.length > EXCERPT_LENGTH
    ? `${sentence.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : sentence;
}
