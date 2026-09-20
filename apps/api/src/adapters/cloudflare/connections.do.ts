/**
 * `Connections` over the WebSocket Hibernation API (ADR-014's Cloudflare `Connections` row;
 * task-8-brief obligation (d)): `acceptWebSocket`/`getWebSockets` for accept/enumerate,
 * `serializeAttachment`/`deserializeAttachment` for per-connection state that survives the DO
 * being evicted from memory between messages (doc-10 §Connections: "Hibernation API ... attachments
 * survive eviction").
 *
 * Unlike Node's `WsConnections` (`adapters/node/connections.ws.ts`), this class keeps NO
 * `Map<WebSocket, Attachment>` of its own: the Hibernation API already persists each attachment
 * ON the socket itself (`serializeAttachment`), and `ctx.getWebSockets()` already excludes closed
 * sockets automatically — there is no separate bookkeeping to leak/prune on close the way Node's
 * plain in-memory `Set`/`Map` needs (`WsConnections`'s header comment explains that lifecycle
 * guarantee, which this class gets for free from the platform instead).
 *
 * `byTag` is implemented with the Hibernation API's OWN tag mechanism (`acceptWebSocket(ws,
 * tags)` / `getWebSockets(tag)`) rather than by deserializing every attachment and filtering in
 * JS: `accept()` tags the socket with `attachment.userId` at accept time (mirroring `ConnAttachment`
 * field this port's callers already tag by, per `stream-actor.ts`'s `ConnAttachment` doc comment
 * and Node's `WsConnections.byTag`), so `getWebSockets(tag)` does the filtering natively.
 */
import type { WebSocket } from '@cloudflare/workers-types';
import type { ServerMessage } from '@hk/protocol';
import type { Conn, Connections } from '../../ports/connections.ts';

/** Same narrow structural requirement as Node's `WsConnections<Attachment extends Taggable>` —
 * `byTag`'s tagging needs `userId`; kept as an interface (not importing `ConnAttachment` itself)
 * so this file has no core-boundary-relevant import beyond the port. */
export interface Taggable {
  readonly userId: string;
}

/** The subset of `DurableObjectState` this class needs — typed narrowly (not the full
 * `DurableObjectState`) so a test can satisfy it with a minimal fake DO state object without
 * constructing every other DO capability (alarms, blockConcurrencyWhile, storage, …). */
export interface HibernationHost {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}

const WS_READY_STATE_OPEN = 1;

export class HibernatingConnections<Attachment extends Taggable> implements Connections<Attachment> {
  private readonly host: HibernationHost;

  constructor(host: HibernationHost) {
    this.host = host;
  }

  accept(ws: unknown, attachment: Attachment): Conn {
    const socket = ws as WebSocket;
    this.host.acceptWebSocket(socket, [attachment.userId]);
    socket.serializeAttachment(attachment);
    return socket;
  }

  all(): Conn[] {
    return this.host.getWebSockets();
  }

  byTag(tag: string): Conn[] {
    return this.host.getWebSockets(tag);
  }

  send(conn: Conn, frame: ServerMessage): void {
    const socket = conn as WebSocket;
    if (socket.readyState === WS_READY_STATE_OPEN) socket.send(JSON.stringify(frame));
  }

  /** [plan-9 Task 7 — minimal port-compliance send, not the full binary-frame WIRING] The
   * Hibernation API's `WebSocket.send()` accepts an `ArrayBuffer`/`ArrayBufferView` and sends a
   * binary WS frame automatically, same as `send` above for JSON text frames. The `webSocketMessage`
   * DO handler routing an incoming binary frame to `StreamActor.handleBinaryMessage` (`core/streams/
   * stream-actor.ts`) is Task 8's job — not built yet. */
  sendBinary(conn: Conn, bytes: Uint8Array): void {
    const socket = conn as WebSocket;
    if (socket.readyState === WS_READY_STATE_OPEN) socket.send(bytes);
  }

  close(conn: Conn, code: number, reason: string): void {
    (conn as WebSocket).close(code, reason);
  }

  getAttachment(conn: Conn): Attachment {
    const attachment = (conn as WebSocket).deserializeAttachment() as Attachment | null;
    if (!attachment) throw new Error('Durable Object WebSocket has no serialized attachment');
    return attachment;
  }

  setAttachment(conn: Conn, attachment: Attachment): void {
    (conn as WebSocket).serializeAttachment(attachment);
  }
}
