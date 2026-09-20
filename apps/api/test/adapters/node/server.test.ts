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
// A real value isn't knowable yet (it names the origin, which includes the ephemeral port
// `beforeEach` only learns AFTER `startNodeServer` resolves) — but `startNodeServer` now validates
// `APP_ORIGIN` is PRESENT before it does anything else (fix round 1: `assertConfigured`), so a
// placeholder is required here just to get past boot; `beforeEach` overwrites it with the real
// `baseUrl` once the port is known, before any test that actually checks `Origin` runs.
process.env['APP_ORIGIN'] = 'http://placeholder.invalid';

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

describe('Node adapter — 128 KB WS message cap (whole-branch review finding 1)', () => {
  it('closes an oversized frame with code 1009, crashes nothing, and appends nothing', async () => {
    const username = `WsOversize${Date.now()}`;
    const verifier = verifierHex('ab1');

    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, salt: saltHex('ab2') }),
    });
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, deviceLabel: 'oversize-test' }),
    });
    const cookie = firstCookiePair(loginRes.headers.get('set-cookie'));

    const characterId = '01950000-0000-7000-8000-000000000003';
    await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: characterId, name: 'Bram', system: 'srd-5e-2024' }),
    });

    const closeCode = await new Promise<number>((resolvePromise, reject) => {
      const ws = new WsClient(`ws://127.0.0.1:${handle.port}/api/characters/${characterId}/ws`, {
        headers: { cookie, Origin: baseUrl },
      });
      const timeout = setTimeout(() => reject(new Error('timed out waiting for close')), 5000);
      ws.on('open', () => {
        // RED-first against the pre-fix `new WebSocketServer({ noServer: true })` (no
        // `maxPayload`, ~100 MiB default): a 200 KB frame — well over doc-08's 128 KB cap
        // (`core/validate.ts`'s `WS_MESSAGE_BYTES_MAX`) — is sent RAW (never valid JSON; doesn't
        // matter, `ws` must reject it at the frame-decode layer before `'message'` ever fires).
        ws.send('x'.repeat(200_000));
      });
      ws.on('message', () => {
        clearTimeout(timeout);
        reject(new Error('server processed an oversized frame instead of rejecting it'));
      });
      ws.on('close', (code) => {
        clearTimeout(timeout);
        resolvePromise(code);
      });
      ws.on('error', () => {
        /* `ws` also emits a client-side error for the same condition; 'close' is what this test
         * asserts on — swallow so it doesn't reject the promise as an unhandled test failure. */
      });
    });

    expect(closeCode).toBe(1009);

    // No server crash: the process is still answering ordinary requests fine afterward.
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);

    // Nothing appended: a fresh connection's `hello` -> `welcome` still reports an empty stream.
    const welcome = await new Promise<{ streams: { headSeq: number }[] }>((resolvePromise, reject) => {
      const ws = new WsClient(`ws://127.0.0.1:${handle.port}/api/characters/${characterId}/ws`, {
        headers: { cookie, Origin: baseUrl },
      });
      const timeout = setTimeout(() => reject(new Error('timed out waiting for welcome')), 5000);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            t: 'hello',
            rid: 'check-1',
            proto: 1,
            app: 'oversize-test',
            streams: [],
            have: [],
            pending: [],
          }),
        );
      });
      ws.on('message', (data) => {
        clearTimeout(timeout);
        ws.close();
        resolvePromise(JSON.parse((data as Buffer).toString('utf8')) as { streams: { headSeq: number }[] });
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    expect(welcome.streams[0]?.headSeq).toBe(0);
  });
});

