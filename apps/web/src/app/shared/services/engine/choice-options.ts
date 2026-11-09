import {
  isQueryPick,
  queryPickOptions,
  type ContentIndex,
  type Localizer,
  type Sheet,
} from '@hk/engine';
import type { Choice } from '@hk/protocol';

export interface ChoiceOption {
  readonly id: string;
  /** Localized name. */
  readonly name: string;
  readonly href: string;
}

export interface ChoiceOptionsView {
  /** The whole offer set, however many options are listed. */
  readonly count: number;
  readonly options: readonly ChoiceOption[];
}

/**
 * The entity ids a choice OFFERS: the engine's own offer set — the one the wizard's pickers list
 * and `validateSelection` accepts. A query pick (single or union) is `queryPickOptions`; a static
 * pick is its fixed ids. Other pick forms (ability scores, literals, equipment) have no list.
 * `sheet` narrows a `requireProficient` pick (Expertise); without it such a pick offers nothing.
 */
export function choiceOptionIds(
  choice: Choice,
  index: ContentIndex,
  ownerId: string,
  sheet?: Pick<Sheet, 'skills'>,
): string[] {
  const pick = choice.pick;
  if (isQueryPick(pick)) {
    // No hero (the library) knows no proficiencies: show the whole list rather than nothing.
    const open = sheet === undefined && 'query' in pick ? { query: pick.query } : pick;
    return queryPickOptions(open, index, sheet, ownerId);
  }
  if ('static' in pick) return [...pick.static];
  return [];
}

export interface ChoiceOptionsContext {
  readonly ownerId: string;
  readonly localizer: Localizer;
  /** Where one option's entry lives (the caller keeps the hero context in it). */
  readonly href: (id: string) => string;
  readonly sheet?: Pick<Sheet, 'skills'>;
  /** List at most this many options (the count stays whole). */
  readonly limit?: number;
}

/**
 * The options chip's data for a choice, from the same candidate evaluation the wizard pickers use
 * (`choiceOptionIds`), so the library, the wizard and the sheet agree on the count. Ids that do
 * not resolve in the content index are not listed or counted.
 */
export function optionsForChoice(
  choice: Choice,
  index: ContentIndex,
  context: ChoiceOptionsContext,
): ChoiceOptionsView {
  const ids = choiceOptionIds(choice, index, context.ownerId, context.sheet).filter((id) =>
    index.has(id),
  );
  const listed = context.limit === undefined ? ids : ids.slice(0, context.limit);
  return {
    count: ids.length,
    options: listed.map((id) => ({
      id,
      name: context.localizer.name(id),
      href: context.href(id),
    })),
  };
}
