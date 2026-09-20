/**
 * The Node adapter's entrypoint (ADR-014 §Adapter B; doc-10 §node): `@hono/node-server` on
 * `127.0.0.1:8787` (env-configurable), `.env` config, SQLite files under a data dir, static assets
 * from `apps/web/dist`, and the `ws`-backed WebSocket upgrade handoff. `startNodeServer(options)`
 * is the composition root every port implementation in this directory is wired together by; the
 * bottom of this file calls it when the file is run directly (`node src/adapters/node/server.ts` —
 * Node 24 strips this repo's TS syntax natively, matching how `packages/content`'s `build:pack`
 * script runs `node src/cli.ts` unchanged, per this task's brief).
 *
 * ## WS upgrade flow (obligation (d) — read together with `ports/infra.ts`'s `WsUpgrade` doc
 * comment, which this implements)
 *
 * `@hono/node-server` has no portable way to complete a raw WebSocket handshake through its own
 * `serve()`/`getRequestListener()` request cycle (those write a `ServerResponse`; a 101 Switching
 * Protocols handshake needs the raw `net.Socket` instead) — so this adapter registers its OWN
 * `http.Server` `'upgrade'` listener, alongside `getRequestListener(app.fetch)` for every ORDINARY
 * request. Both paths funnel through the SAME `Hono` app (`app.fetch`), so session/ownership/
 * `Origin` verification (`core/routes/characters.ts`'s `GET /:id/ws` handler) runs identically
 * either way — core has no idea which adapter path it was reached through.
 *
 * The two paths are stitched together like this:
 *
 *   1. `http.Server` emits `'upgrade'` with `(req, socket, head)` — the raw pieces `ws`'s
 *      `WebSocketServer.handleUpgrade` needs, but NOT a `Request`/`Response` pair.
 *   2. This file builds a minimal Fetch `Request` from `req` (GET, no body — a WS handshake never
 *      carries one) and stashes `{req, socket, head, handled: false}` in a `pending` map keyed by a
 *      fresh, server-generated correlation token; that token is stamped onto the OUTGOING Fetch
 *      request as an internal header (`x-hk-upgrade-token`) core never reads or forwards anywhere
 *      (it isn't part of any schema/route logic) — it exists purely to let step 4 find its way back
 *      to the exact `{socket, head}` this specific upgrade attempt owns.
 *   3. `app.fetch(request)` runs — through `createApp`'s full middleware stack — and reaches
 *      `core/routes/characters.ts`'s WS route, which (after session/ownership/Origin checks ALL
 *      pass) calls `deps.wsUpgrade.upgrade(request, ctx)`: THIS file's `NodeWsUpgrade.upgrade`.
 *   4. `NodeWsUpgrade.upgrade` reads the correlation token back off `request.headers`, looks up the
 *      matching `pending` entry, marks it `handled = true`, and calls `wss.handleUpgrade(req,
 *      socket, head, callback)` — `ws`'s OWN handshake, which writes the real 101 response directly
 *      to the raw socket. Inside the callback (now holding a live `ws.WebSocket`), it fetches this
 *      stream's `StreamRuntime` from `NodeStreamHost.getRuntime(ctx.streamId)`, registers the
 *      socket with that runtime's `Connections` (`.accept(ws, {userId, role, subs: []})` — the
 *      attachment doc-03's lifecycle diagram calls for), and wires `'message'` to
 *      `runtime.withLock(() => actor.handleMessage(conn, parsed))` — the SAME per-actor mutex an
 *      HTTP-triggered `deleteAll` goes through, so a WS append and an HTTP hard-delete on the same
 *      stream can never interleave. `upgrade()` returns an ordinary in-range `Response` (the Fetch
 *      `Response` constructor rejects status 101 outright) that step 5 never forwards to a client.
 *   5. Back in the `'upgrade'` handler, once `app.fetch(request)` resolves: if the pending entry's
 *      `handled` flag is still `false` (verification FAILED before ever reaching step 4 — a 401/403
 *      from `requireAuth`/the ownership/Origin checks), this file writes THAT real HTTP response
 *      (status + headers + body) directly onto the raw socket itself and closes it — the client
 *      that attempted the upgrade sees the actual rejection status, not a silently dropped
 *      connection. If `handled` is `true`, nothing further happens here: `ws` already answered the
 *      handshake in step 4.
 *
 * A plain (non-upgrade) `GET /api/characters/:id/ws` — no `Connection: Upgrade` header, so
 * `http.Server` never emits `'upgrade'` for it and it's handled by the ordinary request listener
 * instead — reaches the same route, passes verification, and calls `wsUpgrade.upgrade()` with NO
 * matching `pending` entry (nothing populated one): `NodeWsUpgrade.upgrade` answers `400` in that
 * case, since there is no raw socket to hand a real handshake to.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync } from 'node:fs';
import { type AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { WebSocketServer, type RawData } from 'ws';
import { createApp } from '../../core/app.ts';
import { runDailyMaintenance } from '../../core/maintenance.ts';
import type { ConnAttachment } from '../../core/streams/stream-actor.ts';
import { CLIENT_IP_HEADER } from '../../core/http/client-ip.ts';
import { WS_MESSAGE_BYTES_MAX } from '../../core/validate.ts';
import type { WsUpgrade, WsUpgradeContext } from '../../ports/infra.ts';
import { assertConfigured, EnvConfig, loadEnvFile } from './config.env.ts';
import { NodeMaintenanceStreams } from './maintenance-streams.ts';
import { MemoryRateLimit } from './rate-limit.memory.ts';
import { IntervalScheduler } from './scheduler.interval.ts';
import { NodeStaticAssets } from './static.ts';
import { openAccountsDb, type AccountsDbHandle } from './db.sqlite.ts';
import { openStreamsDb } from './store.sqlite-file.ts';
import { NodeStreamHost } from './stream-host.ts';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
/** Adapter-internal correlation header (obligation (d), step 2) — never read by core, never
 * forwarded to a real client. Lower-cased: Node's `IncomingMessage.headers` keys are always
 * lower-case regardless of the wire casing. */
