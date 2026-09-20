/**
 * `StreamActor` — the append pipeline and catch-up (doc-10 §StreamActor (base);
 * docs/02-architecture/03-sync-protocol.md, read in full for this task). "The only place
 * stream semantics live" (doc-10 §Runtime ports): one instance is scoped to exactly one stream
 * (`streamId`), backed by one `StreamStore` and one `Connections` set — matching
 * `StreamStore`'s own doc comment ("scoped to a single stream"). `CharacterActor` (Task 6) and,
 * later, `CampaignActor` (Phase 3) wrap/extend this.
 *
 * Deviation from the task brief's literal signature, called out per the brief's own "(shape per
 * brief; refine cleanly)" allowance: the brief sketches `append(events, actor): AppendResult`,
 * reusing the STORE-level `AppendResult` (`{firstSeq, lastSeq}`, ports/stream.ts). That shape
 * cannot express doc-03's actual `append` semantics — a single append can produce a MIX of
 * newly-committed events (new seqs), idempotently-deduped events (existing seqs), and per-event
 * rejections (doc-03's `ack`/`reject` are separate frames, each carrying a `results[]` array
 * keyed by event id) — so this file defines a distinct `AppendOutcome` (`{acked, rejected}`)
 * instead of overloading the store's simpler contract.
 */
import {
  type Actor,
  type AppendMsg,
  type Event,
  type EventsMsg,
  type HelloMsg,
  type NoticeMsg,
  type RejectCode,
  parseClientMessage,
} from '@hk/protocol';
import type { Conn, Connections } from '../../ports/connections.ts';
import type { StreamStore } from '../../ports/stream.ts';
import type * as permissionsModule from '../permissions.ts';
import * as quotasModule from '../quotas.ts';
import { measureEventBytes, validateEvent } from '../validate.ts';

/** doc-03 §Catch-up performance: "the DO pages 200 events per frame". */
const CATCH_UP_PAGE_SIZE = 200;
/** Stream-meta key tracking whether the 80% notice has already fired for the CURRENT crossing
 * (doc-03 §Quota signalling: "at 80%" — read as "once per crossing", not "every append while
 * over 80%"; see `maybeNotifyQuotaWarning`'s comment). */
const QUOTA_WARNED_META_KEY = 'quota_warned_80';

/** The subset of `permissions.ts`'s exports `StreamActor` depends on — typed as an interface
 * (not `typeof import('../permissions.ts')`) so a test double can satisfy it without importing
 * the real module; the real module is passed in unmodified and satisfies this structurally. */
export interface PermissionsPort {
  allowed(eventType: string, role: permissionsModule.Role): boolean;
  canRevertOwn(actor: { userId: string; role: permissionsModule.Role }, target: Event | undefined): boolean;
}

/** The subset of `quotas.ts`'s exports `StreamActor` depends on — same rationale as
 * `PermissionsPort` above. */
export interface QuotasPort {
  quotaFor(meta: quotasModule.StreamMetaSnapshot): quotasModule.QuotaShape;
  checkAppend(meta: quotasModule.StreamMetaSnapshot, events: readonly Event[]): quotasModule.QuotaCheckResult;
}

/** Per-connection state stamped at WS handoff time (doc-03's lifecycle diagram: `DO->>DO:
 * acceptWebSocket(ws); attach {userId, role, subs: []}`). `role` is the sync-protocol role
 * (`owner | dm | member`) the Worker/adapter resolved from the session + membership check
 * BEFORE handing the socket to this actor — `StreamActor` trusts it exactly because nothing
 * upstream of this attachment trusts anything the CLIENT claims about its own identity (Global
 * Constraints: "Server stamps `actor` from the session — any client-sent actor field is
 * ignored/rejected"). */
export interface ConnAttachment {
  readonly userId: string;
  readonly role: permissionsModule.Role;
  readonly subs: string[];
}

export interface AckResult {
  readonly id: string;
  readonly seq: number;
}

export interface RejectResult {
  readonly id: string;
  readonly code: RejectCode;
  readonly message: string;
}

/** The full result of one `append(...)` call — doc-03's `ack`/`reject` frames' `results[]`,
 * pre-split by outcome so callers (`handleAppend`, `hello`'s pending flush) just forward each
 * array into its matching frame type. Every input event ends up in exactly one of the two. */
