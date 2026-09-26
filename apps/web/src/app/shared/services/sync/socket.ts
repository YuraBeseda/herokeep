import {
  WS_MESSAGE_BYTES_MAX,
  type ClientMessage,
  type ServerMessage,
  parseServerMessage,
} from '@hk/protocol';

/**
 * `SyncSocket` — a thin, testable wrapper over the browser's native `WebSocket` for
 * `/api/characters/:id/ws` / `/api/campaigns/:id/ws` (docs/02-architecture/03-sync-protocol.md
 * §Connection lifecycle; plan-10 Task 1 widened this from characters-only to both stream kinds —
 * see `wsUrlForStream` below). It owns exactly ONE connection's send/receive framing (JSON-encode
 * outgoing `ClientMessage`s, parse+validate incoming `ServerMessage`s; raw-byte send/receive for
 * binary `blob.chunk` frames) and nothing else — no reconnect logic, no backoff, no multi-stream
 * bookkeeping. That's `StreamSyncSession`'s job (Task 8), which owns a `Backoff` and decides when
 * to construct a fresh `SyncSocket`.
 */

// `WS_MESSAGE_BYTES_MAX` (the doc-08 §Quotas 128 KB WS-frame cap) now comes from `@hk/protocol`'s
// sync module (plan-10 Task 1 hoist) — this used to be a local `const` here, duplicated verbatim
// in `apps/api/src/core/validate.ts` (flagged as a follow-up in plan-8's task-7-report.md). Both
// apps import the one constant now; every OTHER consumer of this number (`stream-sync-session.ts`
// included) imports it from `@hk/protocol` directly rather than re-exporting it through here.

/** Thrown by `send()` when the JSON-encoded message would exceed `WS_MESSAGE_BYTES_MAX`. The
 * caller (`StreamSyncSession`) is responsible for chunking (doc-03: `append`/`hello.pending`
 * batches split at ≤50 events AND ≤128 KB) — `SyncSocket` never silently truncates or drops. */
export class SyncSocketOversizeError extends Error {
  constructor(readonly byteLength: number) {
    super(
      `Sync message is ${byteLength} bytes, exceeding the ${WS_MESSAGE_BYTES_MAX}-byte WS frame cap`,
    );
    this.name = 'SyncSocketOversizeError';
  }
}

/** Minimal surface of the browser's native `WebSocket` that `SyncSocket` actually uses — narrow
 * enough that a spec's fake doesn't need to implement the full DOM `WebSocket` interface
 * (`readyState` constants, `bufferedAmount`, `extensions`, `protocol`,
 * `addEventListener`/`removeEventListener`, …). `binaryType` IS part of this narrow surface (not
 * omitted like the others above) — `SyncSocket`'s constructor sets it to `'arraybuffer'` so an
 * incoming binary frame's `event.data` is an `ArrayBuffer` it can read synchronously, never a
 * `Blob` (the DOM default), which would need an async read before `onBinaryFrame` could fire. The
 * real global `WebSocket` structurally satisfies this (see `WebSocketFactory`'s default below). */
export interface WebSocketLike {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  binaryType?: 'blob' | 'arraybuffer';
}

export type WebSocketFactory = new (url: string) => WebSocketLike;

export interface SyncSocketOptions {
  /** Absolute `ws://`/`wss://` url — build it with `wsUrlForStream()` (or the character-only
   * `wsUrl()` convenience wrapper) below. */
  url: string;
  /** Constructor-injectable so specs use fakes; defaults to the global `WebSocket`. */
  webSocketFactory?: WebSocketFactory;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (event: unknown) => void;
  /** A TEXT frame that parsed and validated as a `ServerMessage`. Never fires for a binary frame
   * — see `onBinaryFrame` below. */
  onMessage?: (message: ServerMessage) => void;
  /** A frame that failed to parse as JSON or didn't match `ServerMessageSchema`. The socket is
   * already closed by the time this fires — the caller (session) re-syncs via a fresh `hello`. */
  onProtocolError?: (reason: string) => void;
  /** A BINARY frame (`blob.chunk` — docs/02-architecture/03-sync-protocol.md's frame header:
   * "binary frames carry blob chunks"), delivered as a `Uint8Array` view over the raw bytes,
   * WITHOUT any JSON-parse attempt — `ServerMessageSchema` has no entry for binary frames, so
   * `handleMessage` routes anything that arrives as an `ArrayBuffer`/`ArrayBufferView` straight
   * here instead of down the text-frame path. Left `undefined`, a binary frame is silently
   * dropped (mirrors this class's own pre-plan-10 fallback for any non-string frame) — the blob
   * codec that actually interprets these bytes is Task 13's job, not this transport class's. */
  onBinaryFrame?: (bytes: Uint8Array) => void;
}

/** Close code used when this socket rejects a server frame it can't make sense of — 1002 is the
 * standard WebSocket "protocol error" close code (RFC 6455 §7.4.1). */
const PROTOCOL_ERROR_CLOSE_CODE = 1002;

export class SyncSocket {
  private readonly ws: WebSocketLike;

  constructor(private readonly options: SyncSocketOptions) {
    const Factory =
      options.webSocketFactory ?? (globalThis.WebSocket as unknown as WebSocketFactory);
    this.ws = new Factory(options.url);
    // See `WebSocketLike`'s own doc comment: without this, a real browser socket's default
    // `binaryType` ('blob') would hand `handleMessage` a `Blob` for every binary frame, which
    // needs an async `.arrayBuffer()` read this synchronous handler doesn't do.
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => this.options.onOpen?.();
    this.ws.onclose = (event) => this.options.onClose?.(event.code, event.reason);
    this.ws.onerror = (event) => this.options.onError?.(event);
    this.ws.onmessage = (event) => this.handleMessage(event.data);
  }