const UPGRADE_TOKEN_HEADER = 'x-hk-upgrade-token';
const CLIENT_IP_HEADER_LOWER = CLIENT_IP_HEADER.toLowerCase();

export interface NodeServerOptions {
  readonly port?: number;
  readonly host?: string;
  /** Directory SQLite files (`accounts.sqlite`, `streams.sqlite`) live under. Default: `./data`
   * relative to `apps/api`'s own package root (task-7-brief: "SQLite files under a data dir
   * (env-configurable; default ./data for dev)") — the `%ProgramData%` path ADR-014's self-host
   * recipe uses is that recipe's OWN concern (Task 12), set via `HK_DATA_DIR` at service-install
   * time, not a different code path here. */
  readonly dataDir?: string;
  /** Directory the built Angular app is served from. Default: `apps/web/dist`. */
  readonly webDistDir?: string;
  /** `.env` file to load. Default: `apps/api/.env` (gitignored; `.env.example` is committed). */
  readonly envFile?: string;
}

export interface NodeServerHandle {
  readonly port: number;
  readonly host: string;
  readonly dataDir: string;
  close(): Promise<void>;
}

interface PendingUpgrade {
  readonly req: IncomingMessage;
  readonly socket: Duplex;
  readonly head: Buffer;
  handled: boolean;
}

/** `ports/infra.ts`'s `WsUpgrade` port, Node's implementation — see this file's header comment for
 * the full flow this is step 4 of. */
class NodeWsUpgrade implements WsUpgrade {
  private readonly pending: Map<string, PendingUpgrade>;
  private readonly wss: WebSocketServer;
  private readonly streamHost: NodeStreamHost;

  constructor(pending: Map<string, PendingUpgrade>, wss: WebSocketServer, streamHost: NodeStreamHost) {
    this.pending = pending;
    this.wss = wss;
    this.streamHost = streamHost;
  }

