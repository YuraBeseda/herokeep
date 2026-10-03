import type { Predicate } from '@hk/protocol';
import { classId } from '../ids.ts';

/**
 * Plan 12 task 6 (rulings 7 + 8): build-time parsers that lift magic-item charges and
 * `attunement.by` out of vendored free text. The vendored `MagicItem.json` has no structured
 * charges field (they live in `desc`), so these are deliberately CONSERVATIVE: only the
 * unambiguous SRD phrasings below mechanize; anything else returns `undefined` and the item stays
 * unmechanized. A wrong max is worse than none — the exact parsed set is pinned in
 * `test/charges.test.ts`, so any regex change diffs loudly.
 */

export interface ParsedCharges {
  /** The literal `N` of "has/have N charges" (never a dice expression). */
  max: number;
  /**
   * `'dawn'` when the desc says "regain(s) <amount> expended charges daily at dawn"; `'never'` when
   * the desc has no regain-of-charges text at all. (Items whose desc regains charges any OTHER way
   * are skipped entirely, not guessed.)
   */
  reset: 'dawn' | 'never';
  /**
   * The regained amount ("1d6 + 1", "2", or "all"), `null` for `reset:'never'`. NOT carried into
   * the pack — the item vocabulary is `{max, reset}` only (the engine restores a charged resource
   * in full when its reset fires) — but pinned in the manifest so the data stays reviewable.
   */
  regain: string | null;
}

const MAX_RE = /\b(?:has|have)\s+(\d+)\s+charges\b/gi;
const DAWN_RE = /\bregains?\s+(?:(all)|(\d+d\d+(?:\s*\+\s*\d+)?|\d+))\s+expended\s+charges\s+daily\s+at\s+dawn\b/gi;
/** Any other sentence in which charges are regained (used only to REFUSE, never to parse). */
const ANY_REGAIN_RE = /\bregains?\b[^.]*\bcharges?\b/i;

export function parseCharges(desc: string): ParsedCharges | undefined {
  const maxes = new Set([...desc.matchAll(MAX_RE)].map((m) => Number(m[1])));
  if (maxes.size !== 1) return undefined;
  const max = [...maxes][0]!;
  if (!Number.isSafeInteger(max) || max < 1) return undefined;

  const regains = new Set(
    [...desc.matchAll(DAWN_RE)].map((m) => (m[1] ? 'all' : m[2]!.replace(/\s+/g, ' ').replace(/\s*\+\s*/, ' + '))),
  );
  if (regains.size > 1) return undefined;
  if (regains.size === 1) return { max, reset: 'dawn', regain: [...regains][0]! };
  // No dawn phrase: only an item with NO regain-of-charges text at all is a clean 'never'.
  if (ANY_REGAIN_RE.test(desc)) return undefined;
  return { max, reset: 'never', regain: null };
}

const CLASS_SLUGS = new Set([
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
]);

export type AttunementBy = { kind: 'predicate'; predicate: Predicate } | { kind: 'inexpressible' };

/**
 * Parses a vendored `attunement_detail` ("Requires Attunement by a Cleric, Druid, or Paladin").
 * Class lists become `{class}` / `{any:[…]}`, a lone "Spellcaster" becomes `{spellcaster:true}`;
 * every other form (species, alignment, "a creature attuned to …", mixed lists) is `inexpressible`
 * and the item keeps `attunement:{required:true}` only. `undefined` = no "by <X>" suffix at all.
 */
export function parseAttunementBy(detail: string): AttunementBy | undefined {
  const m = /^Requires Attunement by (?:a|an)\s+(.+?)\s*$/i.exec(detail.trim());
  if (!m) return undefined;
  const parts = m[1]!
    .split(/\s*,\s*(?:or\s+)?|\s+or\s+/i)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (parts.length === 1 && parts[0] === 'spellcaster') {
    return { kind: 'predicate', predicate: { spellcaster: true } };
  }
  if (parts.length === 0 || !parts.every((p) => CLASS_SLUGS.has(p))) return { kind: 'inexpressible' };
  const classes = parts.map((p): Predicate => ({ class: classId(p) }));
  return { kind: 'predicate', predicate: classes.length === 1 ? classes[0]! : { any: classes } };
}