export interface AppendOutcome {
  readonly acked: AckResult[];
  readonly rejected: RejectResult[];
}

/** One event's outcome partway through the pipeline, before the final store write. Kept as a
 * discriminated union (rather than parallel arrays/an "outcome so far" flag on `Event`) so each
 * pipeline stage's job is exactly "look at every outcome, possibly replace some `rejected`s". */
type PipelineOutcome =
  | { readonly kind: 'new'; readonly event: Event }
  | { readonly kind: 'existing'; readonly id: string; readonly seq: number }
  | { readonly kind: 'rejected'; readonly id: string; readonly code: RejectCode; readonly message: string };

export interface StreamActorDeps {
  readonly store: StreamStore;
  readonly connections: Connections<ConnAttachment>;
  readonly quotas: QuotasPort;
  readonly permissions: PermissionsPort;
  /** The id of the single stream this actor instance owns (`char:<uuid>` / `camp:<uuid>`,
   * `@hk/protocol`'s `StreamIdSchema`) — not in the brief's literal constructor sketch, but
   * required: `hello`'s `welcome`/`events` frames and `append`'s fan-out `events` frame all
   * name the stream (doc-03's frame shapes), and a `StreamStore` instance alone doesn't carry
   * its own id (ports/stream.ts: the store is "scoped to a single stream" by construction, not
   * by a field on itself). */
  readonly streamId: string;
}

export class StreamActor {
  protected readonly store: StreamStore;
  protected readonly connections: Connections<ConnAttachment>;
  protected readonly quotas: QuotasPort;
  protected readonly permissions: PermissionsPort;
  protected readonly streamId: string;
  /** Whole-branch review finding 3: flips `true` the moment `deleteAll()` runs and never resets
   * — see that method's doc comment for the full race this guards and why it's IN-MEMORY actor
   * state rather than a durable meta key (durable storage is exactly what `deleteAll` wipes). */
  protected closed = false;

  constructor(deps: StreamActorDeps) {
    this.store = deps.store;
    this.connections = deps.connections;
    this.quotas = deps.quotas;
    this.permissions = deps.permissions;
    this.streamId = deps.streamId;
  }

  /**
   * Parses one raw client frame and dispatches it. Invalid-frame handling (documented here,
   * per the task brief's "invalid -> reject/close per your design, documented"): a frame that
   * fails `parseClientMessage` (bad JSON shape, unknown `t`, wrong field types — see
   * `packages/protocol/test/sync.test.ts` for what that schema rejects) carries no `rid` doc-03
   * defines a response frame for, so there is nothing to `reject` against. Rather than silently
   * dropping it (leaving a well-behaved client's `await` hanging forever) or guessing at a
   * `rid`, the connection is closed with WS close code 1008 ("policy violation") and a plain
   * reason string — a misbehaving/stale client finds out immediately and reconnects with
   * `hello`, which is always safe (idempotent catch-up).
   */
  async handleMessage(conn: Conn, raw: unknown): Promise<void> {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.connections.close(conn, 1008, 'invalid message');
      return;
    }
    const msg = parsed.message;
    const attachment = this.connections.getAttachment(conn);
    const actor: Actor = { userId: attachment.userId, role: attachment.role };

