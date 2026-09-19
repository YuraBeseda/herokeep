import type { ServerMessage } from '@hk/protocol';

/**
 * Opaque per-adapter connection handle (a raw `ws.WebSocket` on Node, a tagged pair from the
 * Cloudflare Hibernation API's `acceptWebSocket`/`getWebSockets` on Workers — ADR-014's
 * `Connections` row). Core code never inspects a `Conn`'s shape; it only ever passes one back
 * into the `Connections` port that produced it.
 */
export type Conn = unknown;

/**
 * Accept/enumerate/tag/send/close for a stream's sockets, with adapter-attached per-connection
 * state (`Attachment` — typically `{userId, role}` stamped at WS handoff time, doc-10 §Request
 * routing). Cloudflare backs this with the Hibernation API (attachments survive eviction); Node
 * backs it with an in-memory `ws.WebSocketServer` + a `Map<Conn, Attachment>`.
 */
export interface Connections<Attachment = unknown> {
  /** Registers a newly-upgraded raw socket with this stream's connection set. */
  accept(ws: unknown, attachment: Attachment): Conn;
  /** Every connection currently registered. */
  all(): Conn[];
  /** Connections registered under `tag` (adapter-defined tagging, e.g. by user id). */
  byTag(tag: string): Conn[];
  /** Sends one server→client protocol frame to `conn`. */
  send(conn: Conn, frame: ServerMessage): void;
  /** Closes `conn` with a WebSocket close code and a human-readable reason. */
  close(conn: Conn, code: number, reason: string): void;
  /** Reads the attachment previously set for `conn` (via `accept` or `setAttachment`). */
  getAttachment(conn: Conn): Attachment;
  /** Replaces the attachment for `conn` (e.g. updating subscriptions after `subscribe`). */
  setAttachment(conn: Conn, attachment: Attachment): void;
}
