import { Injectable } from '@angular/core';

export interface Monogram {
  readonly initials: string;
  readonly hue: number;
  /** The exact `hsl(...)` string every caller binds via `[style.background]` — see this file's
   * class doc's "CENTRALIZED FORMULA" note (fix-round 1, finding 4). */
  readonly background: string;
}

/** `45% 30%` (saturation/lightness) — the ONE place this formula is written. Fix-round 1, finding
 * 4: three callers (`sheet-shell`/`build-tab`/`characters-list` components) had each hand-rolled
 * `` `hsl(${hue} 45% 40%)` `` themselves, and this file's own doc comment disagreed with them
 * (`45% 45%`) — a duplication that had already drifted once and could silently drift again.
 * `monogram()` now computes `background` itself so no caller ever touches this string.
 *
 * task-12 fix round (axe `color-contrast`, serious): lightness was `40%` — against the
 * placeholder's fixed near-white text (`#f7f5f3`), that fails WCAG AA's 4.5:1 for 167 of 360 hues
 * (46.4%, the contiguous ~32°-198° band spanning orange through teal/blue), some as low as
 * ~2.95:1, since every hue shares this ONE lightness regardless of how light or dark it already
 * reads. `30%` was verified by brute-force checking EVERY hue at `s=45%` against `#f7f5f3`: the
 * worst case across the full 360° range is 4.85:1, safely above 4.5:1 for every possible
 * character id, not just the ones this file's own tests happen to cover. */
function backgroundOf(hue: number): string {
  return `hsl(${hue} 45% 30%)`;
}

/**
 * doc-07 "Placeholders": "portraits fall back to a monogram token with a deterministic hue from
 * the character id." SVG-free by design (doc-07's own "Safety": SVG uploads are rejected as a
 * script-injection risk, and this service never accepts user content at all) — a caller renders
 * the returned `{initials, background}` as a plain styled `<div>` (e.g.
 * `[style.background]="monogram.background"`), never through `[innerHTML]` or an `<svg>`.
 */
@Injectable({ providedIn: 'root' })
export class PlaceholderService {
  monogram(name: string, characterId: string): Monogram {
    const hue = hueOf(characterId);
    return { initials: initialsOf(name), hue, background: backgroundOf(hue) };
  }
}

/** First letter of up to the first two whitespace-separated words, uppercased — same algorithm
 * `SheetShellComponent`'s pre-Task-8 inline `initials` computed used (this service supersedes
 * that one-off; Task 8's own edit to `sheet-shell.component.ts` switches it over). */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** A simple (non-cryptographic — determinism is all that's asked for, not collision-resistance)
 * string hash, folded into `[0, 360)` for a CSS `hsl()` hue degree. `| 0` after each step keeps
 * the running total a 32-bit signed int (matching normal JS bitwise-op semantics) so this can
 * never silently drift into a float or overflow `Number.MAX_SAFE_INTEGER` on a long id; the final
 * double-mod (`((hash % 360) + 360) % 360`) turns a possibly-negative 32-bit result into the
 * non-negative degree every CSS `hsl()` caller expects. */
function hueOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}
