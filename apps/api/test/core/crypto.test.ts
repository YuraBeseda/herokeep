import { describe, expect, it } from 'vitest';
import { constantTimeEqual, hmacSha256Hex, randomToken, sha256Hex } from '../../src/core/crypto.ts';

describe('sha256Hex', () => {
  it('matches the known test vector for "abc"', async () => {
    // FIPS 180-2 Appendix B.1 example.
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes a Uint8Array the same way as the equivalent UTF-8 string', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(await sha256Hex('abc'));
  });
});

describe('hmacSha256Hex', () => {
  it('matches RFC 4231 test case 1', async () => {
    const key = '\x0b'.repeat(20);
    expect(await hmacSha256Hex(key, 'Hi There')).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });
});

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('same-value', 'same-value')).toBe(true);
  });

  it('returns false for unequal strings of the same length', () => {
    expect(constantTimeEqual('aaaaaaaaaa', 'aaaaaaaaab')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(constantTimeEqual('short', 'a-lot-longer')).toBe(false);
  });

  it('treats two empty strings as equal', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('randomToken', () => {
  it('returns lowercase hex of the requested byte length', () => {
    const token = randomToken(16);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces different tokens across calls (uniqueness)', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken(16)));
    expect(tokens.size).toBe(50);
  });
});