  upgrade(request: Request, ctx: WsUpgradeContext): Promise<Response> {
    const token = request.headers.get(UPGRADE_TOKEN_HEADER);
    const entry = token ? this.pending.get(token) : undefined;
    if (!entry) {
      // No genuine `'upgrade'` HTTP event backs this call (see header comment's closing
      // paragraph) — there is no raw socket to hand a real WS handshake to.
      return Promise.resolve(new Response('Upgrade required', { status: 400 }));
    }
    entry.handled = true;

    return new Promise<Response>((resolveResponse) => {
      this.wss.handleUpgrade(entry.req, entry.socket, entry.head, (ws) => {
        const runtime = this.streamHost.getRuntime(ctx.streamId);
        const attachment: ConnAttachment = {
          userId: ctx.userId,
          role: ctx.role,
          subs: [],
          ...(ctx.displayName !== undefined ? { displayName: ctx.displayName } : {}),
        };
        const conn = runtime.connections.accept(ws, attachment);

        ws.on('message', (data: RawData, isBinary: boolean) => {
          // [plan-9 Task 8] Binary frame RECEIVE wiring (doc-07 §Blob transfer protocol; Task 7's
          // `Connections.sendBinary` shipped the SEND side only). Routed to
          // `StreamActor.handleBinaryMessage` — a virtual no-op on a plain character stream
          // (`CampaignActor` overrides it for the real blob relay) — NOT through `withLock`: the
          // relay is purely in-memory forwarding state (`BlobRelay`), never a store mutation, so
          // it doesn't need the same single-writer serialization an `append`/`deleteAll` does.
          // `ws`'s own `maxPayload: WS_MESSAGE_BYTES_MAX` (below) already bounds every frame,
          // binary included, at the WS layer before this handler ever runs — doc-03's WS message
          // size limit is enforced identically for both frame kinds.
          if (isBinary) {
            runtime.actor.handleBinaryMessage(conn, rawDataToBytes(data));
            return;
          }
          void runtime.withLock(() => runtime.actor.handleMessage(conn, safeJsonParse(rawDataToString(data))));
        });

        // [plan-9 Task 8] "a connection went away" (doc-10 §Presence; `StreamActor
        // .onConnectionClosed`'s own doc comment) — registered AFTER `runtime.connections.accept`
        // above, so `ws`'s own close-listener ordering guarantee (listeners fire in registration
        // order) means `WsConnections.accept`'s internal cleanup listener (which removes this
        // socket from `sockets`/`attachments`) has ALREADY run by the time this fires, satisfying
        // the "call AFTER removal" contract `CampaignActor.onConnectionClosed` documents. Called
        // unconditionally for every stream kind (virtual dispatch: a no-op on a plain character
        // stream, a real presence broadcast + blob-relay cleanup on a campaign stream) — same
        // uniform-dispatch shape `handleBinaryMessage` above already uses.
        ws.on('close', () => {
          // [fix round 1, plan-9 Task 10 review] Best-effort: this fires after the socket is
          // already gone, so a rejection here (a transient DB failure mid-presence-rebroadcast, a
          // store already torn down during shutdown) has nothing useful to report to and must never
          // surface as an unhandled promise rejection — same stance `campaigns.ts`'s
          // `closeConnectionsForUser`/rollback calls already take.
          void runtime.actor.onConnectionClosed(conn).catch(() => undefined);
        });

        // Response never observed by a real client (`ports/infra.ts`'s `WsUpgrade` doc comment):
        // `ws.handleUpgrade`'s callback firing means the 101 handshake already completed on the
        // raw socket. An in-range marker status satisfies the Fetch `Response` constructor
        // (101 itself is rejected outright) and Hono's handler contract without a second response
        // ever being sent.
        resolveResponse(new Response(null, { status: 200, headers: { 'X-Hk-Ws-Upgraded': '1' } }));
      });
    });
  }
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8'); // ArrayBuffer
}

