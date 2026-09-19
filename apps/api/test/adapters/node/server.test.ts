/**
 * Full Node adapter boot: `startNodeServer` wires every real port together (SQLite stores, WS
 * upgrade, static assets, env config, memory rate limit) and serves real HTTP — no fakes, no
 * `app.request()` in-process shortcut (task-7-brief step 1: "adapter boots createApp and serves
 * /api/health"; this task's ledgered obligations (a) and (d)).
 *
 * `SESSION_PEPPER`/`SALT_HMAC_KEY` are fixed TEST-ONLY values (Global Constraints: "conformance/
 * unit tests use fixed test values") set directly on `process.env` — this is the one test file in
 * the suite that exercises `EnvConfig` (every other test uses `fake-ports.ts`'s in-memory double),
 * so there is no other file for these to collide with in the same worker process.
 */
process.env['SESSION_PEPPER'] = 'test-only-node-adapter-session-pepper';
process.env['SALT_HMAC_KEY'] = 'test-only-node-adapter-salt-hmac-key';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket as WsClient } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startNodeServer, type NodeServerHandle } from '../../../src/adapters/node/server.ts';

const XRW = { 'X-Requested-With': 'herokeep', 'Content-Type': 'application/json' };

function verifierHex(seed: string): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
}
function saltHex(seed: string): string {
  return seed.repeat(Math.ceil(32 / seed.length)).slice(0, 32);
}

function firstCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('response carried no Set-Cookie header');
  return setCookieHeader.split(';')[0]!;
}

let dir: string;
let handle: NodeServerHandle;
let baseUrl: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hk-node-server-'));
  handle = await startNodeServer({
    port: 0, // ephemeral — the OS assigns a free port, read back from the returned handle.
    host: '127.0.0.1',
    dataDir: join(dir, 'data'),
    webDistDir: join(dir, 'web-dist'), // doesn't need to exist: a miss just answers 404.
    envFile: join(dir, 'no-such.env'), // no .env in the temp dir; relies on process.env above.
  });
  baseUrl = `http://127.0.0.1:${handle.port}`;
  // `Origin` is checked lazily at request time (`Config.get('APP_ORIGIN')`), so it's safe to set
  // this only once the real ephemeral port is known.
  process.env['APP_ORIGIN'] = baseUrl;
});

afterEach(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Node adapter — GET /api/health over real HTTP', () => {
  it('answers 200 {ok: true}', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('Node adapter — X-Hk-Client-Ip (obligation (a))', () => {
  it('overwrites a client-forged X-Hk-Client-Ip with the real socket address, so IP rate limiting cannot be dodged by spoofing it', async () => {
    // ADR-012: 30 auth requests/min/IP (`ip:<ip>:auth`, core/http/rate-limit.ts). Every one of
    // these 31 requests claims a DIFFERENT forged IP — if the adapter trusted the client header,
    // each would land in its own bucket and NONE would ever be blocked. Since the adapter must
    // overwrite it from the real loopback socket address before core ever sees the header, they
    // all land in the SAME bucket and the 31st is blocked.
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const res = await fetch(`${baseUrl}/api/auth/salt?username=probe-${i}`, {
        headers: { 'X-Hk-Client-Ip': `203.0.113.${i}` },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 200));
    expect(statuses[30]).toBe(429);
  });
});

describe('Node adapter — real end-to-end WS smoke (obligation (d))', () => {
  it('register -> login -> create character -> open a real ws:// upgrade -> hello -> welcome', async () => {
    const username = `WsSmoke${Date.now()}`;
    const verifier = verifierHex('e2e');

    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, salt: saltHex('a1') }),
    });
    expect(registerRes.status).toBe(201);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, deviceLabel: 'ws-smoke-test' }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = firstCookiePair(loginRes.headers.get('set-cookie'));

    const characterId = '01950000-0000-7000-8000-000000000001';
    const createRes = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: characterId, name: 'Wisp', system: 'srd-5e-2024' }),
    });
    expect(createRes.status).toBe(201);

    const welcome = await new Promise<{ t: string; rid: string; streams: unknown[] }>((resolvePromise, reject) => {
      const ws = new WsClient(`ws://127.0.0.1:${handle.port}/api/characters/${characterId}/ws`, {
        headers: { cookie, Origin: baseUrl },
      });
      const timeout = setTimeout(() => reject(new Error('timed out waiting for welcome')), 5000);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            t: 'hello',
            rid: 'hello-1',
            proto: 1,
            app: 'ws-smoke-test',
            streams: [],
            have: [],
            pending: [],
          }),
        );
      });
      ws.on('message', (data) => {
        clearTimeout(timeout);
        // The server only ever sends JSON text frames (never binary) — safe to treat `data` as a
        // `Buffer` here (see `server.ts`'s `rawDataToString` for the general-case handling).
        const msg = JSON.parse((data as Buffer).toString('utf8')) as { t: string; rid: string; streams: unknown[] };
        ws.close();
        resolvePromise(msg);
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(welcome.t).toBe('welcome');
    expect(welcome.rid).toBe('hello-1');
    expect(welcome.streams).toEqual([
      { id: `char:${characterId}`, headSeq: 0, quota: { bytesUsed: 0, bytesMax: 2 * 1024 * 1024, eventCount: 0 } },
    ]);
  });

  it('refuses the upgrade (real socket write, no ws handshake) when Origin does not match APP_ORIGIN', async () => {
    const username = `WsBadOrigin${Date.now()}`;
    const verifier = verifierHex('bad');

    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, salt: saltHex('b2') }),
    });
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, deviceLabel: 'bad-origin-test' }),
    });
    const cookie = firstCookiePair(loginRes.headers.get('set-cookie'));

    const characterId = '01950000-0000-7000-8000-000000000002';
    await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: characterId, name: 'Gale', system: 'srd-5e-2024' }),
    });

    const closeCode = await new Promise<number | 'error'>((resolvePromise) => {
      const ws = new WsClient(`ws://127.0.0.1:${handle.port}/api/characters/${characterId}/ws`, {
        headers: { cookie, Origin: 'https://evil.example' },
      });
      ws.on('open', () => resolvePromise(-1)); // should never fire
      ws.on('unexpected-response', (_req, res) => resolvePromise(res.statusCode ?? -1));
      ws.on('error', () => resolvePromise('error'));
    });

    expect(closeCode).toBe(403);
  });
});
