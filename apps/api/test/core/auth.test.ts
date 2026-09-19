/** Task 4: register, salt, login, reset — over Hono's `app.request()` with in-memory port fakes
 * (`test/helpers/fake-ports.ts`) and a real in-memory better-sqlite3 `Db` with migrations
 * applied (`test/helpers/test-db.ts`). Session/device/logout flows are in
 * `auth-sessions.test.ts`; XRW/body-limit middleware behavior is in `auth-middleware.test.ts`. */
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app.ts';
import { createTestConfig, InMemoryRateLimit } from '../helpers/fake-ports.ts';
import { openTestDb, type TestDbHandle } from '../helpers/test-db.ts';

let handle: TestDbHandle;
let app: Hono;

beforeEach(() => {
  handle = openTestDb();
  app = createTestApp({ db: handle.db, config: createTestConfig(), rateLimit: new InMemoryRateLimit() });
});

afterEach(() => {
  handle.close();
});

const XRW = { 'X-Requested-With': 'herokeep', 'Content-Type': 'application/json' };

/** A syntactically-valid 32-byte verifier / 16-byte salt hex string, distinguishable per
 * `seed` character so tests can register distinct users or attempt a mismatched login. */
function verifierHex(seed = 'a'): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
}
function saltHex(seed = 'b'): string {
  return seed.repeat(Math.ceil(32 / seed.length)).slice(0, 32);
}

async function register(username: string, verifier: string, salt = saltHex()) {
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, salt }),
  });
}

async function login(username: string, verifier: string, deviceLabel = 'Test device') {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, deviceLabel }),
  });
}