/** [plan-9 Task 8] Same three-shape handling as `rawDataToString` above (`ws`'s `RawData` union),
 * for a BINARY frame instead of a text one — a plain `Uint8Array` view, never copying when `data`
 * is already a single `Buffer` (a `Buffer` IS a `Uint8Array`; `new Uint8Array(buf.buffer, ...)`
 * would double-wrap it, so this returns the buffer itself, which already satisfies `Uint8Array`). */
function rawDataToBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return new Uint8Array(data); // ArrayBuffer
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; // fails `parseClientMessage`'s discriminated-union check -> 1008 close, by design.
  }
}

/** Sets `X-Hk-Client-Ip` from the ACTUAL socket remote address, overwriting/stripping whatever the
 * client itself sent (obligation (a); `core/http/client-ip.ts`'s doc comment: "Node ...
 * `socket.remoteAddress` ... a client-supplied one is overwritten"). Runs for EVERY inbound
 * request — ordinary and upgrade alike — before either ever reaches `app.fetch`, so core's
 * `getClientIp` can never observe a client-forged value. */
function stampClientIp(req: IncomingMessage): void {
  req.headers[CLIENT_IP_HEADER_LOWER] = req.socket.remoteAddress ?? 'unknown';
}

/** Builds a minimal Fetch `Request` from a raw upgrade `IncomingMessage` (GET, no body — a WS
 * handshake never carries one). Ordinary requests go through `@hono/node-server`'s own
 * `getRequestListener`, which does this more completely (bodies, streaming, etc.); this hand-
 * rolled version only needs to carry the method/url/headers far enough for `createApp`'s
 * middleware (session cookie, ownership, `Origin`) to run correctly. */
function upgradeRequestToFetchRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? `${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const url = `http://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.append(key, value);
  }
  return new Request(url, { method: req.method ?? 'GET', headers });
}

/** Writes a real Fetch `Response` (a verification failure core's route threw — 401/403/etc.)
 * directly onto the raw socket, since there is no `ServerResponse` object for this path (the
 * `'upgrade'` event only hands us the socket). Used only when `NodeWsUpgrade.upgrade` was NEVER
 * reached (see this file's header comment, step 5). */
async function writeSocketResponse(socket: Duplex, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  const statusText = response.statusText.length > 0 ? response.statusText : 'Error';
  const lines = [`HTTP/1.1 ${response.status} ${statusText}`, 'Connection: close', `Content-Length: ${body.length}`];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-length') lines.push(`${key}: ${value}`);
  });
  if (!socket.destroyed) {
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    socket.write(body);
    socket.end();
  }
}