  /** JSON-encodes `message` and writes it to the socket. Throws `SyncSocketOversizeError`
   * (without sending anything) when the encoded frame exceeds `WS_MESSAGE_BYTES_MAX` — the
   * caller must chunk and retry, never call this expecting silent truncation. */
  send(message: ClientMessage): void {
    const encoded = JSON.stringify(message);
    const byteLength = new TextEncoder().encode(encoded).length;
    if (byteLength > WS_MESSAGE_BYTES_MAX) {
      throw new SyncSocketOversizeError(byteLength);
    }
    this.ws.send(encoded);
  }

  /** Writes raw bytes straight to the socket as a BINARY frame (`blob.chunk`) — no JSON envelope,
   * no `ClientMessageSchema` involved. Guarded by the SAME `WS_MESSAGE_BYTES_MAX` oversize check
   * as `send()`: the cap is a WS-FRAME limit (doc-08 §Quotas "WS message" row), not a JSON-only
   * one, so it applies identically to a binary frame's raw byte length. Throws
   * `SyncSocketOversizeError` (without sending anything) when `bytes.byteLength` exceeds the cap —
   * the caller (a future blob-transfer task) is responsible for chunking, same never-silently-
   * truncate contract as `send()`. */
  sendBinary(bytes: Uint8Array): void {
    if (bytes.byteLength > WS_MESSAGE_BYTES_MAX) {
      throw new SyncSocketOversizeError(bytes.byteLength);
    }
    this.ws.send(bytes);
  }

  close(): void {
    this.ws.close();
  }

  /** Binary frames (`ArrayBuffer`/`ArrayBufferView` — the shape a real socket's `event.data` takes
   * once `binaryType` is `'arraybuffer'`, per the constructor above) are routed straight to
   * `onBinaryFrame` as a `Uint8Array`, WITHOUT any JSON-parse attempt — `ServerMessageSchema` has
   * no entry for them (docs/02-architecture/03-sync-protocol.md's frame header: "text frames
   * carry JSON messages ... binary frames carry blob chunks"). Everything else non-string
   * (anything that isn't text and isn't recognizably binary either — e.g. a stray `Blob`, if some
   * future environment ever hands one to this handler despite `binaryType`) is silently ignored
   * rather than treated as a protocol error, so a future blob-sync task can extend this without
   * this class needing to change again. */
  private handleMessage(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      this.options.onBinaryFrame?.(new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      const view = data;
      this.options.onBinaryFrame?.(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return;
    }
    if (typeof data !== 'string') {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.protocolFail('Received a non-JSON text frame');
      return;
    }

    const result = parseServerMessage(parsed);
    if (!result.ok) {
      const reason = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
      this.protocolFail(`Received a frame that failed ServerMessage validation: ${reason}`);
      return;
    }

    this.options.onMessage?.(result.message);
  }

  private protocolFail(reason: string): void {
    this.ws.close(PROTOCOL_ERROR_CLOSE_CODE, 'protocol-error');
    this.options.onProtocolError?.(reason);
  }
}

/** Maps a stream id's prefix to its REST-ish WS path segment (`wsUrlForStream`'s lookup table).
 * `char:` → character streams (`apps/api/src/core/routes/characters.ts`'s `GET /:id/ws`); `camp:`
 * → campaign streams (`apps/api/src/core/routes/campaigns.ts`'s equivalent, plan-9's server-side
 * counterpart to this task's client plumbing). Both routes derive their own `char:${id}` /
 * `camp:${id}` protocol stream id server-side from the bare `:id` path segment — this table is
 * this function's OWN client-side mirror of that same id ↔ path convention. */
const STREAM_KIND_PATHS: ReadonlyMap<string, string> = new Map([
  ['char:', '/api/characters/'],
  ['camp:', '/api/campaigns/'],
]);

/**
 * Builds the absolute `ws://`/`wss://` url for a sync socket from a FULL, prefixed stream id
 * (`char:<uuid>` or `camp:<uuid>` — plan-10 Task 1 widening: `wsUrl` below was the character-only
 * predecessor, now a thin `char:`-prefixing convenience wrapper around this). Throws for any
 * other prefix — `SyncSocket`/`StreamSyncSession` never construct a URL for a stream kind the
 * server doesn't have a route for.
 *
 * `loc` defaults to `window.location` and only reads `protocol`/`host`, so a spec can pass a
 * plain `{protocol, host}` object instead of a real `Location`. `https:` maps to `wss:`; anything
 * else (`http:` in dev) maps to `ws:`.
 */
export function wsUrlForStream(
  streamId: string,
  loc: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [prefix, path] of STREAM_KIND_PATHS) {
    if (streamId.startsWith(prefix)) {
      const id = streamId.slice(prefix.length);
      return `${scheme}//${loc.host}${path}${id}/ws`;
    }
  }
  throw new Error(
    `wsUrlForStream: unrecognized stream id "${streamId}" (expected a "char:" or "camp:" prefix)`,
  );
}

/**
 * Character-only convenience wrapper around `wsUrlForStream`, taking the plain
 * (non-`char:`-prefixed) character UUID — the same `:id` the route takes. Kept for every existing
 * caller that already has a bare character UUID rather than the full `char:<uuid>` stream id
 * (`SyncService`'s reconcile/upload/restore paths, specs, …) — migrating them all to spell
 * `wsUrlForStream(\`char:${id}\`)` themselves would buy nothing.
 */
export function wsUrl(
  characterId: string,
  loc: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  return wsUrlForStream(`char:${characterId}`, loc);
}
