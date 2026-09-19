/**
 * Node conformance runner (task-9-brief): boots the REAL Node adapter (`startNodeServer` — same
 * composition root `test/adapters/node/server.test.ts` exercises, no fakes, no in-process
 * `app.request()` shortcut) on an ephemeral port with fresh temp-dir SQLite files, then drives every
 * scenario in `./scenarios.ts` through a `ConformanceDriver` backed by real `fetch` + a real `ws`
 * client. Every assertion lives in `scenarios.ts` — this file is driver wiring ONLY (task-9-brief:
 * "runners contain ZERO assertions").
 *
 * A FRESH server (fresh SQLite files, fresh in-memory `MemoryRateLimit`) boots per scenario (`it`),
 * matching the Cloudflare runner's own per-test storage isolation (`@cloudflare/vitest-pool-workers`
 * default) — this is what keeps the `rate limits` scenario's per-IP bucket (shared, since every
 * request here really does originate from the same loopback address — `client-ip.ts`'s Node
 * override) from leaking hits accumulated by an EARLIER scenario's own `/api/auth/*` calls.
 */
process.env['SESSION_PEPPER'] = 'test-only-conformance-node-session-pepper';
process.env['SALT_HMAC_KEY'] = 'test-only-conformance-node-salt-hmac-key';
process.env['APP_ORIGIN'] = 'http://placeholder.invalid'; // overwritten per-test once the ephemeral port is known.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket as WsClient } from 'ws';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { ClientMessage, ServerMessage } from '@hk/protocol';
import { startNodeServer, type NodeServerHandle } from '../../src/adapters/node/server.ts';
import { FrameBuffer } from './frame-buffer.ts';
import { scenarios, type ConformanceDriver, type Session, type StreamDriver } from './scenarios.ts';

let dir: string;
let handle: NodeServerHandle;
let baseUrl: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hk-conformance-node-'));
  handle = await startNodeServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: join(dir, 'data'),
    webDistDir: join(dir, 'web-dist'),
    envFile: join(dir, 'no-such.env'),
  });
  baseUrl = `http://127.0.0.1:${handle.port}`;
  process.env['APP_ORIGIN'] = baseUrl; // Origin is checked lazily at request time — safe to set once the port is known.
});

afterEach(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

class NodeStreamDriver implements StreamDriver {
  private readonly buffer = new FrameBuffer<ServerMessage>();
  private readonly ws: WsClient;
  private readonly ready: Promise<void>;

  constructor(url: string, cookie: string) {
    this.ws = new WsClient(url, { headers: { cookie, Origin: baseUrl } });
    this.ready = new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(rawDataToString(data)) as ServerMessage;
      this.buffer.push(msg);
    });
  }

  async waitUntilOpen(): Promise<void> {
    await this.ready;
  }

  async send(msg: ClientMessage): Promise<void> {
    await this.ready;
    await new Promise<void>((resolve, reject) => {
      this.ws.send(JSON.stringify(msg), (err) => (err ? reject(err) : resolve()));
    });
  }

  collect(stop: (frames: readonly ServerMessage[]) => boolean, timeoutMs?: number): Promise<readonly ServerMessage[]> {
    return this.buffer.collect(stop, timeoutMs);
  }

  close(): void {
    this.ws.close();
  }
}

function rawDataToString(data: string | Buffer | ArrayBuffer | Buffer[]): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function makeDriver(): ConformanceDriver {
  return {
    fetch(path, init) {
      return fetch(`${baseUrl}${path}`, init);
    },
    async openStream({ streamId, session }: { streamId: string; session: Session }) {
      const stream = new NodeStreamDriver(
        `ws://127.0.0.1:${handle.port}/api/characters/${streamId.slice('char:'.length)}/ws`,
        session.cookie,
      );
      await stream.waitUntilOpen();
      return stream;
    },
  };
}

describe('cross-adapter conformance — Node', () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      await scenario.run(makeDriver());
    });
  }
});
