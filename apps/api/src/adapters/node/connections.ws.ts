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
