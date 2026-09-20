import { normalizeRecoveryCode } from './recovery-code';

describe('normalizeRecoveryCode', () => {
  // Recovery codes are drawn from the RFC-4648 base32 alphabet (`A-Z2-7` — no 0/1/8/9, see
  // `apps/api/src/core/auth/recovery-codes.ts`'s `BASE32_ALPHABET`), so every fixture below uses
  // only digits 2-7.
  it('uppercases a lowercase code', () => {
    expect(normalizeRecoveryCode('abcde23456')).toBe('ABCDE23456');
  });

  it('strips the display grouping hyphen', () => {
    expect(normalizeRecoveryCode('ABCDE-23456')).toBe('ABCDE23456');
  });

  it('strips stray whitespace pasted alongside the code', () => {
    expect(normalizeRecoveryCode('  ABCDE-23456  ')).toBe('ABCDE23456');
  });

  it('strips characters outside the base32 alphabet (e.g. 0/1/8/9, which are not in A-Z2-7)', () => {
    expect(normalizeRecoveryCode('AB01CD89')).toBe('ABCD');
  });

  it('handles a full mixed-case, hyphenated, whitespace-padded paste in one pass', () => {
    expect(normalizeRecoveryCode(' aBcDe-fGh23 ')).toBe('ABCDEFGH23');
  });
});
