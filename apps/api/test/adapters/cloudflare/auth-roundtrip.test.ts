/**
 * Register -> login roundtrip over the real in-pool worker (task-8-brief step 1) — this ALSO
 * proves D1 migrations were actually applied (`apply-migrations.ts`'s `setupFiles` hook): a
 * register that reaches `insertUser` needs the `users` table to already exist, so a passing 201
 * here is itself evidence the migration step worked, not just a separate assertion bolted on.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const XRW = { 'X-Requested-With': 'herokeep', 'Content-Type': 'application/json' };

// `seed` must be made of valid hex digits ONLY (0-9a-f) — `register`'s `verifier`/`salt` fields
// are validated as hex strings of an exact byte length (ADR-012), unlike an arbitrary seed word.
function verifierHex(seed: string): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
}
function saltHex(seed: string): string {
  return seed.repeat(Math.ceil(32 / seed.length)).slice(0, 32);
}

describe('Cloudflare Worker — register -> login roundtrip (D1-backed accounts db)', () => {
  it('registers a new account, then logs in with the same credentials', async () => {
    const username = `CfPoolSmoke${Date.now()}`;
    const verifier = verifierHex('cf1');

    const registerRes = await SELF.fetch('https://herokeep.test/api/auth/register', {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, salt: saltHex('ca1') }),
    });
    expect(registerRes.status).toBe(201);
    const registerBody: { userId: string; recoveryCodes: string[] } = await registerRes.json();
    expect(registerBody.recoveryCodes).toHaveLength(6);

    const loginRes = await SELF.fetch('https://herokeep.test/api/auth/login', {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, deviceLabel: 'cf-pool-test' }),
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.headers.get('set-cookie')).toBeTruthy();
    const loginBody: { userId: string } = await loginRes.json();
    expect(loginBody).toEqual({ userId: registerBody.userId });
  });
});
