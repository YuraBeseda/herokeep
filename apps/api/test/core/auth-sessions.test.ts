/** Task 4: `/api/me`, devices list, logout, logout-all, single-session revoke. */
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

function verifierHex(seed = 'a'): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
}
function saltHex(seed = 'b'): string {
  return seed.repeat(Math.ceil(32 / seed.length)).slice(0, 32);
}

async function register(username: string, verifier: string) {
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, salt: saltHex() }),
  });
}

/** Registers (if not already) and logs in, returning the `name=value` cookie pair (no
 * attributes) ready to send back as the `cookie` request header. */
async function loginAndGetCookie(username: string, verifier: string, deviceLabel: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, deviceLabel }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('login did not set a session cookie');
  return setCookie.split(';')[0]!;
}

describe('GET /api/me', () => {
  it('returns the authed user’s id and username', async () => {
    await register('Judy', verifierHex('1'));
    const cookie = await loginAndGetCookie('Judy', verifierHex('1'), 'Laptop');

    const res = await app.request('/api/me', { headers: { ...XRW, cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; username: string };
    expect(body.username).toBe('Judy');
    expect(typeof body.userId).toBe('string');
  });

  it('returns 401 without a session cookie', async () => {
    const res = await app.request('/api/me', { headers: XRW });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('kills the session — a subsequent /api/me with the same cookie is 401', async () => {
    await register('Karl', verifierHex('2'));
    const cookie = await loginAndGetCookie('Karl', verifierHex('2'), 'Phone');

    const logoutRes = await app.request('/api/auth/logout', { method: 'POST', headers: { ...XRW, cookie } });
    expect(logoutRes.status).toBe(204);

    const meRes = await app.request('/api/me', { headers: { ...XRW, cookie } });
    expect(meRes.status).toBe(401);
  });
});

describe('POST /api/auth/logout-all', () => {
  it('kills every session for the user, not just the caller’s', async () => {
    await register('Leo', verifierHex('3'));
    const cookieA = await loginAndGetCookie('Leo', verifierHex('3'), 'Phone');
    const cookieB = await loginAndGetCookie('Leo', verifierHex('3'), 'Laptop');

    const res = await app.request('/api/auth/logout-all', { method: 'POST', headers: { ...XRW, cookie: cookieA } });
    expect(res.status).toBe(204);

    expect((await app.request('/api/me', { headers: { ...XRW, cookie: cookieA } })).status).toBe(401);
    expect((await app.request('/api/me', { headers: { ...XRW, cookie: cookieB } })).status).toBe(401);
  });
});

describe('GET /api/me/sessions (devices list)', () => {
  it('lists every session with its device label and marks only the caller’s as current', async () => {
    await register('Mona', verifierHex('4'));
    await loginAndGetCookie('Mona', verifierHex('4'), 'Phone');
    const laptopCookie = await loginAndGetCookie('Mona', verifierHex('4'), 'Laptop');

    const res = await app.request('/api/me/sessions', { headers: { ...XRW, cookie: laptopCookie } });
    expect(res.status).toBe(200);
    const devices = (await res.json()) as {
      id: string | null;
      deviceLabel: string;
      createdAt: number;
      lastSeenAt: number;
      current: boolean;
    }[];

    expect(devices).toHaveLength(2);
    const labels = devices.map((d) => d.deviceLabel).sort();
    expect(labels).toEqual(['Laptop', 'Phone']);

    const laptop = devices.find((d) => d.deviceLabel === 'Laptop')!;
    const phone = devices.find((d) => d.deviceLabel === 'Phone')!;
    expect(laptop.current).toBe(true);
    expect(phone.current).toBe(false);
    expect(typeof laptop.id).toBe('string');
  });
});

describe('DELETE /api/me/sessions/:id', () => {
  it('revokes the named session and it disappears from the list', async () => {
    await register('Nina', verifierHex('5'));
    const cookie = await loginAndGetCookie('Nina', verifierHex('5'), 'Tablet');

    const before = (await (await app.request('/api/me/sessions', { headers: { ...XRW, cookie } })).json()) as {
      id: string;
    }[];
    const sessionId = before[0]!.id;

    const del = await app.request(`/api/me/sessions/${sessionId}`, { method: 'DELETE', headers: { ...XRW, cookie } });
    expect(del.status).toBe(204);

    // The revoked session was the caller's own — it's gone, so /api/me now 401s.
    const meRes = await app.request('/api/me', { headers: { ...XRW, cookie } });
    expect(meRes.status).toBe(401);
  });

  it('404s when revoking a session id that belongs to a different user', async () => {
    await register('Oscar', verifierHex('6'));
    await register('Priya', verifierHex('7'));
    const oscarCookie = await loginAndGetCookie('Oscar', verifierHex('6'), 'Oscar device');
    const priyaCookie = await loginAndGetCookie('Priya', verifierHex('7'), 'Priya device');

    const oscarSessions = (await (
      await app.request('/api/me/sessions', { headers: { ...XRW, cookie: oscarCookie } })
    ).json()) as { id: string }[];
    const oscarSessionId = oscarSessions[0]!.id;

    const res = await app.request(`/api/me/sessions/${oscarSessionId}`, {
      method: 'DELETE',
      headers: { ...XRW, cookie: priyaCookie },
    });
    expect(res.status).toBe(404);

    // Oscar's session is untouched.
    expect((await app.request('/api/me', { headers: { ...XRW, cookie: oscarCookie } })).status).toBe(200);
  });

  it('404s for an id that does not exist', async () => {
    await register('Quinn', verifierHex('8'));
    const cookie = await loginAndGetCookie('Quinn', verifierHex('8'), 'Device');

    const res = await app.request('/api/me/sessions/00000000-0000-7000-8000-000000000000', {
      method: 'DELETE',
      headers: { ...XRW, cookie },
    });
    expect(res.status).toBe(404);
  });
});
