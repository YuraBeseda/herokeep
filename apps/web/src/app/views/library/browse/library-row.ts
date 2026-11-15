import type { ContentIndex, Localizer } from '@hk/engine';
import type { Entity } from '@hk/protocol';
import {
  factRowsFor,
  formatCategory,
  formatCost,
  formatSchool,
  formatWeight,
  type FactValue,
} from '../../../ui/entity-facts/entity-facts.formatters';

/** The sort choices of the library list. `match` is the search ranking (name order when browsing). */
export type LibrarySort = 'match' | 'name' | 'type' | 'level';

const key = (name: string, params: Record<string, unknown> = {}): FactValue => ({
  kind: 'key',
  key: name,
  params,
});

/** A spell's level; other entry types have none. */
export function levelOf(entity: Entity): number | undefined {
  return entity.type === 'spell' ? entity.level : undefined;
}

/**
 * The one-line summary under a row's name (board LB01), from the entity's own schema data: a spell's
 * level and school, an item's category, cost and weight, a class's hit die, a subclass's class and
 * the level it is chosen at. Types with nothing short to say have no sub-line.
 */
export function subLineFor(entity: Entity, index: ContentIndex, localizer: Localizer): FactValue[] {
  switch (entity.type) {
    case 'spell':
      return [
        entity.level === 0 ? key('row.cantrip') : key('row.level', { level: entity.level }),
        formatSchool(entity.school),
      ];
    case 'item': {
      const parts: FactValue[] = [formatCategory(entity.category)];
      if (entity.cost) parts.push(formatCost(entity.cost));
      if (entity.weight !== undefined) parts.push(formatWeight(entity.weight));
      return parts;
    }
    case 'class':
      return factRowsFor(entity)
        .slice(0, 2)
        .map((row) => row.value);
    case 'subclass': {
      const parent =
        index.get(entity.class) ?? index.get(index.resolveClassRef(entity.class) ?? '');
      if (parent?.type !== 'class') return [];
      return [
        { kind: 'text', text: localizer.name(parent.id) },
        key('row.chosenAt', { level: parent.subclassLevel }),
      ];
    }
    default:
      return [];
  }
}
