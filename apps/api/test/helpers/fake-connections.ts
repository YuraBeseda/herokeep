/**
 * In-memory `Connections` double for Task 5's stream-actor tests. `Conn` is opaque to core code
 * (ports/connections.ts) — here it's just an object identity — so `send` records every frame a
 * test connection received, letting tests assert fan-out/ack/reject/welcome/events/notice frames
 * without a real socket.
 */
import type { ServerMessage } from '@hk/protocol';
import type { Conn, Connections } from '../../src/ports/connections.ts';

export interface TestAttachment {
  readonly userId: string;
  readonly role: 'owner' | 'dm' | 'member';
  readonly subs: string[];
  /** [fix round 1] Mirrors `ConnAttachment.displayName` (`core/streams/stream-actor.ts`) — a test
   * can construct one directly to exercise `CampaignActor.buildPresenceMembers`'s live-attachment
   * preference without going through a real adapter's WS handoff. */
  readonly displayName?: string;
}

/** A distinguishable, opaque connection handle — labeled for readable test failures only.
 * Parameter-property shorthand (`constructor(readonly label: string)`) is unavailable under the
 * repo's `erasableSyntaxOnly` tsconfig, hence the explicit field + assignment. */
export class FakeConn {
  readonly label: string;
  constructor(label: string) {
    this.label = label;
  }
}

export class FakeConnections implements Connections<TestAttachment> {
  private readonly registered = new Set<Conn>();
  private readonly attachments = new Map<Conn, TestAttachment>();
  private readonly frames = new Map<Conn, ServerMessage[]>();
  private readonly binaryFrames = new Map<Conn, Uint8Array[]>();
  private readonly closed = new Set<Conn>();
  private readonly closeArgs = new Map<Conn, { code: number; reason: string }>();

  accept(_ws: unknown, attachment: TestAttachment): Conn {
    const conn = new FakeConn(attachment.userId);
    this.registered.add(conn);
    this.attachments.set(conn, attachment);
    this.frames.set(conn, []);
    this.binaryFrames.set(conn, []);
    return conn;
  }

  all(): Conn[] {
    return [...this.registered];
  }

  byTag(tag: string): Conn[] {
    return this.all().filter((c) => this.attachments.get(c)?.userId === tag);
  }

  send(conn: Conn, frame: ServerMessage): void {
    this.frames.get(conn)?.push(frame);
  }

  /** [plan-9 Task 7] Records raw binary frames sent to `conn` (`blob.chunk` relaying), the same
   * way `send` records JSON `ServerMessage` frames — `binaryFramesFor` below is its inspection
   * counterpart. */
  sendBinary(conn: Conn, bytes: Uint8Array): void {
    this.binaryFrames.get(conn)?.push(bytes);
  }

  close(conn: Conn, code: number, reason: string): void {
    this.registered.delete(conn);
    this.closed.add(conn);
    this.closeArgs.set(conn, { code, reason });
  }

  getAttachment(conn: Conn): TestAttachment {
    const attachment = this.attachments.get(conn);
    if (!attachment) throw new Error('fake connection has no attachment');
    return attachment;
  }

  setAttachment(conn: Conn, attachment: TestAttachment): void {
    this.attachments.set(conn, attachment);
  }

  /** Test-only inspection: every frame sent to `conn`, in send order. */
  framesFor(conn: Conn): ServerMessage[] {
    return this.frames.get(conn) ?? [];
  }

  /** Test-only inspection: every raw binary frame sent to `conn`, in send order. */
  binaryFramesFor(conn: Conn): Uint8Array[] {
    return this.binaryFrames.get(conn) ?? [];
  }

  /** Test-only inspection: whether `close()` was called for `conn`. */
  wasClosed(conn: Conn): boolean {
    return this.closed.has(conn);
  }

  /** Test-only inspection: the `(code, reason)` a `close()` call for `conn` was made with (the
   * LAST call, if made more than once) — `undefined` if `close()` was never called for it. */
  closeArgsFor(conn: Conn): { code: number; reason: string } | undefined {
    return this.closeArgs.get(conn);
  }
}