describe('Node adapter — hard delete closes a live socket (whole-branch review finding 3)', () => {
  it('closes an open WS with code 1001, and a reconnect afterward is refused 403 at upgrade', async () => {
    const username = `WsDelete${Date.now()}`;
    const verifier = verifierHex('de1');

    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, salt: saltHex('d1') }),
    });
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, deviceLabel: 'delete-test' }),
    });
    const cookie = firstCookiePair(loginRes.headers.get('set-cookie'));

    const characterId = '01950000-0000-7000-8000-000000000004';
    await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: characterId, name: 'Cato', system: 'srd-5e-2024' }),
    });

    const ws = new WsClient(`ws://127.0.0.1:${handle.port}/api/characters/${characterId}/ws`, {
      headers: { cookie, Origin: baseUrl },
    });
    await new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for ws open')), 5000);
      ws.on('open', () => {
        clearTimeout(timeout);
        resolvePromise();
      });
      ws.on('error', reject);
    });

    const closePromise = new Promise<{ code: number; reason: string }>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for close after delete')), 5000);
      ws.on('close', (code, reasonBuf) => {
        clearTimeout(timeout);
        resolvePromise({ code, reason: reasonBuf.toString('utf8') });
      });
    });

    const deleteRes = await fetch(`${baseUrl}/api/characters/${characterId}`, {
      method: 'DELETE',
      headers: { ...XRW, cookie },
    });
    expect(deleteRes.status).toBe(204);

    const closeInfo = await closePromise;
    expect(closeInfo.code).toBe(1001);
    expect(closeInfo.reason).toBe('stream_closed');

    // Outer guard: a fresh reconnect attempt is refused at the upgrade itself (403) since the D1
    // ownership row is gone — never reaches the (now permanently closed) actor at all.
    const reconnectStatus = await new Promise<number | 'error'>((resolvePromise) => {
      const ws2 = new WsClient(`ws://127.0.0.1:${handle.port}/api/characters/${characterId}/ws`, {
        headers: { cookie, Origin: baseUrl },
      });
      ws2.on('open', () => resolvePromise(-1));
      ws2.on('unexpected-response', (_req, res) => resolvePromise(res.statusCode ?? -1));
      ws2.on('error', () => resolvePromise('error'));
    });
    expect(reconnectStatus).toBe(403);
  });
});

describe('Node adapter — recreate with the SAME id after hard delete (whole-branch re-review round 2)', () => {
  it('create -> hard delete -> POST create with the SAME id -> the character is fully usable (WS upgrade, hello, append)', async () => {
    // Whole-branch re-review round 2: finding 3's fix (closing live sockets + a `closed` flag on
    // `StreamActor`) introduced a NEW defect — `closed` never resets, and `NodeStreamHost` kept the
    // SAME `StreamRuntime`/actor cached forever under `streamId` (a plain `Map`, never evicted), so
    // recreating a character with the SAME client-supplied id (`POST /api/characters` succeeds once
    // the D1 row is gone — no more id collision, `core/routes/characters.ts`'s create route) reached
    // the SAME cached, PERMANENTLY-closed actor: every append on it was refused `stream_closed`
    // forever. RED-first: this test fails against the pre-round-2 `stream-host.ts` (captured
    // separately — see `final-fix-wave-report.md`'s round-2 section for the exact RED evidence).
    const username = `WsRecreate${Date.now()}`;
    const verifier = verifierHex('ac1');

    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, salt: saltHex('ac2') }),
    });
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: XRW,
      body: JSON.stringify({ username, verifier, deviceLabel: 'recreate-test' }),
    });
    const cookie = firstCookiePair(loginRes.headers.get('set-cookie'));

    const characterId = '01950000-0000-7000-8000-000000000005';
    const createRes = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: characterId, name: 'Deko', system: 'srd-5e-2024' }),
    });
    expect(createRes.status).toBe(201);

    const deleteRes = await fetch(`${baseUrl}/api/characters/${characterId}`, {
      method: 'DELETE',
      headers: { ...XRW, cookie },
    });
    expect(deleteRes.status).toBe(204);

    // RECREATE with the SAME id — the D1 row is gone, so this is a brand-new insert, not a
    // conflict (`core/routes/characters.ts`'s create route: `existing` is `undefined`).
    const recreateRes = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { ...XRW, cookie },
      body: JSON.stringify({ id: characterId, name: 'Deko II', system: 'srd-5e-2024' }),
    });
    expect(recreateRes.status).toBe(201);

    // The critical assertions: a FRESH WS upgrade for the SAME id succeeds, `hello` gets a real
    // `welcome`, and a live `append` is ACKED — not refused `stream_closed`.
    const result = await new Promise<{ welcome: { t: string; streams: unknown[] }; ackOrReject: { t: string } }>(
      (resolvePromise, reject) => {
        const ws = new WsClient(`ws://127.0.0.1:${handle.port}/api/characters/${characterId}/ws`, {
          headers: { cookie, Origin: baseUrl },
        });
        const timeout = setTimeout(() => reject(new Error('timed out waiting for welcome/ack')), 5000);
        let welcome: { t: string; streams: unknown[] } | undefined;

        ws.on('open', () => {
          ws.send(
            JSON.stringify({
              t: 'hello',
              rid: 'recreate-hello',
              proto: 1,
              app: 'recreate-test',
              streams: [],
              have: [],
              pending: [],
            }),
          );
        });
        ws.on('message', (data) => {
          const msg = JSON.parse((data as Buffer).toString('utf8')) as { t: string; streams?: unknown[] };
          if (msg.t === 'welcome') {
            welcome = msg as { t: string; streams: unknown[] };
            ws.send(
              JSON.stringify({
                t: 'append',
                rid: 'recreate-append',
                events: [
                  {
                    id: '01950000-0000-7000-8000-00000000aaaa',
                    stream: `char:${characterId}`,
                    ts: new Date().toISOString(),
                    actor: { userId: 'ignored-by-server', deviceId: 'device-1', role: 'owner' },
                    type: 'character.created',
                    v: 1,
                    payload: {
                      name: 'Deko II',
                      system: 'srd-5e-2024',
                      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
                      engineVersion: '1.0.0',
                      grammaticalGender: 'feminine',
                    },
                  },
                ],
              }),
            );
            return;
          }
          if ((msg.t === 'ack' || msg.t === 'reject') && welcome) {
            clearTimeout(timeout);
            ws.close();
            resolvePromise({ welcome, ackOrReject: msg });
          }
        });
        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      },
    );

    expect(result.welcome.streams).toEqual([
      { id: `char:${characterId}`, headSeq: 0, quota: { bytesUsed: 0, bytesMax: 2 * 1024 * 1024, eventCount: 0 } },
    ]);
    // The actual bug this round fixes: pre-fix, this was `reject` with code `stream_closed`.
    expect(result.ackOrReject.t).toBe('ack');
  });
});

