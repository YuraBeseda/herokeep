/** Task 4: cross-cutting middleware — `X-Requested-With` CSRF gate, 64 KB body limit, and a
 * light security-headers smoke check. */
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

function verifierHex(seed = 'a'): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
}
function saltHex(seed = 'b'): string {
  return seed.repeat(Math.ceil(32 / seed.length)).slice(0, 32);
}

describe('X-Requested-With gate', () => {
  it('rejects a non-GET /api/* request missing X-Requested-With with 403', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Ray', verifier: verifierHex(), salt: saltHex() }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a non-GET request with the wrong X-Requested-With value with 403', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ username: 'Ray', verifier: verifierHex(), salt: saltHex() }),
    });
    expect(res.status).toBe(403);
  });

  it('does not require X-Requested-With on a GET request', async () => {
    const res = await app.request('/api/auth/salt?username=anyone');
    expect(res.status).toBe(200);
  });
});

describe('body size limit', () => {
  it('rejects a body over 64 KB with 413', async () => {
    const oversized = 'x'.repeat(65 * 1024);
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'herokeep' },
      body: JSON.stringify({ username: 'Sam', verifier: verifierHex(), salt: saltHex(), extra: oversized }),
    });
    expect(res.status).toBe(413);
  });

  it('accepts a normal-sized body', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'herokeep' },
      body: JSON.stringify({ username: 'Tina', verifier: verifierHex(), salt: saltHex() }),
    });
    expect(res.status).toBe(201);
  });
});

describe('security headers', () => {
  it('sets nosniff on a JSON API response', async () => {
    const res = await app.request('/api/auth/salt?username=anyone');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