    switch (msg.t) {
      case 'hello':
        await this.hello(conn, msg);
        return;
      case 'append':
        await this.handleAppend(conn, msg, actor);
        return;
      case 'subscribe':
      case 'unsubscribe':
      case 'blob.have':
      case 'blob.request':
      case 'blob.cancel':
      case 'presence':
        // Phase 2 scope (plan's Global Constraints; doc-03): character streams only, owner-only
        // direct sockets. These message types are schema-defined for Phase 3 (a DM subscribing
        // to a member's sheet, blob relay, presence indicators on a shared campaign) but have
        // no meaning yet on a solo character stream. Ignored (no-op, no reply) rather than
        // rejected/closed: a well-behaved client may send `presence` heartbeats unconditionally
        // regardless of stream type, and disconnecting it over a harmless, schema-valid message
        // would be hostile. Each Phase-3 type is documented individually here per the plan's
        // "document each" instruction, rather than as one generic catch-all comment.
        return;
    }
  }

  private async handleAppend(conn: Conn, msg: AppendMsg, actor: Actor): Promise<void> {
    const outcome = await this.append(msg.events, actor, conn);
    if (outcome.acked.length > 0) this.connections.send(conn, { t: 'ack', rid: msg.rid, results: outcome.acked });
    if (outcome.rejected.length > 0)
      this.connections.send(conn, { t: 'reject', rid: msg.rid, results: outcome.rejected });
  }

  /**
   * The append pipeline (doc-10 §StreamActor + doc-03 §Ordering and commit rules, implemented
   * EXACTLY): per event — schema+size (`validateEvent`), `permissions.allowed`, dedupe by id —
   * then per-stream: txId groups commit contiguously or reject ALL, seq assignment, ONE store
   * transaction, `meta.bytes_used`/`event_count` update, fan-out to other connections. `actor`
   * is the SESSION-stamped actor (never the client's claimed one — see `stampActor`).
   * `sourceConn`, when given, is excluded from fan-out (the sender gets an `ack`/`reject`
   * instead of an echoed `events` frame) and is who a quota-warning `notice` is sent to; when
   * omitted (an append with no originating socket — not reachable in Phase 2, kept for a future
   * RPC-triggered append per doc-10 §CampaignActor), fan-out reaches every connection and the
   * notice broadcasts to all of them.
   *
   * Duplicate/dedupe resolution (documented per the task's controller ruling — see
   * task-5-report.md's behavior table for the full write-up):
   *   - A WHOLE-append retry (every id already committed) → every event acked with its existing
   *     seq; nothing new stored.
   *   - A MIXED append (some ids new, some already committed), with no `txId` involved → the
   *     known ones are acked with their existing seq, the new ones are committed normally.
   *   - A `txId` group that is FULLY already committed → treated as a whole-group retry (ack
   *     existing seqs for every member).
   *   - A `txId` group that is PARTIALLY already committed (some members exist, some don't) →
   *     data inconsistency (a txId group is supposed to commit atomically); the WHOLE group is
   *     rejected `invalid`, regardless of what already exists in storage (storage is not
   *     modified either way).
   *   - A `txId` group with any OTHER invalid member (failed schema/size/permission) → the
   *     WHOLE group is rejected: the failing member keeps its own reject code/message, every
   *     other member in the group is rejected `invalid` as a group casualty.
   *   - Reject code `duplicate` is reserved for the same event id appearing MORE THAN ONCE
   *     within a single append frame (a client bug, not a retry) — every occurrence of that id
   *     is rejected `duplicate` and none of them are stored.
   */
  async append(events: Event[], actor: Actor, sourceConn?: Conn): Promise<AppendOutcome> {
    if (events.length === 0) return { acked: [], rejected: [] };

    // Whole-branch review finding 3: once `deleteAll()` has run on THIS actor instance, every
    // event is refused `stream_closed` rather than committed — see `deleteAll`'s doc comment for
    // the resurrection race this closes (an append already queued behind the same single-writer
    // lock `deleteAll` itself went through, which would otherwise commit against a freshly-wiped-
    // empty store and silently re-create seq 1, resurrecting a "deleted" stream outside every
    // quota). Checked first, before any of stages 1-5 below ever run.
    if (this.closed) {
      return {
        acked: [],
        rejected: events.map((event) => ({
          id: event.id,
          code: 'stream_closed' as const,
          message: 'event.streamClosed: this stream has been deleted',
        })),
      };
    }

    // Stage 1: per-event schema/size/permission, plus same-frame duplicate-id detection.
    const idCounts = new Map<string, number>();
    for (const raw of events) idCounts.set(raw.id, (idCounts.get(raw.id) ?? 0) + 1);

    const stage1: PipelineOutcome[] = events.map((raw) => {
      if ((idCounts.get(raw.id) ?? 0) > 1) {
        return {
          kind: 'rejected',
          id: raw.id,
          code: 'duplicate',
          message: 'event.duplicateInFrame: id repeated within one append',
        };
      }
      const validated = validateEvent(raw);
      if (!validated.ok) return { kind: 'rejected', id: raw.id, code: 'invalid', message: validated.message };
      if (!this.permissions.allowed(validated.event.type, actor.role)) {
        return {
          kind: 'rejected',
          id: raw.id,
          code: 'forbidden',
          message: `event.forbidden: ${validated.event.type} is not permitted for role ${actor.role}`,
        };
      }
      // `actor.role` narrowed to 'owner' | 'dm' here: `permissions.allowed` only ever returns
      // true for those two roles (permissions.ts's early `member` return), so `stampActor`
      // never actually receives 'member' despite `Actor.role`'s wider static type.
      return { kind: 'new', event: this.stampActor(validated.event, actor) };
    });

    // Stage 2: cross-request dedupe (idempotent retries) — look up every still-pending id
    // against the store in ONE call.
    const pendingIds = stage1
      .filter((o): o is Extract<PipelineOutcome, { kind: 'new' }> => o.kind === 'new')
      .map((o) => o.event.id);
    const existingEvents = pendingIds.length > 0 ? await this.store.findByIds(pendingIds) : [];
    const existingById = new Map(existingEvents.map((e) => [e.id, e]));

    const stage2: PipelineOutcome[] = stage1.map((outcome) => {
      if (outcome.kind !== 'new') return outcome;
      const found = existingById.get(outcome.event.id);
      if (found?.seq !== undefined) return { kind: 'existing', id: outcome.event.id, seq: found.seq };
      return outcome;
    });

    // Stage 3: txId groups commit contiguously or reject ALL (single-stream only, doc-03
    // §Ordering) — see this method's doc comment for the exact resolution table.
    const stage3 = this.resolveTxGroups(events, stage2);

    // Stage 4: quota — project the events STILL 'new' after stages 1-3 against this stream's
    // current meta; a reject fails every remaining 'new' event with code `quota` (nothing
    // touches 'existing'/already-'rejected' events).
    //
    // Measured WITH a provisional `seq` stamped on, not the bare stamped-but-unstored event:
    // the number actually persisted later (Stage 5's `committed`, `meta.bytes_used`) includes a
    // `seq` field, and JSON-measuring an event without one systematically UNDERSTATES its stored
    // size by the `"seq":<n>,` field's bytes — enough, across many events, to let an append
    // through that the post-commit meta then reports as already over the line. `head + 1 + i` is
    // exactly the `seq` `store.append` will assign moments later: this actor holds the stream's
    // single-writer guarantee (ports/stream.ts's `StreamHost`/`StreamStore` docs), `stillNew`
    // becomes `toStore` unchanged whenever the verdict isn't `reject` (Stage 4 below only ever
    // turns 'new' into 'rejected', never reorders or drops for any other reason), so the
    // provisional and the real `seq` are identical whenever this projection's answer matters.
    const meta = await this.readMeta();
    const head = await this.store.head();
    const stillNew = stage3.filter((o): o is Extract<PipelineOutcome, { kind: 'new' }> => o.kind === 'new');
    const provisionallyStamped = stillNew.map((o, i) => ({ ...o.event, seq: head + 1 + i }));
    const quotaCheck = this.quotas.checkAppend(meta, provisionallyStamped);

    const stage4 =
      quotaCheck.verdict === 'reject' && stillNew.length > 0
        ? stage3.map((o): PipelineOutcome =>
            o.kind === 'new'
              ? {
                  kind: 'rejected',
                  id: o.event.id,
                  code: 'quota',
                  message: 'event.quota: character stream quota exceeded',
                }
              : o,
          )
        : stage3;

    // Stage 5: split into acked/rejected, store the survivors in ONE transaction, update meta,
    // fan out, and signal quota crossing.
    const acked: AckResult[] = [];
    const rejected: RejectResult[] = [];
    for (const outcome of stage4) {
      if (outcome.kind === 'existing') acked.push({ id: outcome.id, seq: outcome.seq });
      else if (outcome.kind === 'rejected')
        rejected.push({ id: outcome.id, code: outcome.code, message: outcome.message });
    }

    const toStore = stage4
      .filter((o): o is Extract<PipelineOutcome, { kind: 'new' }> => o.kind === 'new')
      .map((o) => o.event);
    if (toStore.length > 0) {
      const result = await this.store.append(toStore);
      const committed: Event[] = toStore.map((event, i) => ({ ...event, seq: result.firstSeq + i }));
      for (const event of committed) acked.push({ id: event.id, seq: event.seq ?? 0 });

      // Ground-truth measurement of what's actually stored (`committed`, WITH `seq`) — the same
      // shape Stage 4's `provisionallyStamped` projected above, so the meta this append leaves
      // behind and the quota verdict that was just decided from agree exactly, not by estimate.
      const addedBytes = committed.reduce((sum, event) => sum + measureEventBytes(event), 0);
      await this.writeMeta({ bytesUsed: meta.bytesUsed + addedBytes, eventCount: meta.eventCount + committed.length });

      this.fanOut(committed, sourceConn);

      if (quotaCheck.verdict === 'warning') {
        await this.maybeNotifyQuotaWarning(
          { bytesUsed: quotaCheck.bytesAfter, eventCount: quotaCheck.eventCountAfter },
          sourceConn,
        );
      } else if (quotaCheck.verdict === 'ok') {
        // Defensive reset: Phase 2 never frees stream quota (append-only, no deletes), so this
        // branch is unreachable today, but keeps the "once per crossing" flag correct once a
        // later phase frees space (archive/hard-delete) and the stream can re-cross 80% later.
        await this.clearQuotaWarning();
      }
    }

    return { acked, rejected };
  }

  /**
   * `hello`: subscription registration, `welcome` FIRST (doc-03's binding order — the sequence
   * diagram sends `welcome` before any `events` catch-up page, which is sent before any
   * `ack`/`reject` for `pending`), catch-up paging from `lastSeq+1` in ≤200-event `events`
   * frames in order, then pending events flushed through the SAME `append` path used by a live
   * `append` message.
   */
  async hello(conn: Conn, msg: HelloMsg): Promise<void> {
    const attachment = this.connections.getAttachment(conn);
    const actor: Actor = { userId: attachment.userId, role: attachment.role };

    // Subscription registration: a StreamActor instance is scoped to exactly one stream, so
    // "subscribing" is recording that this connection is attached to it (doc-03's lifecycle
    // diagram: `attach {userId, role, subs: []}`). Multi-stream subscribe/unsubscribe (a DM
    // opening a member's sheet on a shared campaign stream) is Phase 3 — `CampaignActor`
    // forwards `subscribe` via `Rpc`; a solo `CharacterActor` never receives it directly (see
    // `handleMessage`'s Phase-3 no-op branch).
    this.connections.setAttachment(conn, { ...attachment, subs: [this.streamId] });

    const head = await this.store.head();
    const meta = await this.readMeta();
    const quota = this.quotas.quotaFor(meta);

    this.connections.send(conn, {
      t: 'welcome',
      rid: msg.rid,
      serverTime: new Date().toISOString(),
      streams: [{ id: this.streamId, headSeq: head, quota }],
    });

    const ref = msg.streams.find((s) => s.id === this.streamId);
    let from = (ref?.lastSeq ?? 0) + 1;
    while (from <= head) {
      const page = await this.store.read(from, CATCH_UP_PAGE_SIZE);
      if (page.length === 0) break; // defensive: store/head disagreement should not spin forever
      this.connections.send(conn, { t: 'events', stream: this.streamId, events: page });
      from += page.length;
    }

    if (msg.pending.length > 0) {
      const outcome = await this.append(msg.pending, actor, conn);
      if (outcome.acked.length > 0) this.connections.send(conn, { t: 'ack', rid: msg.rid, results: outcome.acked });
      if (outcome.rejected.length > 0)
        this.connections.send(conn, { t: 'reject', rid: msg.rid, results: outcome.rejected });
    }
  }

  /**
   * Wipes ALL durable data for this stream (`StreamHandle.deleteAll`'s port contract,
   * `ports/stream.ts`) — whole-branch review finding 3 fix. Two things happen here that did NOT
   * happen before, both BEFORE/AS the actual store wipe:
   *
   *   1. Every connection currently on this stream is closed with WS code 1001 ("going away") and
   *      reason `'stream_closed'` — a connected owner socket otherwise stays open across the
   *      delete and can still send an `append` afterward, which would commit against a
   *      freshly-empty store and silently RESURRECT the "deleted" stream (new seq-1 events, no
   *      owning D1 row, unbounded storage outside every quota — exactly what hard delete exists
   *      to prevent). `Connections.all()`/`.close()` (`ports/connections.ts`) already give every
   *      adapter this surface; nothing adapter-specific is needed here.
   *   2. `this.closed` flips to `true` — `append()`'s own doc comment above explains the race
   *      this covers that closing sockets alone does NOT: an append call already past
   *      `Connections.close()`'s reach (queued behind this SAME actor instance's single-writer
   *      lock, e.g. `NodeStreamHost`'s per-actor `Mutex` or Cloudflare's own per-DO-instance
   *      message ordering) would otherwise still run to completion against the now-empty store.
   *      `closed` is scoped to THIS ACTOR INSTANCE (in-memory, not a durable meta key — durable
   *      storage is exactly what the wipe below erases) rather than surviving eviction/process
   *      restart: that's fine, because a NEW connection reaching a re-hydrated actor for this
   *      streamId after a real delete can never get this far in the first place — `DELETE
   *      /api/characters/:id` also removes the D1 index row (`core/routes/characters.ts`), and
   *      every WS-upgrade route re-checks D1 ownership before ever calling `StreamHost.get` again
   *      (`GET /:id/ws`'s `existing?.ownerId !== user.userId` check) — so the ONLY reachable case
   *      this instance-scoped flag needs to cover is the in-flight race against THIS SAME live
   *      actor, which it does.
   */
  async deleteAll(): Promise<void> {
    for (const conn of this.connections.all()) {
      this.connections.close(conn, 1001, 'stream_closed');
    }
    this.closed = true;
    await this.store.deleteAll();
  }

  /**
   * Groups `stage2` outcomes by the ORIGINAL raw events' `txId` and applies doc-03's
   * contiguous-or-reject-all rule, INCLUDING the partial-existence corruption case this task's
   * controller ruling adds (see `append`'s doc comment). Events without a `txId` are untouched
   * (a group of one, trivially never conflicts with anything).
   */
  private resolveTxGroups(events: Event[], stage2: PipelineOutcome[]): PipelineOutcome[] {
    const groupIndexes = new Map<string, number[]>();
    events.forEach((event, i) => {
      if (!event.txId) return;
      const list = groupIndexes.get(event.txId) ?? [];
      list.push(i);
      groupIndexes.set(event.txId, list);
    });

    const stage3 = [...stage2];
    for (const [txId, indexes] of groupIndexes) {
      const members = indexes.map((i) => stage3[i]).filter((o): o is PipelineOutcome => o !== undefined);
      const anyRejected = members.some((m) => m.kind === 'rejected');
      const anyExisting = members.some((m) => m.kind === 'existing');
      const anyNew = members.some((m) => m.kind === 'new');
      const partiallyExisting = anyExisting && anyNew;
      if (!anyRejected && !partiallyExisting) continue; // fully new (commit) or fully existing (ack) — leave as-is

      const reason = anyRejected
        ? `event.txGroupInvalid: another event in txId ${txId} was rejected`
        : `event.txGroupInvalid: txId ${txId} is partially committed (data inconsistency)`;
      for (const i of indexes) {
        const outcome = stage3[i];
        if (!outcome || outcome.kind === 'rejected') continue; // keep the original failure's own code/message
        const id = outcome.kind === 'existing' ? outcome.id : outcome.event.id;
        stage3[i] = { kind: 'rejected', id, code: 'invalid', message: reason };
      }
    }
    return stage3;
  }

  /** Server stamps `actor` from the session — never the client's embedded one (Global
   * Constraints: "any client-sent actor field is ignored/rejected"). `deviceId` is not a
   * security-sensitive/permission-relevant field (a client-chosen per-device label, not an
   * identity or role claim), so it's kept as sent; `userId`/`role` — the only two ADR-012
   * permission inputs — are always replaced. `seq` is stripped: a committed seq is assigned by
   * this actor, never accepted from a client (doc-03: "The DO assigns `seq` strictly
   * increasing"). */
  private stampActor(event: Event, actor: Actor): Event {
    // `actor.role as 'owner' | 'dm'` used to be a needed narrowing cast: `Actor.role` (this
    // package's sync-protocol Role, 'owner'|'dm'|'member') was wider than the protocol event
    // envelope's own `ActorRoleSchema` ('owner'|'dm'|'system' at the time). Plan-9 Task 1 widened
    // `ActorRoleSchema` to add 'member' (for campaign-stream events), so `Actor.role` is now
    // ALREADY assignable to `Event['actor']['role']` without narrowing — the cast became a
    // lint error (`no-unnecessary-type-assertion`) and is removed here. The call-site guarantee
    // above (only 'owner'/'dm' ever reach here on a character stream) is unchanged.
    const stamped: Event = {
      ...event,
      actor: { userId: actor.userId, deviceId: event.actor.deviceId, role: actor.role },
    };
    delete stamped.seq; // never accept a client-supplied seq (doc-03: the DO assigns it)
    return stamped;
  }

  /** Fan out newly committed `events` to every OTHER connection on this stream — the sender
   * gets an `ack`, not an echoed `events` frame (doc-10 §StreamActor: "fan out to connections
   * ... (not the sender)"). Read-visibility filtering hook (doc-10: "with read-visibility
   * filtering (DM notes, private rolls)") — pass-through in Phase 2: character streams carry no
   * DM-only event types, and there is no campaign/membership concept yet for a non-owner
   * connection to even be attached to this stream. `filterForConnection` is where Phase 3 plugs
   * in the real per-connection filter without changing `fanOut`'s shape. */
  private fanOut(events: Event[], sourceConn?: Conn): void {
    if (events.length === 0) return;
    for (const conn of this.connections.all()) {
      if (conn === sourceConn) continue;
      const visible = this.filterForConnection(events, conn);
      if (visible.length === 0) continue;
      const frame: EventsMsg = { t: 'events', stream: this.streamId, events: visible };
      this.connections.send(conn, frame);
    }
  }

  /** Read-visibility filtering hook — identity pass-through in Phase 2. See `fanOut`'s comment. */
  private filterForConnection(events: Event[], _conn: Conn): Event[] {
    return events;
  }

  private async readMeta(): Promise<quotasModule.StreamMetaSnapshot> {
    const [bytesRaw, countRaw] = await Promise.all([
      this.store.getMeta('bytes_used'),
      this.store.getMeta('event_count'),
    ]);
    return { bytesUsed: bytesRaw ? Number(bytesRaw) : 0, eventCount: countRaw ? Number(countRaw) : 0 };
  }

  private async writeMeta(meta: quotasModule.StreamMetaSnapshot): Promise<void> {
    await Promise.all([
      this.store.setMeta('bytes_used', String(meta.bytesUsed)),
      this.store.setMeta('event_count', String(meta.eventCount)),
    ]);
  }

  /** Emits `notice {level:'warning', key:'quota.warning'}` ONCE per crossing — tracked via a
   * dedicated meta flag (not "every append while over 80%"), per doc-03 §Quota signalling read
   * together with the task brief's "emits notice quota.warning exactly once". Sent to
   * `sourceConn` (the connection whose append just crossed the line) when known; when the
   * append had no originating connection (see `append`'s doc comment), broadcasts to every
   * connection currently on the stream instead, since there is no single "whoever caused this"
   * to target. */
  private async maybeNotifyQuotaWarning(
    quota: { readonly bytesUsed: number; readonly eventCount: number },
    // `Conn` is `unknown` by port design (ports/connections.ts: opaque to core code) — an
    // explicit union with `undefined` would be flagged as redundant, so "no originating
    // connection" (see this method's doc comment) is expressed as an optional parameter
    // instead, which means exactly the same thing at every call site.
    sourceConn?: Conn,
  ): Promise<void> {
    const already = await this.store.getMeta(QUOTA_WARNED_META_KEY);
    if (already === '1') return;
    await this.store.setMeta(QUOTA_WARNED_META_KEY, '1');
    const notice: NoticeMsg = {
      t: 'notice',
      level: 'warning',
      key: 'quota.warning',
      params: { bytesUsed: quota.bytesUsed, bytesMax: quotasModule.STREAM_BYTES_MAX, eventCount: quota.eventCount },
    };
    if (sourceConn !== undefined) this.connections.send(sourceConn, notice);
    else for (const conn of this.connections.all()) this.connections.send(conn, notice);
  }

  private async clearQuotaWarning(): Promise<void> {
    const already = await this.store.getMeta(QUOTA_WARNED_META_KEY);
    if (already === '1') await this.store.setMeta(QUOTA_WARNED_META_KEY, '0');
  }
}
