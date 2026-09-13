import { inject, Pipe, type PipeTransform } from '@angular/core';
import type { ContentIndex, Localizer } from '@hk/engine';
import { EVENT_PAYLOADS, type Event } from '@hk/protocol';
import { TranslocoService } from '@jsverse/transloco';

/** Timeline filter-chip families (task-12-brief.md: "filter chips by family
 * (identity/decisions/leveling/combat/items/other)"). Derived from an event type's leading
 * dot-segment — see `eventFamily` — never a per-type list, so a brand-new event type this file
 * doesn't know about yet still lands somewhere sensible ('other') instead of nowhere. */
export type TimelineFamily = 'identity' | 'decisions' | 'leveling' | 'combat' | 'items' | 'other';

export const TIMELINE_FAMILIES: readonly TimelineFamily[] = [
  'identity',
  'decisions',
  'leveling',
  'combat',
  'items',
  'other',
];

const FAMILY_BY_PREFIX: Record<string, TimelineFamily> = {
  character: 'identity',
  portrait: 'identity',
  pack: 'identity',
  decision: 'decisions',
  override: 'decisions',
  level: 'leveling',
  xp: 'leveling',
  hp: 'combat',
  hit_dice: 'combat',
  death_save: 'combat',
  stabilized: 'combat',
  slot: 'combat',
  resource: 'combat',
  spell: 'combat',
  concentration: 'combat',
  condition: 'combat',
  rest: 'combat',
  inspiration: 'combat',
  item: 'items',
  currency: 'items',
};

/** `event.type`'s leading dot-segment (e.g. `hit_dice.spent` → `hit_dice`, `stabilized` →
 * `stabilized`) mapped to a filter family; anything unmapped (notes, `event.reverted`,
 * `history.compacted`, a future type) is `'other'`. */
export function eventFamily(type: string): TimelineFamily {
  const prefix = type.split('.')[0] ?? type;
  return FAMILY_BY_PREFIX[prefix] ?? 'other';
}

const KEY_PREFIX = 'characters.timeline';
const UNKNOWN_KEY = `${KEY_PREFIX}.unknown`;
const GROUP_SUFFIX_KEY = `${KEY_PREFIX}.groupSuffix`;

/** Every protocol event type this app can ever append or replay (`@hk/protocol`'s
 * `EVENT_PAYLOADS` registry, stripped of its `@<version>` suffix) — the finite, closed set that
 * DOES have a literal `characters.timeline.<dash-type>` entry in en/ru/uk (this task). Anything
 * NOT in this set falls back to `characters.timeline.unknown` instead of a missing-key crash. */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(
  Object.keys(EVENT_PAYLOADS).map((key) => key.slice(0, key.lastIndexOf('@'))),
);

/** `event.type` (dot/underscore-separated, e.g. `hit_dice.spent`) → the dash-separated i18n key
 * SUFFIX (doc-06's `timeline.event.<type>` family convention, e.g. `hit_dice.spent` →
 * `hit-dice-spent`). */
function dashType(type: string): string {
  return type.replace(/[._]/g, '-');
}

/**
 * DYNAMIC-KEY pattern (plan-3 precedent — `hk-toast`'s own scoped-key-plus-params translate call;
 * `ability-scores-step.component.ts`'s `diagnosticKey`/`KNOWN_DIAGNOSTIC_CODES`): the actual
 * translation key is assembled at runtime from the event's own `type`, so a static scan of
 * literal translate-call arguments can never see (and therefore never flag) it either way. Every
 * type in `KNOWN_EVENT_TYPES` gets a real, hand-written key in en/ru/uk; anything else — a future
 * event type this file hasn't been taught about — resolves to the always-present
 * `characters.timeline.unknown` sentence instead of surfacing a raw missing key to the player.
 */
function eventKey(type: string): string {
  return KNOWN_EVENT_TYPES.has(type) ? `${KEY_PREFIX}.${dashType(type)}` : UNKNOWN_KEY;
}

/** Resolves one payload VALUE: a string that the content index recognizes as an entity id
 * becomes its localized name; a string array does the same per-entry, joined; anything else
 * (number, boolean) passes through unchanged. Resolution keys off the VALUE, not the field name —
 * `classId`/`spellId`/`itemId`/a bare skill slug all resolve the same way, and a non-id string
 * (a raw `choiceId`, an unrecognized slug) safely falls back to itself. */
function resolveValue(value: unknown, index: ContentIndex, localizer: Localizer): unknown {
  if (typeof value === 'string') {
    return index.has(value) ? localizer.name(value) : value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value.map((entry) => (index.has(entry) ? localizer.name(entry) : entry)).join(', ');
  }
  return value;
}

