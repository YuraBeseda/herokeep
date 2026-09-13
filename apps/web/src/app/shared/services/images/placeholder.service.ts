import { Injectable } from '@angular/core';

export interface Monogram {
  readonly initials: string;
  readonly hue: number;
}

/**
 * doc-07 "Placeholders": "portraits fall back to a monogram token with a deterministic hue from
 * the character id." SVG-free by design (doc-07's own "Safety": SVG uploads are rejected as a
 * script-injection risk, and this service never accepts user content at all) — a caller renders
 * the returned `{initials, hue}` as a plain styled `<div>` (e.g.
 * `[style.background]="'hsl(' + monogram.hue + ' 45% 45%)'"`), never through `[innerHTML]` or an
 * `<svg>`.
 */
@Injectable({ providedIn: 'root' })
export class PlaceholderService {
  monogram(name: string, characterId: string): Monogram {
    return { initials: initialsOf(name), hue: hueOf(characterId) };
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
