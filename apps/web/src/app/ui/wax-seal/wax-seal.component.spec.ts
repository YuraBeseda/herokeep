import { TestBed } from '@angular/core/testing';
import { HkWaxSealComponent } from './wax-seal.component';
import { romanNumeral, waxBlobPath } from './wax-seal-geometry';

function make(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(HkWaxSealComponent);
  fixture.componentRef.setInput('hint', 'Spell slot, level 1 — 3 of 4 left');
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('HkWaxSealComponent', () => {
  it('shows the level numeral in roman figures (numeral=2 -> II)', () => {
    const { el } = make({ numeral: 2 });
    const texts = Array.from(el.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toEqual(['II', 'II']);
  });

  it('renders every roman numeral from I to IX', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(romanNumeral)).toEqual([
      'I',
      'II',
      'III',
      'IV',
      'V',
      'VI',
      'VII',
      'VIII',
      'IX',
    ]);
  });

  it('draws filled wax by default and a cooled ring when spent', async () => {
    const { fixture, el } = make({ glyph: 'gi:hand-ok' });
    expect(el.querySelector('.hk-seal-blob')).not.toBeNull();
    expect(el.querySelector('.hk-seal-spent-dash')).toBeNull();
    fixture.componentRef.setInput('state', 'spent');
    await fixture.whenStable();
    expect(el.querySelector('.hk-seal-spent-dash')).not.toBeNull();
    expect(el.querySelector('.hk-seal-rim')).toBeNull();
  });

  it('exposes state and size as classes', async () => {
    const { fixture, el } = make({ glyph: 'gi:hand-ok', size: 'l' });
    expect(el.classList.contains('hk-wax-seal--l')).toBe(true);
    for (const state of ['disabled', 'selected'] as const) {
      fixture.componentRef.setInput('state', state);
      await fixture.whenStable();
      expect(el.classList.contains(`hk-wax-seal--${state}`)).toBe(true);
    }
  });

  it('draws a glyph from the sprite three times (ink, sheen, body)', () => {
    const { el } = make({ glyph: 'ui:use' });
    const uses = Array.from(el.querySelectorAll('use')).map((u) => u.getAttribute('href'));
    expect(uses).toEqual(Array(3).fill('assets/icons/sprite.svg#ui-use'));
  });

  it('carries the required hint as accessible name, with no visible words', () => {
    const { el } = make({ glyph: 'gi:hand-ok' });
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Spell slot, level 1 — 3 of 4 left');
    // A glyph seal holds no text at all: the hint is the only wording, and it is not drawn.
    expect(el.textContent?.trim()).toBe('');
  });

  it('shows the hint as a tooltip on focus-less hover targets (describedby is set)', () => {
    const { fixture, el } = make({ numeral: 1 });
    expect(el.hasAttribute('aria-describedby')).toBe(false);
    el.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.getAttribute('aria-describedby')).toMatch(/^hk-tip-/);
  });

  it('is deterministic: the same seed draws the same blob, other seeds differ', () => {
    expect(waxBlobPath(3)).toBe(waxBlobPath(3));
    expect(waxBlobPath(3)).not.toBe(waxBlobPath(4));
    expect(waxBlobPath(3)).toMatch(/^M[\d. -]+C/);
  });

  it.each([0, 10, -1, 2.5])(
    'ignores the out-of-range numeral %s: no digits, no text',
    (numeral) => {
      const { el } = make({ glyph: 'gi:hand-ok', numeral });
      expect(el.querySelectorAll('text')).toHaveLength(0);
      expect(el.textContent?.trim()).toBe('');
      expect(el.querySelectorAll('use')).toHaveLength(3);
    },
  );
});