export async function startNodeServer(options: NodeServerOptions = {}): Promise<NodeServerHandle> {
  const apiRoot = fileURLToPath(new URL('../../../', import.meta.url)); // apps/api/

  loadEnvFile(options.envFile ?? join(apiRoot, '.env'));

  // Fail fast (fix round 1): validate every secret `Config` port name BEFORE touching the
  // filesystem/network at all — a missing `SESSION_PEPPER`/`SALT_HMAC_KEY`/`APP_ORIGIN` must
  // abort the boot itself, not silently "succeed" and only 500 on the first real request. See
  // `config.env.ts`'s `assertConfigured` doc comment for the full rationale.
  const config = new EnvConfig();
  assertConfigured(config);

  const host = options.host ?? process.env['HK_HOST'] ?? DEFAULT_HOST;
  const port = options.port ?? Number(process.env['HK_PORT'] ?? DEFAULT_PORT);
  const dataDir = resolve(options.dataDir ?? process.env['HK_DATA_DIR'] ?? join(apiRoot, 'data'));
  const webDistDir = resolve(
    options.webDistDir ?? process.env['HK_WEB_DIST_DIR'] ?? join(apiRoot, '..', 'web', 'dist'),
  );
  mkdirSync(dataDir, { recursive: true });

  const rateLimit = new MemoryRateLimit();
  const scheduler = new IntervalScheduler();
  const staticAssets = new NodeStaticAssets(webDistDir);

  const accounts: AccountsDbHandle = openAccountsDb(join(dataDir, 'accounts.sqlite'));
  const streamsSqlite = openStreamsDb(join(dataDir, 'streams.sqlite'));
  const streamHost = new NodeStreamHost(streamsSqlite);

  // Daily maintenance (doc-10 §Daily maintenance; `core/maintenance.ts`) — wired to
  // `IntervalScheduler.daily` per that class's own doc comment ("Task 10 has something to call
  // `.daily(runMaintenance)` against"). `NodeMaintenanceStreams` reads the SAME shared
  // `streams.sqlite` handle `streamHost` uses, directly (see that class's header comment for why
  // it bypasses the per-stream actor path).
  const maintenanceStreams = new NodeMaintenanceStreams(streamsSqlite);
  scheduler.daily(async () => {
    const report = await runDailyMaintenance({ db: accounts.db, streams: maintenanceStreams });
    // Security of logs (Global Constraints): no request bodies, no usernames — `MaintenanceReport`
    // is exactly "counters and error classes only", safe to log in full.
    console.log('herokeep daily maintenance', JSON.stringify(report));
  });

  const pending = new Map<string, PendingUpgrade>();
  // `maxPayload` (whole-branch review finding 1): `ws` defaults to ~100 MiB, far above doc-08's
  // 128 KB WS-message cap (`core/validate.ts`'s `WS_MESSAGE_BYTES_MAX`) — without this, a client
  // could send an oversized frame that `ws` happily buffers/delivers instead of ever reaching
  // `validateEvent`'s own per-event check. `ws` enforces this itself at the frame-decode layer:
  // an oversized frame closes the connection with code 1009 before `'message'` ever fires, no
  // server crash, nothing appended (verified in `receiver.js`'s own `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`
  // handling).
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MESSAGE_BYTES_MAX });
  const wsUpgrade = new NodeWsUpgrade(pending, wss, streamHost);

  const app = createApp({ db: accounts.db, config, rateLimit, streamHost, wsUpgrade, staticAssets });
  const listener = getRequestListener(app.fetch);

  const httpServer = createServer((req, res) => {
    stampClientIp(req);
    delete req.headers[UPGRADE_TOKEN_HEADER]; // strip any client-forged correlation token too.
    void listener(req, res);
  });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => {
      /* swallow — an abrupt client disconnect mid-handshake is not a server error */
    });
    stampClientIp(req);
    const token = randomUUID();
    req.headers[UPGRADE_TOKEN_HEADER] = token;
    const entry: PendingUpgrade = { req, socket, head, handled: false };
    pending.set(token, entry);

    void (async () => {
      try {
        const request = upgradeRequestToFetchRequest(req);
        const response = await app.fetch(request);
        if (!entry.handled) await writeSocketResponse(socket, response);
      } catch {
        if (!entry.handled && !socket.destroyed) socket.destroy();
      } finally {
        pending.delete(token);
      }
    })();
  });

  await new Promise<void>((res) => httpServer.listen(port, host, res));
  const actualPort = (httpServer.address() as AddressInfo).port;

  return {
    port: actualPort,
    host,
    dataDir,
    close: async () => {
      scheduler.stopAll();
      wss.close();
      await new Promise<void>((res, reject) => {
        httpServer.close((err) => (err ? reject(err) : res()));
      });
      accounts.sqlite.close();
      streamsSqlite.close();
    },
  };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  startNodeServer()
    .then((handle) => {
      // Security of logs (Global Constraints): no request bodies, no usernames — a bare
      // host:port boot line only.
      console.log(`herokeep node adapter listening on http://${handle.host}:${handle.port} (data: ${handle.dataDir})`);
    })
    .catch((err: unknown) => {
      console.error('herokeep node adapter failed to start', err);
      process.exitCode = 1;
    });
}
