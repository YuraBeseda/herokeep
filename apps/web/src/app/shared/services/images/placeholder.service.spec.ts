import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { PLACEHOLDER_PALETTE, PlaceholderService } from './placeholder.service';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

interface TokenRow {
  readonly name: string;
  readonly value: Record<string, string>;
}
const tokens = (
  JSON.parse(readFileSync(join(repoRoot, 'packages/ui-tokens/src/tokens.json'), 'utf8')) as {
    color: { themes: { id: string }[]; tokens: TokenRow[] };
  }
).color;

/** The theme-resolved hex of a colour token (follows `{alias}` references). */
function resolve(theme: string, name: string): string {
  const row = tokens.tokens.find((t) => t.name === name);
  if (!row) throw new Error(`unknown token ${name}`);
  const value = row.value[theme] ?? '';
  const alias = /^\{(.+)\}$/.exec(value);
  return alias ? resolve(theme, alias[1]) : value;
}

/** `var(--name)` -> `name`; anything else throws, so a literal colour can never pass. */
function tokenOf(css: string): string {
  const m = /^var\(--([a-z0-9-]+)\)$/.exec(css);
  if (!m) throw new Error(`not a token reference: ${css}`);
  return m[1];
}

describe('PlaceholderService.monogram', () => {
  function service(): PlaceholderService {
    return TestBed.inject(PlaceholderService);
  }

  it('derives initials from the first letter of up to the first two words', () => {
    expect(service().monogram('Ivan Ivanov', 'char:a').initials).toBe('II');
    expect(service().monogram('Zelda', 'char:a').initials).toBe('Z');
    expect(service().monogram('  Mary   Jane Watson  ', 'char:a').initials).toBe('MJ');
  });

  it('returns an empty initials string for an empty/whitespace-only name', () => {
    expect(service().monogram('', 'char:a').initials).toBe('');
    expect(service().monogram('   ', 'char:a').initials).toBe('');
  });

  it('is deterministic: the SAME character id always yields the SAME colour, whatever the name', () => {
    const svc = service();
    const id = 'char:11111111-1111-1111-1111-111111111111';
    const first = svc.monogram('Ivan', id);
    expect(svc.monogram('Ivan', id).background).toBe(first.background);
    expect(svc.monogram('A Totally Different Name', id).background).toBe(first.background);
  });

  it('different character ids spread over several palette colours', () => {
    const svc = service();
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => svc.monogram('Ivan', `char:id-${i}`).background),
    );
    expect(seen.size).toBeGreaterThan(5);
  });

  // R46: the colour comes from a FIXED token set, never from the random id's hue — the old
  // `hsl(h 45% 30%)` against the theme's cream ink measured 4.47:1 for some ids (axe flake).
  it('the background is a palette token reference and the ink is the on-leather text token', () => {
    const result = service().monogram('Ivan', 'char:some-character-id');
    expect(PLACEHOLDER_PALETTE.map((p) => `var(--${p})`)).toContain(result.background);
    expect(result.ink).toBe('var(--text-on-leather)');
    expect(result.background).not.toMatch(/hsl/);
  });

  it('the palette lists only colour tokens that exist in the token source', () => {
    expect(PLACEHOLDER_PALETTE.length).toBeGreaterThanOrEqual(8);
    for (const name of PLACEHOLDER_PALETTE) {
      expect(tokens.tokens.some((t) => t.name === name)).toBe(true);
    }
  });

  it('every palette entry is AA (4.5:1) against the ink on EVERY theme', () => {
    const ink = tokenOf(service().monogram('Ivan', 'char:x').ink);
    expect(tokens.themes.length).toBe(3);
    for (const { id: theme } of tokens.themes) {
      for (const name of PLACEHOLDER_PALETTE) {
        const ratio = contrast(resolve(theme, name), resolve(theme, ink));
        expect(ratio, `${name} on ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('every id maps into the palette (no id falls outside the AA-checked set)', () => {
    const svc = service();
    for (let i = 0; i < 400; i++) {
      const bg = svc.monogram('Ivan', `char:${i}-${i * 7919}`).background;
      expect(PLACEHOLDER_PALETTE).toContain(tokenOf(bg));
    }
  });
});

// WCAG 2.x relative-luminance contrast, the formula axe-core's `color-contrast` rule uses.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
