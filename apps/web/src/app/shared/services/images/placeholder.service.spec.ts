import { TestBed } from '@angular/core/testing';
import { PlaceholderService } from './placeholder.service';

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

  it('is deterministic: the SAME character id always yields the SAME hue', () => {
    const svc = service();
    const first = svc.monogram('Ivan', 'char:11111111-1111-1111-1111-111111111111').hue;
    const second = svc.monogram('Ivan', 'char:11111111-1111-1111-1111-111111111111').hue;
    expect(second).toBe(first);
    // The name is irrelevant to the hue — only the id is.
    expect(
      svc.monogram('A Totally Different Name', 'char:11111111-1111-1111-1111-111111111111').hue,
    ).toBe(first);
  });

  it('a different character id yields a different hue (no accidental collision for these fixtures)', () => {
    const svc = service();
    const a = svc.monogram('Ivan', 'char:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa').hue;
    const b = svc.monogram('Ivan', 'char:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb').hue;
    expect(b).not.toBe(a);
  });

  it('the hue is always a valid CSS hue degree: an integer in [0, 360)', () => {
    const hue = service().monogram('Ivan', 'char:some-character-id').hue;
    expect(Number.isInteger(hue)).toBe(true);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  // --- Fix round 1, finding 4: ONE centralized background formula, not one per caller -----------

  it('background is the exact `hsl(<hue> 45% 30%)` string derived from the SAME hue', () => {
    const result = service().monogram('Ivan', 'char:some-character-id');
    expect(result.background).toBe(`hsl(${result.hue} 45% 30%)`);
  });

  // task-12 fix round: `40%` failed WCAG AA color-contrast (axe, serious) against the placeholder's
  // near-white text for 167/360 hues (46.4%) — verified here for every possible hue, not just a
  // sample, so a future lightness change can't silently reintroduce an unsafe band.
  it('every possible hue stays at or above WCAG AA contrast (4.5:1) against the placeholder text (#f7f5f3)', () => {
    // `hueOf` isn't exported, and sweeping character ids isn't guaranteed to hit every hue (it's a
    // hash) — so this asserts the CONTRAST FORMULA itself (the one axe/WCAG actually use) against
    // `backgroundOf`'s own literal parameters (`s=45%`, `l=30%`) for every hue directly, which is
    // both exhaustive and independent of the hashing.
    for (let hue = 0; hue < 360; hue++) {
      expect(contrastRatio(hue, 45, 30, [0xf7, 0xf5, 0xf3])).toBeGreaterThanOrEqual(4.5);
    }
    // Sanity check the formula itself isn't vacuously true: the OLD `l=40%` must fail it somewhere
    // — proves this test would actually have caught the regression it's named for.
    const failsAt40 = Array.from({ length: 360 }, (_, hue) =>
      contrastRatio(hue, 45, 40, [0xf7, 0xf5, 0xf3]),
    ).some((ratio) => ratio < 4.5);
    expect(failsAt40).toBe(true);
  });
});

// --- WCAG 2.x relative-luminance contrast, the same formula axe-core's `color-contrast` rule uses
// (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance /
// https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio) — reimplemented here (not imported from
// anywhere) so this spec can assert the ACTUAL bar axe enforces, not just eyeball a handful of
// sampled colors.

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sFrac = s / 100;
  const lFrac = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sFrac * Math.min(lFrac, 1 - lFrac);
  const f = (n: number): number =>
    lFrac - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

function relativeLuminance([r, g, b]: readonly number[]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const channel = c / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(
  hue: number,
  saturation: number,
  lightness: number,
  textRgb: readonly number[],
): number {
  const bgLum = relativeLuminance(hslToRgb(hue, saturation, lightness));
  const textLum = relativeLuminance(textRgb);
  const [hi, lo] = bgLum > textLum ? [bgLum, textLum] : [textLum, bgLum];
  return (hi + 0.05) / (lo + 0.05);
}