/** [plan-9 Task 8] A tiny WS test harness for the campaign e2e below — collects every received
 * frame and lets a test `await` either "a frame matching X has already arrived, or arrives
 * shortly" (`waitForFrame`) or "no frame matching X arrives within a short window"
 * (`expectNoFrameWithin`), rather than hand-rolling a one-off promise per assertion the way the
 * simpler single-socket tests above do (this test needs THREE concurrent sockets). */
interface WsHarness {
  readonly frames: Record<string, unknown>[];
  send(msg: Record<string, unknown>): void;
  waitForFrame(
    predicate: (f: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
  close(): void;
}

function openCampaignWs(url: string, cookie: string, origin: string): Promise<WsHarness> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WsClient(url, { headers: { cookie, Origin: origin } });
    const frames: Record<string, unknown>[] = [];
    const waiters: {
      predicate: (f: Record<string, unknown>) => boolean;
      resolve: (f: Record<string, unknown>) => void;
    }[] = [];
    const openTimeout = setTimeout(() => reject(new Error('timed out waiting for ws open')), 5000);

    ws.on('open', () => {
      clearTimeout(openTimeout);
      resolvePromise({
        frames,
        send: (msg) => ws.send(JSON.stringify(msg)),
        waitForFrame: (predicate, timeoutMs = 5000) =>
          new Promise((res, rej) => {
            const existing = frames.find(predicate);
            if (existing) {
              res(existing);
              return;
            }
            const timeout = setTimeout(() => rej(new Error('timed out waiting for a matching frame')), timeoutMs);
            waiters.push({
              predicate,
              resolve: (f) => {
                clearTimeout(timeout);
                res(f);
              },
            });
          }),
        close: () => ws.close(),
      });
    });
    ws.on('message', (data) => {
      const msg = JSON.parse((data as Buffer).toString('utf8')) as Record<string, unknown>;
      frames.push(msg);
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        const waiter = waiters[i];
        if (waiter?.predicate(msg)) {
          waiters.splice(i, 1);
          waiter.resolve(msg);
        }
      }
    });
    ws.on('error', (err) => {
      clearTimeout(openTimeout);
      reject(err);
    });
  });
}

/** Asserts NO frame matching `predicate` arrives on `harness` within `timeoutMs` — used to prove
 * a genuinely FILTERED delivery (not merely "nothing has arrived yet"), always paired in this
 * test with a LATER frame the same connection DOES receive, so a dead/never-delivering connection
 * can't pass this by accident. */
async function expectNoFrameWithin(
  harness: WsHarness,
  predicate: (f: Record<string, unknown>) => boolean,
  timeoutMs = 400,
): Promise<void> {
  await expect(harness.waitForFrame(predicate, timeoutMs)).rejects.toThrow(/timed out/);
}