describe('POST /api/auth/register', () => {
  it('returns 201 with a userId and exactly 6 unique base32-grouped recovery codes', async () => {
    const res = await register('Alice', verifierHex());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { userId: string; recoveryCodes: string[] };

    expect(typeof body.userId).toBe('string');
    expect(body.userId.length).toBeGreaterThan(0);
    expect(body.recoveryCodes).toHaveLength(6);
    for (const code of body.recoveryCodes) {
      expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    }
    expect(new Set(body.recoveryCodes).size).toBe(6);
  });

  it('rejects a folded-username duplicate with 409, even under different display casing', async () => {
    const first = await register('Bob', verifierHex('1'));
    expect(first.status).toBe(201);

    const second = await register('bob', verifierHex('2'));
    expect(second.status).toBe(409);
  });

  it('rejects a malformed verifier (not 32-byte hex) with 400', async () => {
    const res = await register('Carol', 'not-hex');
    expect(res.status).toBe(400);
  });

  it('rejects a username shorter than 3 characters with 400', async () => {
    const res = await register('ab', verifierHex());
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/salt', () => {
  it('is stable and 32-hex-chars for an unknown username across two calls', async () => {
    const r1 = await app.request('/api/auth/salt?username=ghost');
    const r2 = await app.request('/api/auth/salt?username=ghost');
    const b1 = (await r1.json()) as { salt: string };
    const b2 = (await r2.json()) as { salt: string };

    expect(b1.salt).toBe(b2.salt);
    expect(b1.salt).toMatch(/^[0-9a-f]{32}$/i);
  });

  it('returns a fake salt for an unknown user in the same shape as a real one', async () => {
    await register('Dave', verifierHex('3'));
    const real = (await (await app.request('/api/auth/salt?username=Dave')).json()) as { salt: string };
    const fake = (await (await app.request('/api/auth/salt?username=nobody-at-all')).json()) as { salt: string };

    expect(real.salt).toMatch(/^[0-9a-f]{32}$/i);
    expect(fake.salt).toMatch(/^[0-9a-f]{32}$/i);
    expect(fake.salt).not.toBe(real.salt);
  });

  it('returns the exact stored salt for a known user', async () => {
    const salt = saltHex('7');
    await register('Erin', verifierHex('4'), salt);
    const res = (await (await app.request('/api/auth/salt?username=Erin')).json()) as { salt: string };
    expect(res.salt).toBe(salt);
  });
});

describe('POST /api/auth/login', () => {
  it('returns 401 for a wrong verifier', async () => {
    await register('Frank', verifierHex('5'));
    const res = await login('Frank', verifierHex('6'));
    expect(res.status).toBe(401);
  });

  it('returns 401 for an unknown username (no existence oracle)', async () => {
    const res = await login('nobody-registered', verifierHex('5'));
    expect(res.status).toBe(401);
  });

  it('succeeds with the exact cookie flags and a userId body on a matching verifier', async () => {
    await register('Grace', verifierHex('7'));
    const res = await login('Grace', verifierHex('7'), 'My phone');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { userId: string };
    expect(typeof body.userId).toBe('string');

    const cookie = res.headers.get('set-cookie');
    expect(cookie).not.toBeNull();
    expect(cookie).toMatch(/^hk_session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('locks out with 429 after repeated failures for the same username', async () => {
    await register('Heidi', verifierHex('8'));

    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push((await login('Heidi', verifierHex('9'))).status);
    }
    // ADR-012: "5 failures then lockout" — the first 5 attempts are genuine 401 failures, the
    // 6th is blocked.
    expect(results.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(results[5]).toBe(429);
  });
});

describe('POST /api/auth/reset', () => {
  it('burns the recovery code, rejects reuse, kills all sessions, and accepts the new credentials', async () => {
    const regRes = await register('Ivan', verifierHex('a1'));
    const { recoveryCodes } = (await regRes.json()) as { recoveryCodes: string[] };
    const firstCode = recoveryCodes[0]!;

    const loginRes = await login('Ivan', verifierHex('a1'), 'Old device');
    expect(loginRes.status).toBe(200);
    const oldCookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;

    const newSalt = saltHex('c1');
    const newVerifier = verifierHex('d1');
    const resetRes = await app.request('/api/auth/reset', {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username: 'Ivan', recoveryCode: firstCode, newSalt, newVerifier }),
    });
    expect(resetRes.status).toBe(200);

    const reuse = await app.request('/api/auth/reset', {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username: 'Ivan', recoveryCode: firstCode, newSalt, newVerifier }),
    });
    expect(reuse.status).toBe(401);

    const meWithOldSession = await app.request('/api/me', { headers: { ...XRW, cookie: oldCookie } });
    expect(meWithOldSession.status).toBe(401);

    const oldCredsLogin = await login('Ivan', verifierHex('a1'));
    expect(oldCredsLogin.status).toBe(401);

    const newCredsLogin = await login('Ivan', newVerifier);
    expect(newCredsLogin.status).toBe(200);
  });

  it('rejects an unknown username with 401 (no existence oracle)', async () => {
    const res = await app.request('/api/auth/reset', {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({
        username: 'nobody-at-all',
        recoveryCode: 'ABCDE-12345',
        newSalt: saltHex(),
        newVerifier: verifierHex(),
      }),
    });
    expect(res.status).toBe(401);
  });

  it('runs the same recovery-code lookup shape for an unknown username as for a known username with a wrong code (no timing-shaped existence oracle)', async () => {
    // Fix-round-1 regression test: the reset flow must do equivalent DB work whether the
    // username is unknown or just paired with a wrong code, matching login.ts's dummy-hash
    // pattern. A raw status-code comparison can't tell "returned 401 without looking anything
    // up" apart from "returned 401 after looking the code up and finding it invalid" — both are
    // already 401 either way — so this asserts the actual `db.select` call count instead: under
    // the pre-fix code, an unknown username short-circuited before the recovery-code lookup
    // (1 `select` — just the username lookup), while a known username with a wrong code always
    // ran the lookup too (2 `select`s). This assertion is RED against that shape (1 !== 2) and
    // GREEN once both paths run the same two lookups.
    await register('Xavier', verifierHex('e1'));

    const selectSpy = vi.spyOn(handle.db, 'select');
    const resetAttempt = (username: string) =>
      app.request('/api/auth/reset', {
        method: 'POST',
        headers: XRW,
        body: JSON.stringify({
          username,
          recoveryCode: 'WRONG1-CODE2',
          newSalt: saltHex(),
          newVerifier: verifierHex(),
        }),
      });

    selectSpy.mockClear();
    const knownUserWrongCode = await resetAttempt('Xavier');
    expect(knownUserWrongCode.status).toBe(401);
    const knownUserSelectCalls = selectSpy.mock.calls.length;

    selectSpy.mockClear();
    const unknownUser = await resetAttempt('nobody-registered-at-all');
    expect(unknownUser.status).toBe(401);
    const unknownUserSelectCalls = selectSpy.mock.calls.length;

    selectSpy.mockRestore();

    expect(unknownUserSelectCalls).toBe(knownUserSelectCalls);
  });
});
