import { Injectable } from '@angular/core';

export interface Monogram {
  readonly initials: string;
  /** The palette token the character's colour is (`damage-fire`, ...); never a computed colour. */
  readonly token: string;
  /** `var(--<token>)`: the value every caller binds via `[style.background]`. */
  readonly background: string;
  /** `var(--text-on-leather)`: the monogram ink, AA against every palette colour on every theme. */
  readonly ink: string;
}

/**
 * The FIXED token set a placeholder portrait colour is drawn from (plan 17 R46). The colour used
 * to be `hsl(<hue from the random id> 45% 30%)` under the theme's cream ink, and some ids landed
 * at 4.47:1 (an axe `color-contrast` flake on the Build tab). These thirteen `damage-*` tokens
 * measure at least 5.5:1 against `--text-on-leather` on tavern, scroll and plain; the spec checks
 * every entry against the token source, so a palette edit cannot reintroduce a failing pair.
 */
export const PLACEHOLDER_PALETTE: readonly string[] = [
  'damage-acid',
  'damage-bludgeoning',
  'damage-cold',
  'damage-fire',
  'damage-force',
  'damage-lightning',
  'damage-necrotic',
  'damage-piercing',
  'damage-poison',
  'damage-psychic',
  'damage-radiant',
  'damage-slashing',
  'damage-thunder',
];

const MONOGRAM_INK = 'var(--text-on-leather)';

/**
 * doc-07 "Placeholders": "portraits fall back to a monogram token with a deterministic colour from
 * the character id" (a palette token, see `PLACEHOLDER_PALETTE`). SVG-free by design (doc-07's own "Safety": SVG uploads are rejected as a
 * script-injection risk, and this service never accepts user content at all) — a caller renders
 * the returned `{initials, background}` as a plain styled `<div>` (e.g.
 * `[style.background]="monogram.background"`), never through `[innerHTML]` or an `<svg>`.
 */
@Injectable({ providedIn: 'root' })
export class PlaceholderService {
  monogram(name: string, characterId: string): Monogram {
    const token = PLACEHOLDER_PALETTE[hashOf(characterId) % PLACEHOLDER_PALETTE.length];
    return {
      initials: initialsOf(name),
      token,
      background: `var(--${token})`,
      ink: MONOGRAM_INK,
    };
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

/** A simple (non-cryptographic: determinism is all that is asked for) string hash, kept a
 * non-negative 32-bit integer so `% palette length` is a valid index. `| 0` after each step keeps
 * the running total a 32-bit signed int, and the final `>>> 0` makes it unsigned. */
function hashOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}