/** Builds the named-param record a sentence's ICU template draws from: every top-level payload
 * field whose value is a string/string-array/number/boolean (id-resolved per `resolveValue`);
 * free-form maps (`decision.made`'s `context`, `item.added`'s `custom`) are deliberately excluded
 * — they're not named params, they're `renderRolls`'s own concern (below). `item.added` gets one
 * extra synthesized param, `itemName`, because BOTH its `itemId` and `name` fields are optional
 * (a fully custom item has no `itemId`) — an ICU template can never safely reference an optional
 * field directly (a missing param throws), so the fallback chain (itemId name → free-text name →
 * the always-present `instanceId`) runs here, once, instead of in every locale's JSON. */
function buildParams(
  type: string,
  rawPayload: unknown,
  index: ContentIndex,
  localizer: Localizer,
): Record<string, unknown> {
  const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Record<
    string,
    unknown
  >;
  // Always available (even for a KNOWN type's own sentence, which is free to ignore it) — the
  // only param `characters.timeline.unknown` needs, since an unrecognized type has no other
  // structure this function can rely on.
  const params: Record<string, unknown> = { type };
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    // Free-form maps (`decision.made`'s `context`, `item.added`'s `custom`) are excluded — a
    // plain object has no sensible ICU rendering. A string ARRAY (`decision.made`'s `selection`)
    // is deliberately NOT excluded — `resolveValue` below joins it into one display string — but
    // an array of anything ELSE (`rest.taken`'s `hitDiceSpent: {classId, count}[]`) gets the same
    // treatment as a plain object: excluded, not passed through raw (consistency fix — this used
    // to slip past the object check purely because `Array.isArray` is true, landing an unresolved
    // array-of-objects straight in `params` with no ICU rendering for it either).
    if (
      typeof value === 'object' &&
      !(Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
    ) {
      continue;
    }
    params[key] = resolveValue(value, index, localizer);
  }

  if (type === 'item.added') {
    const itemId = payload['itemId'];
    const name = payload['name'];
    const instanceId = payload['instanceId'];
    params['itemName'] =
      typeof itemId === 'string'
        ? resolveValue(itemId, index, localizer)
        : ((typeof name === 'string' ? name : undefined) ??
          (typeof instanceId === 'string' ? instanceId : ''));
  }

  return params;
}

/** The key/params pair one localized sentence resolves to — an internal building block for
 * `sentenceOf`/`EventSentencePipe`; not itself meant to reach a translate-call argument (see
 * `sentenceOf`'s doc). */
export interface EventSentence {
  readonly key: string;
  readonly params: Record<string, unknown>;
}

/** `type` → the key/params pair for one event's sentence — the pure half of `EventSentencePipe`,
 * factored out so it's directly unit-testable with no Angular DI/Transloco setup at all. */
export function sentenceOf(event: Event, index: ContentIndex, localizer: Localizer): EventSentence {
  return {
    key: eventKey(event.type),
    params: buildParams(event.type, event.payload, index, localizer),
  };
}

/**
 * `type` → one fully-resolved, localized sentence (task-12-brief.md's "each event → one
 * localized sentence via the pipe"). Used both for a single event row and for a tx-group's own
 * summary card, where `event` is the group's LEADING event (earliest seq sharing the group's
 * `txId`) and `groupSize` is the group's total event count — the group's sentence reuses the
 * lead event's own sentence verbatim plus a "(+N more events)" suffix
 * (`characters.timeline.groupSuffix`) rather than duplicating every type's prose a second time
 * under a separate key family.
 *
 * Resolves through the INJECTED `TranslocoService` directly (the global, unscoped API — see
 * `sentenceOf`'s keys, which are always fully-qualified `characters.timeline.*`) rather than
 * through the caller's own scoped `*transloco="let t; read: 'characters'"` closure: that scoped
 * `t` prepends the `characters.` scope prefix to EVERY key it's given, so feeding it an
 * already-fully-qualified key double-prefixes it into a permanently-missing lookup — a caller
 * that needs one of THIS pipe's own scope-relative keys (`timeline.title`, `timeline.family.*`,
 * …) still uses its own scoped `t` for those; only the dynamic per-event keys this pipe builds
 * go through the service directly.
 *
 * `pure: false` (impure), matching `@jsverse/transloco`'s own `TranslocoPipe`: the arguments
 * (`event`/`index`/`localizer`/`groupSize`) don't change on a language switch, so a PURE pipe
 * would keep returning its memoized, now-stale-language string — this must re-run every
 * change-detection pass to pick up `reRenderOnLangChange`, the same reason transloco's own pipe
 * is impure.
 */
@Pipe({ name: 'eventSentence', pure: false })
export class EventSentencePipe implements PipeTransform {
  private readonly translocoService = inject(TranslocoService);

  transform(event: Event, index: ContentIndex, localizer: Localizer, groupSize = 1): string {
    const sentence = sentenceOf(event, index, localizer);
    const key = sentence.key;
    const params = sentence.params;
    const base = this.translocoService.translate(key, params);
    if (groupSize <= 1) return base;
    const suffixParams = { count: groupSize - 1 };
    const suffix = this.translocoService.translate(GROUP_SUFFIX_KEY, suffixParams);
    return `${base} ${suffix}`;
  }
}
