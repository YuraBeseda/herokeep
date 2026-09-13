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

  it('background is the exact `hsl(<hue> 45% 40%)` string derived from the SAME hue', () => {
    const result = service().monogram('Ivan', 'char:some-character-id');
    expect(result.background).toBe(`hsl(${result.hue} 45% 40%)`);
  });
});
