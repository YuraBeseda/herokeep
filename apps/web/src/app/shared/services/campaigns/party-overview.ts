import type { Sheet } from '@hk/engine';
import type { PartyOverview } from './campaign-projection';

/**
 * Pure derivation of a `party.overview_updated@1` payload's `overview` field (task-8-brief.md,
 * schema facts section — `packages/protocol/src/events/campaign.ts`'s `PartyOverviewUpdatedV1`)
 * from a character's own `Sheet` (`@hk/engine`, the facts→sheet pipeline's output). No Angular, no
 * store dependency, no clock/RNG — same "pure module, unit-testable without a store" convention
 * `character-campaign-link.ts`/`campaign-link-sequence.ts` already establish for this folder.
 *
 * `PartyOverviewPublisherService` is the only caller: it derives this AFTER `CharacterStore`'s
 * `sheet` signal has recomputed off a freshly committed local append (ruling 8), never before.
 */

/** Schema caps (`PartyOverviewUpdatedV1.overview.classes`/`.conditions`, both `.max(20)`) — a
 * defensive clamp, not a business rule: no 5e character is expected to ever actually hit either
 * bound, but `CampaignStore.appendToStream`'s own `parseEvent` validation would otherwise reject
 * the whole publish outright if one ever did. */
const MAX_ARRAY_ENTRIES = 20;

/** Maps a `Sheet` onto the overview shape the campaign schema expects: `hp`/`hpMax`/`temp` from
 * the HP block, `ac`/`level`/`passivePerception` verbatim, `classes` stripped of `subclassId`
 * (the overview only needs enough to render "Fighter 3" — task-8-brief.md's schema-facts note),
 * `conditions` reduced to bare `conditionId`s, and `concentration` collapsed to a boolean
 * (design ruling 5: the server never interprets this field, so the fuller `{spellId}` object
 * `Sheet.concentration` carries would be wasted detail here). `portraitThumb` is passed in
 * separately (the character's own `portraitThumbHash` — not a `Sheet` field at all) and included
 * only when defined, never as an explicit `undefined` key (`overviewsEqual`'s own doc explains
 * why that distinction matters for the deep-equal skip). */
export function deriveOverview(sheet: Sheet, portraitThumb: string | undefined): PartyOverview {
  return {
    hp: sheet.hp.current,
    hpMax: sheet.hp.max.value,
    temp: sheet.hp.temp,
    ac: sheet.ac.value,
    level: sheet.level,
    classes: sheet.classes
      .slice(0, MAX_ARRAY_ENTRIES)
      .map((c) => ({ classId: c.classId, level: c.level })),
    conditions: sheet.conditions.slice(0, MAX_ARRAY_ENTRIES).map((c) => c.conditionId),
    concentration: sheet.concentration !== undefined,
    ...(portraitThumb !== undefined ? { portraitThumb } : {}),
    passivePerception: sheet.passivePerception,
  };
}

/** Structural equality for two `PartyOverview` values (ruling 8: "skipped when unchanged
 * (deep-equal)"). A small hand-rolled recursive comparison rather than `JSON.stringify(a) ===
 * JSON.stringify(b)` — this codebase has no deep-equal dependency already installed (checked: no
 * `lodash`/`fast-deep-equal` in either `package.json`), and a hand-rolled comparison avoids
 * `JSON.stringify`'s own key-order sensitivity for object fields (array ORDER still matters here,
 * which is the intended, literal reading of "deep-equal" — `classes`/`conditions` are compared
 * positionally, not as sets). An overview with an explicit `portraitThumb` key never equals one
 * without it, even if every OTHER field matches — `deriveOverview` never emits an explicit
 * `undefined` value for it, so "key present vs. absent" is the only state that field can be in. */
export function overviewsEqual(a: PartyOverview, b: PartyOverview): boolean {
  return deepEqual(a, b);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(bRec, key) && deepEqual(aRec[key], bRec[key]));
}
