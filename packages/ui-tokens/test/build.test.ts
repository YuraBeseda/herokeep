import { describe, expect, it } from 'vitest';
import { THEME_IDS, TOKENS, emitCss, emitScss } from '../src/index.ts';

/** The body of the first rule whose selector line starts with `selector`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('css emission', () => {
  const css = emitCss();

  it('emits a block per theme, tavern doubling as :root', () => {
    expect(css).toContain(":root, [data-theme='tavern'] {");
    expect(css).toContain("[data-theme='scroll'] {");
    expect(css).toContain("[data-theme='plain'] {");
    expect(css.endsWith('\n')).toBe(true);
  });

  it('emits colour variables under their tokens.json names, references as var()', () => {
    const tavern = rule(css, ":root, [data-theme='tavern']");
    expect(tavern).toContain('--leaf: #e9dcbb;');
    expect(tavern).toContain('--text-on-brass: #2b2118;');
    expect(tavern).toContain('--link: ');
    expect(rule(css, "[data-theme='plain']")).toContain('--brass: #e6c45a;');
    for (const token of TOKENS.color.tokens) {
      for (const theme of THEME_IDS) {
        const block = theme === 'tavern' ? ":root, [data-theme='tavern']" : `[data-theme='${theme}']`;
        expect(rule(css, block), `${token.name} / ${theme}`).toContain(`--${token.name}: `);
      }
    }
  });

  it('emits shadows and per-theme decoration inside the theme blocks', () => {
    expect(rule(css, ":root, [data-theme='tavern']")).toContain('--shadow-leaf: inset 0 0 0 1px #cbb68c');
    expect(rule(css, "[data-theme='plain']")).toContain('--shadow-leaf: 0 0 0 1px #6e6960;');
    expect(rule(css, ":root, [data-theme='tavern']")).toContain('--texture-wood: 1;');
    expect(rule(css, "[data-theme='scroll']")).toContain('--texture-wood: 0.4;');
    for (const name of ['texture-wood', 'texture-parchment', 'texture-leather', 'ornament-level']) {
      expect(rule(css, "[data-theme='plain']")).toContain(`--${name}: 0;`);
    }
    expect(rule(css, "[data-theme='plain']")).toContain('--leaf-tilt: 0deg;');
  });

  it('emits theme-independent tokens once, in a plain :root block', () => {
    const root = rule(css, ':root');
    expect(root).toContain('--space-4: 16px;');
    expect(root).toContain('--radius-leaf: 6px;');
    expect(root).toContain('--duration-base: 240ms;');
    expect(root).toContain('--touch-target: 44px;');
    expect(root).toContain("--font-display: Forum, 'Times New Roman', serif;");
    expect(root).toContain('--font-body: Alegreya, Georgia, serif;');
    expect(root).toContain('--shadow-2: 0 4px 12px rgb(0 0 0 / 0.35);');
    expect(root).not.toContain('--leaf:');
    expect(root).not.toContain('--texture-wood');
  });

  it('emits a .hk-type-<style> class per type style', () => {
    expect(css).toContain(
      '.hk-type-display-xl { font-family: var(--font-display); font-size: 48px; line-height: 52px; font-weight: 400; }',
    );
    expect(css).toContain('.hk-type-numeral-m {');
    expect(css).toMatch(/\.hk-type-numeral-m \{[^}]*font-variant-numeric: tabular-nums;/);
    expect(css).toMatch(/\.hk-type-hint \{[^}]*font-style: italic;/);
    expect(css).toMatch(/\.hk-type-button \{[^}]*font-weight: 600;/);
    expect(css).not.toMatch(/^\.display-xl/m);
  });

  it('is deterministic', () => {
    expect(emitCss()).toBe(emitCss());
  });
});

describe('scss emission', () => {
  const scss = emitScss();

  it('emits one $hk-tokens map keyed by theme plus shared', () => {
    expect(scss).toContain('$hk-tokens: (');
    for (const group of ['shared', ...THEME_IDS]) expect(scss).toContain(`  ${group}: (`);
    expect(scss).toContain("leaf: '#e9dcbb'");
    expect(scss).toContain("space-4: '16px'");
    expect(scss.endsWith(');\n')).toBe(true);
  });

  it('resolves references to concrete values', () => {
    expect(scss).toContain("text-on-leather: '#f3e6c8'");
    expect(scss).not.toContain('{');
  });

  it('is deterministic', () => {
    expect(emitScss()).toBe(emitScss());
  });
});