async function registerAndLogin(baseUrl: string, username: string, verifierSeed: string): Promise<string> {
  const verifier = verifierHex(verifierSeed);
  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, salt: saltHex(verifierSeed) }),
  });
  if (registerRes.status !== 201) {
    throw new Error(
      `registerAndLogin: register failed for ${username}: ${registerRes.status} ${await registerRes.text()}`,
    );
  }
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: XRW,
    body: JSON.stringify({ username, verifier, deviceLabel: `${username}-device` }),
  });
  if (loginRes.status !== 200) {
    throw new Error(`registerAndLogin: login failed for ${username}: ${loginRes.status} ${await loginRes.text()}`);
  }
  return firstCookiePair(loginRes.headers.get('set-cookie'));
}

describe('Node adapter — real end-to-end campaign WS (plan-9 Task 8)', () => {
  it('register 2 users -> create -> join by code -> roll.logged fan-out with dm-visibility filtering (invisible to the member, visible to the DM)', async () => {
    const dmCookie = await registerAndLogin(baseUrl, `CampDm${Date.now()}`, 'cad1');
    const memberCookie = await registerAndLogin(baseUrl, `CampMember${Date.now()}`, 'cae2');

    const campaignId = '01950000-0000-7000-9000-000000000001';
    const createRes = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { ...XRW, cookie: dmCookie },
      body: JSON.stringify({
        id: campaignId,
        name: 'The Sunless Citadel',
        system: 'srd-5e-2024',
        corePack: { id: 'srd-5e-2024', version: '1.0.0' },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { joinCode: string };
    expect(created.joinCode).toBeTruthy();

    const joinRes = await fetch(`${baseUrl}/api/campaigns/join`, {
      method: 'POST',
      headers: { ...XRW, cookie: memberCookie },
      body: JSON.stringify({ code: created.joinCode }),
    });
    expect(joinRes.status).toBe(200);

    const wsUrl = `ws://127.0.0.1:${handle.port}/api/campaigns/${campaignId}/ws`;
    // Three sockets, two accounts: the DM's OWN sending device (dmSender), a SECOND DM device
    // (dmObserver — proves "visible to the DM" via a genuine fan-out delivery, not the sender's
    // own `ack`, which `StreamActor.fanOut`'s doc comment notes excludes the source connection
    // regardless of visibility), and the member's device (memberObserver — proves "invisible to
    // the member").
    const [dmSender, dmObserver, memberObserver] = await Promise.all([
      openCampaignWs(wsUrl, dmCookie, baseUrl),
      openCampaignWs(wsUrl, dmCookie, baseUrl),
      openCampaignWs(wsUrl, memberCookie, baseUrl),
    ]);

    for (const [harness, rid] of [
      [dmSender, 'h-dm-sender'],
      [dmObserver, 'h-dm-observer'],
      [memberObserver, 'h-member-observer'],
    ] as const) {
      harness.send({ t: 'hello', rid, proto: 1, app: 'campaign-e2e-test', streams: [], have: [], pending: [] });
      const welcome = await harness.waitForFrame((f) => f['t'] === 'welcome' && f['rid'] === rid);
      expect((welcome['streams'] as unknown[])[0]).toMatchObject({ id: `camp:${campaignId}` });
    }

    const dmVisibleRollId = '01950000-0000-7000-9000-0000000000aa';
    dmSender.send({
      t: 'append',
      rid: 'roll-dm-visibility',
      events: [
        {
          id: dmVisibleRollId,
          stream: `camp:${campaignId}`,
          ts: new Date().toISOString(),
          actor: { userId: 'ignored-by-server', deviceId: 'dm-device-1', role: 'dm' },
          type: 'roll.logged',
          v: 1,
          payload: {
            label: 'Secret monster initiative',
            formula: '1d20+2',
            results: [{ die: 'd20', value: 14 }],
            total: 16,
            kind: 'check',
            visibility: 'dm',
          },
        },
      ],
    });

    const ack = await dmSender.waitForFrame((f) => f['t'] === 'ack' && f['rid'] === 'roll-dm-visibility');
    expect(ack['results']).toEqual([{ id: dmVisibleRollId, seq: expect.any(Number) as number }]);

    // Visible to the DM: a SECOND dm-role connection (not the sender) receives the roll via
    // ordinary fan-out.
    const dmObserverFrame = await dmObserver.waitForFrame(
      (f) =>
        f['t'] === 'events' &&
        (f['events'] as { id: string }[] | undefined)?.some((e) => e.id === dmVisibleRollId) === true,
    );
    expect((dmObserverFrame['events'] as { id: string; payload: { visibility: string } }[])[0]).toMatchObject({
      id: dmVisibleRollId,
      payload: { visibility: 'dm' },
    });

    // Invisible to the member: no `events` frame naming this roll arrives on the member's socket.
    await expectNoFrameWithin(
      memberObserver,
      (f) =>
        f['t'] === 'events' &&
        (f['events'] as { id: string }[] | undefined)?.some((e) => e.id === dmVisibleRollId) === true,
    );

    // Proves the member's connection isn't simply dead/filtered-everything: an 'everyone'-
    // visibility roll sent right after DOES reach it.
    const publicRollId = '01950000-0000-7000-9000-0000000000bb';
    dmSender.send({
      t: 'append',
      rid: 'roll-public',
      events: [
        {
          id: publicRollId,
          stream: `camp:${campaignId}`,
          ts: new Date().toISOString(),
          actor: { userId: 'ignored-by-server', deviceId: 'dm-device-1', role: 'dm' },
          type: 'roll.logged',
          v: 1,
          payload: {
            label: 'Public perception check',
            formula: '1d20',
            results: [{ die: 'd20', value: 11 }],
            total: 11,
            kind: 'check',
            visibility: 'everyone',
          },
        },
      ],
    });
    const memberSeesPublicRoll = await memberObserver.waitForFrame(
      (f) =>
        f['t'] === 'events' &&
        (f['events'] as { id: string }[] | undefined)?.some((e) => e.id === publicRollId) === true,
    );
    expect(memberSeesPublicRoll).toBeTruthy();

    dmSender.close();
    dmObserver.close();
    memberObserver.close();
  });
});

describe('Node adapter — fails fast at boot on missing secrets (fix round 1)', () => {
  // `beforeEach`/`afterEach` above still run around every test in this file (they boot/close a
  // SEPARATE, correctly-configured server — unrelated to the deliberately-misconfigured boot
  // attempts below, which each construct their own `startNodeServer` call and never touch
  // `handle`/`baseUrl`). `afterEach` closing the `beforeEach` server is harmless housekeeping.

  it('rejects, naming the missing variable, and never opens a listening socket, when SESSION_PEPPER is unset', async () => {
    const saved = process.env['SESSION_PEPPER'];
    delete process.env['SESSION_PEPPER'];
    const failDir = mkdtempSync(join(tmpdir(), 'hk-node-server-missing-secret-'));
    try {
      await expect(
        startNodeServer({
          port: 0,
          host: '127.0.0.1',
          dataDir: join(failDir, 'data'),
          webDistDir: join(failDir, 'web-dist'),
          envFile: join(failDir, 'no-such.env'),
        }),
      ).rejects.toThrow(/SESSION_PEPPER/);
    } finally {
      if (saved !== undefined) process.env['SESSION_PEPPER'] = saved;
      rmSync(failDir, { recursive: true, force: true });
    }
  });

  it('rejects, naming the missing variable, when APP_ORIGIN is unset', async () => {
    const saved = process.env['APP_ORIGIN'];
    delete process.env['APP_ORIGIN'];
    const failDir = mkdtempSync(join(tmpdir(), 'hk-node-server-missing-origin-'));
    try {
      await expect(
        startNodeServer({
          port: 0,
          host: '127.0.0.1',
          dataDir: join(failDir, 'data'),
          webDistDir: join(failDir, 'web-dist'),
          envFile: join(failDir, 'no-such.env'),
        }),
      ).rejects.toThrow(/APP_ORIGIN/);
    } finally {
      if (saved !== undefined) process.env['APP_ORIGIN'] = saved;
      rmSync(failDir, { recursive: true, force: true });
    }
  });

  it('boots normally when every required secret IS set (existing tests already cover this; asserted again here for contrast)', async () => {
    const okDir = mkdtempSync(join(tmpdir(), 'hk-node-server-all-set-'));
    const okHandle = await startNodeServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: join(okDir, 'data'),
      webDistDir: join(okDir, 'web-dist'),
      envFile: join(okDir, 'no-such.env'),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${okHandle.port}/api/health`);
      expect(res.status).toBe(200);
    } finally {
      await okHandle.close();
      rmSync(okDir, { recursive: true, force: true });
    }
  });
});
