import { describe, expect, it } from 'vitest';
import { THEME_IDS, TOKENS, resolveColor, tokenSchema, type ThemeId } from '../src/index.ts';
import raw from '../src/tokens.json' with { type: 'json' };

function channel(hex: string, from: number): number {
  const c = parseInt(hex.slice(from, from + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb (or #rrggbbaa, alpha ignored) colour. */
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(fg: string, bg: string, theme: ThemeId): number {
  const a = luminance(resolveColor(fg, theme));
  const b = luminance(resolveColor(bg, theme));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('token file', () => {
  it('parses against the schema', () => {
    expect(() => tokenSchema.parse(raw)).not.toThrow();
  });

  it('declares exactly the tavern, scroll and plain themes', () => {
    expect([...THEME_IDS]).toEqual(['tavern', 'scroll', 'plain']);
    expect(TOKENS.color.themes.map((t) => t.id)).toEqual([...THEME_IDS]);
  });

  it('has no duplicate token names across families', () => {
    const names = [
      ...TOKENS.color.tokens,
      ...TOKENS.spacing.tokens,
      ...TOKENS.radius.tokens,
      ...TOKENS.shadow.tokens,
      ...TOKENS.decoration.tokens,
      ...TOKENS.duration.tokens,
      ...TOKENS.size.tokens,
      ...TOKENS.legacy.tokens,
    ].map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every colour token a concrete value in every theme after resolving references', () => {
    expect(TOKENS.color.tokens).toHaveLength(132);
    for (const token of TOKENS.color.tokens) {
      for (const theme of THEME_IDS) {
        expect(resolveColor(token.name, theme), `${token.name} / ${theme}`).toMatch(
          /^(#[0-9a-f]{6}([0-9a-f]{2})?|rgba?\([^)]*\))$/i,
        );
      }
    }
  });

  it('keeps the names the screens still use', () => {
    const colour = new Set(TOKENS.color.tokens.map((t) => t.name));
    for (const name of [
      'text-1',
      'text-2',
      'text-3',
      'accent-strong',
      'warning',
      'overlay',
      'focus-ring',
    ]) {
      expect(colour.has(name), name).toBe(true);
    }
    const other = new Set(
      [
        ...TOKENS.spacing.tokens,
        ...TOKENS.radius.tokens,
        ...TOKENS.duration.tokens,
        ...TOKENS.size.tokens,
        ...TOKENS.legacy.tokens,
      ].map((t) => t.name),
    );
    for (const name of [
      'space-1',
      'space-2',
      'space-3',
      'space-4',
      'space-5',
      'space-6',
      'touch-target',
      'shadow-1',
      'shadow-2',
    ]) {
      expect(other.has(name), name).toBe(true);
    }
  });

  it('carries the design-system anchors', () => {
    expect(resolveColor('leaf', 'tavern')).toBe('#e9dcbb');
    expect(resolveColor('brass', 'plain')).toBe('#e6c45a');
    expect(TOKENS.type.families.display).toContain('Forum');
    expect(TOKENS.type.families.body).toContain('Alegreya');
  });

  it('sets every texture to 0 in plain and ornaments off', () => {
    const textures = TOKENS.decoration.tokens.filter((t) => t.name.startsWith('texture-'));
    expect(textures.map((t) => t.name)).toEqual(['texture-wood', 'texture-parchment', 'texture-leather']);
    for (const t of textures) {
      expect(typeof t.value === 'object' ? t.value['plain'] : t.value, t.name).toBe('0');
    }
    const byName = Object.fromEntries(TOKENS.decoration.tokens.map((t) => [t.name, t.value]));
    expect(byName['texture-wood']).toEqual({ tavern: '1', scroll: '0.4', plain: '0' });
    expect(byName['texture-parchment']).toEqual({ tavern: '1', scroll: '0.8', plain: '0' });
    expect(byName['ornament-level']).toEqual({ tavern: '2', scroll: '2', plain: '0' });
    expect(byName['leaf-tilt']).toEqual({ tavern: '0.3deg', scroll: '0.3deg', plain: '0deg' });
  });
});

describe('contrast (WCAG AA, 4.5:1)', () => {
  const pairs: [string, string][] = [
    ['text-1', 'leaf'],
    ['text-2', 'leaf'],
    ['text-on-leather', 'leather'],
    ['text-on-brass', 'brass'],
  ];
  for (const theme of THEME_IDS) {
    for (const [fg, bg] of pairs) {
      it(`${fg} on ${bg} in ${theme}`, () => {
        expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  // The screens paint these pairings (the retired aliases now point straight at these tokens).
  const legacy: [string, string][] = [
    ...(['text-1', 'text-2', 'text-3'] as const).flatMap((fg): [string, string][] => [
      [fg, 'leaf-dark'],
      [fg, 'leaf'],
      [fg, 'leaf-sunken'],
    ]),
    ['text-on-leather', 'link'],
    ['text-on-leather', 'danger-strong'],
    ['link', 'leaf-dark'],
    ['link', 'leaf'],
    ['danger-strong', 'leaf-dark'],
    ['danger-strong', 'leaf'],
    ['success-strong', 'leaf-dark'],
    ['success-strong', 'leaf'],
    ['warning', 'leaf'],
    ['link', 'leaf'],
  ];
  for (const theme of THEME_IDS) {
    for (const [fg, bg] of legacy) {
      it(`screen ${fg} on ${bg} in ${theme}`, () => {
        expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
