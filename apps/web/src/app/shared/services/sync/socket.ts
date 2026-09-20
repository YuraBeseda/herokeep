import { type ClientMessage, type ServerMessage, parseServerMessage } from '@hk/protocol';

/**
 * `SyncSocket` — a thin, testable wrapper over the browser's native `WebSocket` for
 * `/api/characters/:id/ws` (docs/02-architecture/03-sync-protocol.md §Connection lifecycle). It
 * owns exactly ONE connection's send/receive framing (JSON-encode outgoing `ClientMessage`s,
 * parse+validate incoming `ServerMessage`s) and nothing else — no reconnect logic, no backoff, no
 * multi-stream bookkeeping. That's `StreamSyncSession`'s job (Task 8), which owns a `Backoff` and
 * decides when to construct a fresh `SyncSocket`.
 */

/**
 * The 128 KB WS-frame cap (doc-03 / plan-8 §Global Constraints: "WS messages ≤ 128 KB"). This is
 * the SAME number as `apps/api/src/core/validate.ts`'s `WS_MESSAGE_BYTES_MAX`, which the server
 * enforces on receipt (Node's `ws` `maxPayload`, Cloudflare's manual byte-length check in
 * `character-stream.do.ts`). It is necessarily duplicated here: `apps/api` is not importable from
 * `apps/web` (separate deployable apps, no shared runtime dependency), and `@hk/protocol` — which
 * both DO import — would be the natural shared home for this constant, but doesn't currently
 * define it. Flagged in task-7-report.md as a possible tiny follow-up (move it to
 * `@hk/protocol`'s sync module so both sides read one source of truth); out of scope here since
 * it would touch the already-shipped `apps/api` call sites for no behavior change.
 */
export const WS_MESSAGE_BYTES_MAX = 128 * 1024;

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
 * (`readyState` constants, `binaryType`, `bufferedAmount`, `extensions`, `protocol`,
 * `addEventListener`/`removeEventListener`, …). The real global `WebSocket` structurally
 * satisfies this (see `WebSocketFactory`'s default below). */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type WebSocketFactory = new (url: string) => WebSocketLike;

export interface SyncSocketOptions {
  /** Absolute `ws://`/`wss://` url — build it with `wsUrl()` below. */
  url: string;
  /** Constructor-injectable so specs use fakes; defaults to the global `WebSocket`. */
  webSocketFactory?: WebSocketFactory;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (event: unknown) => void;
  /** A frame that parsed and validated as a `ServerMessage`. */
  onMessage?: (message: ServerMessage) => void;
  /** A frame that failed to parse as JSON or didn't match `ServerMessageSchema`. The socket is
   * already closed by the time this fires — the caller (session) re-syncs via a fresh `hello`. */
  onProtocolError?: (reason: string) => void;
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

  close(): void {
    this.ws.close();
  }

  /** Text frames only. Binary frames (`blob.chunk`) carry raw blob bytes, not a `ServerMessage` —
   * `ServerMessageSchema` has no entry for them (docs/02-architecture/03-sync-protocol.md's frame
   * header: "text frames carry JSON messages ... binary frames carry blob chunks"). Blob transfer
   * is out of this task's scope; a non-string frame is silently ignored here rather than treated
   * as a protocol error, so a future blob-sync task can add its own handling without this class
   * needing to change. */
  private handleMessage(data: unknown): void {
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

/**
 * Builds the absolute `ws://`/`wss://` url for a character's sync socket from the plain
 * (non-`char:`-prefixed) character UUID — the same `:id` the route takes
 * (`apps/api/src/core/routes/characters.ts`'s `GET /:id/ws`, which itself derives the protocol
 * stream id `char:${id}` server-side). Callers that already have the `char:<uuid>` stream id
 * (e.g. from a `StreamRef`) must strip the `char:` prefix before calling this — `SyncSocket`
 * itself is transport-only and doesn't know about stream-id shapes.
 *
 * `loc` defaults to `window.location` and only reads `protocol`/`host`, so a spec can pass a
 * plain `{protocol, host}` object instead of a real `Location`. `https:` maps to `wss:`; anything
 * else (`http:` in dev) maps to `ws:`.
 */
export function wsUrl(
  characterId: string,
  loc: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}/api/characters/${characterId}/ws`;
}
