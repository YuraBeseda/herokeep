/**
 * `Connections` over `ws` (ADR-014's Node `Connections` row: "`ws` server; in-memory socket set
 * per actor"). One instance is scoped to exactly one stream's actor (`stream-host.ts` constructs
 * one per `streamId`, mirroring `SqliteFileStreamStore`'s own one-per-stream scoping) — `all()`/
 * `byTag()` only ever enumerate THIS stream's sockets, never another stream's.
 *
 * Attachments live in a `Map<WebSocket, Attachment>`, not a `WeakMap` (task-7-brief mentions
 * either): `byTag` needs to enumerate every registered socket's attachment to filter by tag, which
 * a `WeakMap` cannot do (it has no iteration). A `Map` risks leaking an attachment if a socket is
 * forgotten without `close()` ever being called, so `accept()` also wires a `'close'` listener that
 * unregisters the socket from every collection here — the actual lifecycle guarantee this class
 * leans on instead of `WeakMap`'s automatic GC.
 */
import type { WebSocket } from 'ws';
import type { ServerMessage } from '@hk/protocol';
import type { Conn, Connections } from '../../ports/connections.ts';

/** The subset of `ConnAttachment` (`core/streams/stream-actor.ts`) this class needs to implement
 * `byTag` — kept as a narrow structural type (not importing `ConnAttachment` itself) so this file
 * has no core-boundary-relevant import beyond the port, even though in practice the Node adapter
 * always instantiates this with `ConnAttachment`. */
export interface Taggable {
  readonly userId: string;
}

export class WsConnections<Attachment extends Taggable> implements Connections<Attachment> {
  private readonly sockets = new Set<WebSocket>();
  private readonly attachments = new Map<WebSocket, Attachment>();

  accept(ws: unknown, attachment: Attachment): Conn {
    const socket = ws as WebSocket;
    this.sockets.add(socket);
    this.attachments.set(socket, attachment);
    // Lifecycle guarantee (see class doc comment): a socket that closes for ANY reason (client
    // disconnect, network drop, an explicit `close()` call below) removes itself from every
    // collection exactly once, so `all()`/`byTag()` never return a dead connection.
    socket.on('close', () => {
      this.sockets.delete(socket);
      this.attachments.delete(socket);
    });
    // Whole-branch review finding 1: `ws`'s own `maxPayload` enforcement (`server.ts`'s
    // `WebSocketServer({ maxPayload: WS_MESSAGE_BYTES_MAX })`) emits an `'error'` event on the
    // socket the moment an oversized frame arrives, immediately before it closes the connection
    // itself with code 1009 — Node's `EventEmitter` throws an UNCAUGHT exception for any `'error'`
    // event with no registered listener, which would crash the WHOLE process (every other live
    // connection along with it), exactly the "no server crash" requirement this finding exists to
    // guarantee. `'close'` above already does every bit of cleanup this class needs; this listener
    // exists purely to make the built-in "an 'error' event throws if unhandled" behavior a no-op.
    socket.on('error', () => {
      /* swallow — ws already closes the socket itself for every case that fires this (oversized
       * frame, protocol violation, abrupt network failure); nothing further to do here. */
    });
    return socket;
  }

  all(): Conn[] {
    return [...this.sockets];
  }

  byTag(tag: string): Conn[] {
    return this.all().filter((conn) => this.attachments.get(conn as WebSocket)?.userId === tag);
  }

  send(conn: Conn, frame: ServerMessage): void {
    const socket = conn as WebSocket;
    // `ws`'s `OPEN` value is `1` on both the instance and the constructor; comparing against the
    // instance's own `readyState` avoids importing the `WebSocket` class as a value just for its
    // `OPEN` constant.
    if (socket.readyState === 1) socket.send(JSON.stringify(frame));
  }

  /** [plan-9 Task 7 — minimal port-compliance send, not the full binary-frame WIRING] `ws`'s
   * `.send()` auto-detects binary vs. text by argument type (a `Uint8Array` sends a binary WS
   * frame with no further options needed), so this is otherwise identical to `send` above. Reading
   * incoming binary frames off the socket and routing them to `StreamActor.handleBinaryMessage`
   * (`core/streams/stream-actor.ts`) is Task 8's job — this adapter has no `'message'` binary
   * branch yet (`server.ts`'s own Phase-2-scope comment). */
  sendBinary(conn: Conn, bytes: Uint8Array): void {
    const socket = conn as WebSocket;
    if (socket.readyState === 1) socket.send(bytes);
  }

  close(conn: Conn, code: number, reason: string): void {
    (conn as WebSocket).close(code, reason);
  }

  getAttachment(conn: Conn): Attachment {
    const attachment = this.attachments.get(conn as WebSocket);
    if (!attachment) throw new Error('ws connection has no attachment');
    return attachment;
  }

  setAttachment(conn: Conn, attachment: Attachment): void {
    this.attachments.set(conn as WebSocket, attachment);
  }
}
