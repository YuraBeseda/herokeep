import { deriveVerifierHex, randomSaltHex } from './auth-crypto';

/** jsdom WebCrypto check (task-2-brief NOTE): `@angular/build:unit-test`'s Vitest+jsdom
 * environment exposes a real `crypto.subtle` backed by Node's own WebCrypto implementation
 * (Node ≥ 20; this repo runs Node 24) — `crypto.subtle.importKey`/`deriveBits` work here exactly
 * as in a browser, so no `node:crypto` `webcrypto` polyfill injection is needed in
 * `src/test-setup.ts`. Verified empirically: this whole spec file runs unmodified against the
 * project's real jsdom test environment (no injected global) and the pinned vector below matches
 * a Node `node:crypto` `webcrypto` computation done out-of-band. If a future Angular/Vitest/jsdom
 * upgrade ever removes `crypto.subtle` from the test global, this file's every test — not just
 * the vector — will fail loudly, which is the point (no silent fallback to a weaker check).
 */

describe('auth-crypto', () => {
  describe('deriveVerifierHex', () => {
    // Cross-pinned test vector — see apps/api/test/adapters/node/seed.test.ts's
    // "cross-pinned PBKDF2 vector (see apps/web auth-crypto.spec.ts)" test, which asserts the
    // SAME password/salt/output triple against `apps/api/scripts/seed-api.ts`'s own
    // `deriveVerifierHex`. Both suites break together if either implementation drifts from
    // ADR-012 (PBKDF2-HMAC-SHA-256, 600,000 iterations, 32-byte output). Computed once via
    // `node:crypto`'s `webcrypto.subtle` out-of-band (not asserted against itself).
    const VECTOR_PASSWORD = 'correct horse battery staple';
    const VECTOR_SALT_HEX = '000102030405060708090a0b0c0d0e0f';
    const VECTOR_VERIFIER_HEX = 'ef177144eec9420cbc1093d2a8b344a92bc506d0d4ec9c028dd19f8324d8c1e6';

    it('matches the cross-pinned PBKDF2-HMAC-SHA-256 (600,000 iterations, 32-byte) vector shared with apps/api', async () => {
      const verifier = await deriveVerifierHex(VECTOR_PASSWORD, VECTOR_SALT_HEX);
      expect(verifier).toBe(VECTOR_VERIFIER_HEX);
    }, 15_000);

    it('returns a 64-char lowercase hex string (32 bytes)', async () => {
      const verifier = await deriveVerifierHex(VECTOR_PASSWORD, VECTOR_SALT_HEX);
      expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    }, 15_000);

    it('is deterministic for the same password/salt', async () => {
      const first = await deriveVerifierHex(VECTOR_PASSWORD, VECTOR_SALT_HEX);
      const second = await deriveVerifierHex(VECTOR_PASSWORD, VECTOR_SALT_HEX);
      expect(second).toBe(first);
    }, 15_000);

    it('produces a different verifier for a different password with the same salt', async () => {
      const original = await deriveVerifierHex(VECTOR_PASSWORD, VECTOR_SALT_HEX);
      const other = await deriveVerifierHex('a different password entirely', VECTOR_SALT_HEX);
      expect(other).not.toBe(original);
    }, 15_000);

    it('produces a different verifier for a different salt with the same password', async () => {
      const original = await deriveVerifierHex(VECTOR_PASSWORD, VECTOR_SALT_HEX);
      const other = await deriveVerifierHex(VECTOR_PASSWORD, '0f0e0d0c0b0a09080706050403020100');
      expect(other).not.toBe(original);
    }, 15_000);
  });

  describe('randomSaltHex', () => {
    it('returns a 32-char lowercase hex string (16 bytes)', () => {
      const salt = randomSaltHex();
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
    });

    it('is not the same value on successive calls', () => {
      const a = randomSaltHex();
      const b = randomSaltHex();
      expect(a).not.toBe(b);
    });
  });
});
