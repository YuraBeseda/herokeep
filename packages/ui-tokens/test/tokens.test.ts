import { describe, expect, it } from 'vitest';
import { TOKENS, emitCss, emitScss } from '../src/index.ts';

describe('token table', () => {
  it('light and dark define identical key sets', () => {
    expect(Object.keys(TOKENS.light).sort()).toEqual(Object.keys(TOKENS.dark).sort());
  });
  it('no theme key collides with a shared key', () => {
    for (const k of Object.keys(TOKENS.light)) expect(TOKENS.shared[k], k).toBeUndefined();
  });
  it('carries the normative anchors', () => {
    expect(TOKENS.shared['touch-target']).toBe('44px');
    expect(TOKENS.shared['font-display']).toContain('Philosopher');
    expect(TOKENS.dark['surface-0']).toBe('hsl(240 6% 7%)');
    expect(TOKENS.light['text-1']).toBe('hsl(240 10% 12%)');
  });
});

describe('emission', () => {
  it('css exposes every token under --hk-free names and both theme blocks', () => {
    const css = emitCss();
    expect(css).toContain(':root {');
    expect(css).toContain("[data-theme='light'] {");
    expect(css).toContain("[data-theme='dark'] {");
    expect(css).toContain('--surface-0: hsl(240 6% 7%);'); // dark default in :root
    expect(css).toContain('--touch-target: 44px;');
    expect(css.endsWith('\n')).toBe(true);
  });
  it('scss emits one $hk-tokens map with all three groups', () => {
    const scss = emitScss();
    expect(scss).toContain('$hk-tokens: (');
    for (const g of ['shared', 'light', 'dark']) expect(scss).toContain(`${g}: (`);
  });
  it('emission is deterministic', () => {
    expect(emitCss()).toBe(emitCss());
    expect(emitScss()).toBe(emitScss());
  });
});
