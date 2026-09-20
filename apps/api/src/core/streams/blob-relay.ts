/**
 * Campaign blob relay — doc-07 §Blob transfer protocol (docs/02-architecture/07-images-and-blobs.md,
 * read together with doc-03's `blob.*` frame rows), plan-9 Task 7. Plan design ruling 4: "the
 * SERVER side only (holders map, routing, flow control, forwarding). No client transfer code in
 * this plan" — the server never stores blob bytes; holders are clients. This class tracks WHICH
 * already-admitted connections on ONE campaign stream claim to hold which hashes, brokers a single
 * requester/holder pairing per `blob.request`, and forwards the resulting binary `blob.chunk`
 * frames byte-for-byte from holder to requester without inspecting or reassembling their payload —
 * SHA-256 verification of the assembled bytes is a CLIENT responsibility (doc-07: "Requester
 * verifies the SHA-256 of the assembled bytes before storing; mismatch -> discard and retry from
 * another holder").
 *
 * Authorization (task brief: "blob frames only flow between connections already admitted to this
 * campaign stream"): every `Conn` this class ever sees arrives ALREADY attached to the owning
 * `CampaignActor`'s own `Connections` set — the WS-handoff membership check (doc-03's lifecycle
 * diagram: "membership check (D1)") already ran before any message from it can reach
 * `CampaignActor.handleMessage`/`handleBinaryMessage`, which are this class's only callers. There
 * is therefore no separate per-hash or per-request authorization check to add here: a connection
 * that can call any method on this class is, by construction, already a member of THIS campaign's
 * own roster — the same reasoning `CampaignActor.sendSubscribeCatchUp`'s doc comment gives for why
 * no additional `filterForConnection`-style check applies to its own (different) cross-stream
 * relay.
 *
 * State is PURELY in-memory and scoped to one actor instance (never durable — matches
 * `StreamActor.closed`'s own in-memory-only precedent) — a Cloudflare Hibernation wake starts every
 * field below empty again. `onHello` implements doc-07's documented recovery for that: "after
 * hibernation it is rebuilt from the next `hello`s (the DO asks with a `blob.resend-have` notice if
 * the map is empty)".
 */
import type { NoticeMsg } from '@hk/protocol';
import type { Conn, Connections } from '../../ports/connections.ts';
import type { ConnAttachment } from './stream-actor.ts';

/** doc-07: "16-byte header `[magic 4B][index u16][total u16][to u32][hash prefix 4B]`". */
export const BLOB_CHUNK_HEADER_BYTES = 16;

/** doc-07 specifies a 4-byte magic WITHOUT naming its value ("magic 4B") — this is the canonical
 * value; any future client-side encoder (plan 10) and the adapters' binary-frame receive path
 * (Task 8) must reuse this exported constant rather than hard-coding their own copy. ASCII "HKBC"
 * ("Herokeep Blob Chunk"). */
export const BLOB_CHUNK_MAGIC: readonly number[] = Object.freeze([0x48, 0x4b, 0x42, 0x43]);

/** doc-07: "followed by <= 64 KB" — a chunk frame whose payload (the bytes AFTER the 16-byte
 * header) exceeds this is treated as malformed and dropped (`decodeBlobChunkHeader` below), the
 * same defensive stance `WsConnections`'s own `maxPayload` guard takes at the transport level. */
export const MAX_BLOB_CHUNK_PAYLOAD_BYTES = 64 * 1024;

/** doc-07: "holders serve at most two requesters concurrently". */
const MAX_CONCURRENT_SERVES_PER_HOLDER = 2;

/** [fix round 1, Important I3] Defensive per-connection bound on DISTINCT hashes one connection
 * may register as a holder of (via `blob.have`, including `hello.have` — `onHello` folds into the
 * same path). Neither `HelloMsgSchema.have` nor `BlobHaveMsgSchema.hashes` caps array length at
 * the protocol level (unlike `AppendMsgSchema.events`'s `.max(50)`), so without a relay-level bound
 * a single connection could grow this actor's in-memory `holders`/`firstHolder` state without
 * limit. Generously derived from doc-08's campaign quota shapes (a headroom bound, not a tight
 * budget): up to `CAMPAIGN_MEMBER_MAX` (12, `core/quotas.ts`) members, each plausibly contributing
 * a portrait + thumb + token + a handful of equipped-item/prepared-spell icons (~12 images) ~= 150,
 * plus the campaign banner, plus up to `CAMPAIGN_NON_CORE_PACK_MAX` (6) non-core packs' own custom
 * assets (~25 each, generous headroom for a large homebrew pack) ~= 150 — roughly 300 in a
 * realistically large, fully-populated campaign; rounded up to 512 for comfortable headroom.
 * Excess announcements beyond this cap are silently dropped for that connection (same "nothing to
 * answer with" stance as every other unhonorable blob-relay request in this class — see
 * `handleRequest`'s doc comment); other connections' own holdings are unaffected. */
export const MAX_HASHES_PER_CONNECTION = 512;

/** [fix round 1, Important I2 — DEFERRED, not implemented] doc-07 describes no server-side
 * holder-stall timeout/requeue: if a holder accepts a `blob.pull` and then never streams (goes
 * idle, network-stalls without closing the socket), the requester's flow-control slot stays wedged
 * until something ends it. Deliberately NOT built here — the requester already has a working,
 * tested self-service recovery: `blob.cancel` frees ITS OWN slot immediately (`handleCancel`),
 * after which a fresh `blob.request` can pick a DIFFERENT holder (`selectHolder`'s ordering).
 * doc-07's client-side design (plan 10, not built yet) is where a timeout-driven
 * cancel-then-retry belongs — the client is what knows how long is "too long" for its own UX. A
 * server-side timeout (e.g. a `Scheduler`-backed alarm per in-flight transfer) is a reasonable
 * FOLLOW-UP if a stalled holder that never explicitly cancels/disconnects proves to be a real
 * problem in practice, but nothing in this plan's task list scopes it, and building it
 * speculatively would add a whole timer-management surface (port dependency, test complexity) for
 * a failure mode this relay has no evidence is common. */

export interface DecodedBlobChunkHeader {
  /** 0-based chunk index within this transfer. */
  readonly index: number;
  /** Total number of chunks in this transfer. */
  readonly total: number;
  /** The requester's relay-assigned connection id (`BlobRelay`'s own `idFor`/`connFor` registry) —
   * NOT a `userId`/socket-level identifier the client otherwise knows; it exists purely so a 16-byte
   * binary header has room to name a target connection at all. */
  readonly to: number;
  /** The requested blob's hash, first 4 raw bytes (informational only — the relay never verifies
   * it; doc-07 makes SHA-256 verification the requester's job once every chunk has arrived). */
  readonly hashPrefix: Uint8Array;
  /** The frame's bytes after the 16-byte header — at most `MAX_BLOB_CHUNK_PAYLOAD_BYTES`. */
  readonly payload: Uint8Array;
}

/** Parses one binary `blob.chunk` frame (doc-07's 16-byte header, big-endian multi-byte fields —
 * doc-07 does not specify byte order; big-endian/network order is this codec's documented choice).
 * Returns `undefined` for anything that cannot possibly be a valid chunk frame: shorter than the
 * header, a magic mismatch, or an oversized payload — `BlobRelay.handleChunk` drops these frames
 * silently (see that method's doc comment for why there is no reject-style response to send back
 * over a binary channel). */
export function decodeBlobChunkHeader(frame: Uint8Array): DecodedBlobChunkHeader | undefined {
  if (frame.length < BLOB_CHUNK_HEADER_BYTES) return undefined;
  for (let i = 0; i < BLOB_CHUNK_MAGIC.length; i++) {
    if (frame[i] !== BLOB_CHUNK_MAGIC[i]) return undefined;
  }
  const payload = frame.subarray(BLOB_CHUNK_HEADER_BYTES);
  if (payload.length > MAX_BLOB_CHUNK_PAYLOAD_BYTES) return undefined;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return {
    index: view.getUint16(4, false),
    total: view.getUint16(6, false),
    to: view.getUint32(8, false),
    hashPrefix: frame.slice(12, 16),
    payload,
  };
}

interface InFlightTransfer {
  readonly hash: string;
  readonly holder: Conn;
}

export interface BlobRelayDeps {
  readonly connections: Connections<ConnAttachment>;
}

export class BlobRelay {
  private readonly connections: Connections<ConnAttachment>;

  /** `hash -> Set<holder Conn>` — doc-07's own "the DO keeps `hash -> Set<socketId>` in memory". */
  private readonly holders = new Map<string, Set<Conn>>();
  /** `hash -> the first connection ever seen announcing it` — an "uploader" PROXY (doc-07: "the
   * uploader ... if online" is the top holder-selection priority; this relay has no `Db`/event-
   * payload access to know who the TRUE uploader was — the first announcer is, in practice, almost
   * always that same device, since a freshly-created local blob has nowhere else to have come from
   * yet). Documented judgment call — see `selectHolder`'s doc comment. */
  private readonly firstHolder = new Map<string, Conn>();
  /** [fix round 1, I3] Distinct-hash count per connection, enforcing `MAX_HASHES_PER_CONNECTION` —
   * see that constant's own doc comment. Incremented only when a `blob.have` genuinely adds a NEW
   * hash for that connection (idempotent re-announcements of an already-held hash never count
   * twice); cleared alongside every other per-connection map in `handleConnectionClosed`. */
  private readonly hashCountByConn = new Map<Conn, number>();

  /** Bidirectional registry assigning each connection a small relay-local integer id — the ONLY
   * reason this exists is that the binary chunk header's `to` field is a `u32` (doc-07), not a
   * string: `blob.pull`'s JSON `to` field carries this id STRINGIFIED, the holder echoes it back
   * verbatim in every chunk header, and `handleChunk` below reverses the mapping to find the real
   * `Conn` to forward to. Ids are assigned lazily and never reused within one actor instance's
   * lifetime (freeing one on disconnect would risk a late-arriving stale chunk from a slow/confused
   * holder being mis-delivered to a DIFFERENT, newly-connected requester that happened to be
   * assigned the same recycled id). */
  private readonly connIds = new Map<Conn, number>();
  private readonly connsById = new Map<number, Conn>();
  private nextConnId = 1;

  /** doc-07: "one blob in flight per requester" — keyed by the REQUESTER's `Conn`. */
  private readonly inFlightByRequester = new Map<Conn, InFlightTransfer>();
  /** doc-07: "holders serve at most two requesters concurrently" — keyed by the HOLDER's `Conn`. */
  private readonly servingCountByHolder = new Map<Conn, number>();

  constructor(deps: BlobRelayDeps) {
    this.connections = deps.connections;
  }

  /** `hello`'s own `have[]` (doc-03: `hello {..., have: [hashes]}`) folds into `blob.have` handling
   * — doc-07: "on connect ... `blob.have {hashes}`" is literally what `hello.have` already IS for
   * this transport. Also implements the hibernation-rebuild ask (doc-07, this class's own header
   * comment): checked BEFORE this hello's own `have` is folded in, so the very first post-wake
   * `hello` (which, from a freshly-hibernated DO's perspective, is indistinguishable from a
   * genuinely fresh actor that has just never seen any blobs) triggers exactly one broadcast, not a
   * further one for every subsequent connection in the same wake cycle once the map is non-empty
   * again. A campaign that has announced ZERO blobs at all keeps re-asking on every `hello` — an
   * accepted, spec-literal consequence ("if the map is empty") rather than an invented "asked
   * once" flag; the notice is cheap and a client with nothing to announce just replies with an
   * equally-empty `blob.have`. */
  onHello(conn: Conn, have: readonly string[]): void {
    const wasEmpty = this.holders.size === 0;
    this.handleHave(conn, have);
    if (wasEmpty) {
      const notice: NoticeMsg = { t: 'notice', level: 'info', key: 'blob.resend-have' };
      for (const c of this.connections.all()) this.connections.send(c, notice);
    }
  }

  /** doc-03: `blob.have {hashes}` — "report cached blobs (after downloads)". Additive only (doc-07:
   * "after each completed download" implies incremental announcements, not a full replace) — a
   * connection's prior holdings are never cleared by a later, smaller `blob.have`.
   *
   * [fix round 1, I3] Bounded by `MAX_HASHES_PER_CONNECTION` — once `conn` has registered that many
   * DISTINCT hashes, further NEW hashes from it are silently dropped (already-held hashes stay
   * held; re-announcing one is always a no-op, never counted against the cap, and never itself
   * refused). The `holders` Set for a hash is only created lazily, on an actual successful add —
   * a connection that hits the cap on its very first `blob.have` for a brand-new hash never leaves
   * behind an orphan empty Set for it. */
  handleHave(conn: Conn, hashes: readonly string[]): void {
    for (const hash of hashes) {
      const set = this.holders.get(hash);
      if (!set?.has(conn)) {
        const count = this.hashCountByConn.get(conn) ?? 0;
        if (count >= MAX_HASHES_PER_CONNECTION) continue;
        const target = set ?? new Set<Conn>();
        if (!set) this.holders.set(hash, target);
        target.add(conn);
        this.hashCountByConn.set(conn, count + 1);
      }
      if (!this.firstHolder.has(hash)) this.firstHolder.set(hash, conn);
    }
  }

  /** doc-03: `blob.request {rid, hash}` -> DO picks a holder and sends it `blob.pull {hash, to}`,
   * or `blob.unavailable {hash}` when none is eligible. Flow control (doc-07): a requester already
   * mid-transfer is silently ignored — doc-03's client->server frame table gives `blob.request` no
   * reject/ack counterpart to answer a request that can't be honored RIGHT NOW with (the same
   * stance `CampaignActor.handleSubscribe` documents for its own "unauthorized, no reply" case); a
   * well-behaved client never sends a second `blob.request` before its first resolves (client-side
   * one-at-a-time queuing is the actual enforcement point per doc-07's client-side design, plan 10)
   * — this is a defensive server-side backstop, not a path any well-behaved client exercises. */
  handleRequest(requester: Conn, hash: string): void {
    if (this.inFlightByRequester.has(requester)) return;
    const holder = this.selectHolder(hash);
    if (!holder) {
      this.connections.send(requester, { t: 'blob.unavailable', hash });
      return;
    }
    this.inFlightByRequester.set(requester, { hash, holder });
    this.servingCountByHolder.set(holder, (this.servingCountByHolder.get(holder) ?? 0) + 1);
    this.connections.send(holder, { t: 'blob.pull', hash, to: String(this.idFor(requester)) });
  }

  /** doc-07's holder-selection order: "the uploader (recorded in the announcing event's actor) if
   * online -> the DM -> any", restricted to holders currently under the per-holder concurrency cap.
   * `firstHolder` (this class's own field doc comment explains the approximation) stands in for
   * "the uploader" — this relay has no `Db`/event-payload access to the real announcing event's
   * actor field, only what connections have SELF-REPORTED via `blob.have`. Returns `undefined` when
   * no holder for `hash` is both known and under capacity (either nobody has announced it, or every
   * known holder is already serving two other requesters) — the caller replies `blob.unavailable`
   * either way; doc-07 draws no distinction between "no holder ever announced this" and "every
   * holder is momentarily busy" as a wire-visible client signal.
   *
   * Return type is `Conn`, not `Conn | undefined` — `Conn` (`ports/connections.ts`) is itself
   * `unknown`, so an explicit `| undefined` union is flagged as redundant
   * (`@typescript-eslint/no-redundant-type-constituents`, matching every OTHER `Conn`-typed
   * optional value in this codebase, e.g. `StreamActor.append`'s `sourceConn?: Conn` parameter) —
   * `undefined` is already a valid `Conn` value and the explicit `undefined` return below is
   * accepted without a cast. */
  private selectHolder(hash: string): Conn {
    const set = this.holders.get(hash);
    if (!set || set.size === 0) return undefined;
    const eligible = [...set].filter((c) => (this.servingCountByHolder.get(c) ?? 0) < MAX_CONCURRENT_SERVES_PER_HOLDER);
    if (eligible.length === 0) return undefined;
    const first = this.firstHolder.get(hash);
    if (first !== undefined && eligible.includes(first)) return first;
    const dm = eligible.find((c) => this.connections.getAttachment(c).role === 'dm');
    if (dm) return dm;
    return eligible[0];
  }

  /** doc-03: `blob.cancel {hash}` — a requester giving up on its own in-flight transfer. Only
   * releases the flow-control slot; there is no "stop streaming" signal to the holder in doc-03's
   * protocol table (the holder simply stops receiving `blob.pull`-triggered reasons to keep
   * sending, from the client's own perspective — nothing server-side to forward here). Ignored if
   * `hash` doesn't match (or there is no) active transfer for `requester` — a stale/duplicate
   * cancel is a no-op, never an error. */
  handleCancel(requester: Conn, hash: string): void {
    const active = this.inFlightByRequester.get(requester);
    if (active?.hash !== hash) return;
    this.release(requester, active.holder);
  }

  /** doc-03: `blob.chunk` (binary) — "holder -> DO -> requester"; doc-07: "the DO forwards to `to`
   * and discards". A frame that fails to parse (`decodeBlobChunkHeader` returning `undefined` —
   * too short, wrong magic, oversized payload), whose `to` doesn't resolve to a currently-known
   * connection (never issued, or the requester has since disconnected — doc-07: "DO drops chunks
   * for closed sockets"), or whose `to` names a requester with NO active transfer currently
   * assigned to `sender` specifically is dropped silently: a binary frame has no `rid`/JSON shape
   * to answer with a reject, matching this class's `handleRequest` stance on unhonorable requests.
   *
   * [fix round 1, Critical C1] `sender` MUST be `inFlightByRequester.get(target)?.holder` — checked
   * BEFORE forwarding or releasing anything. Before this fix `sender` was accepted unconditionally:
   * ANY admitted campaign member (not just the assigned holder) could send a well-formed chunk
   * frame naming another connection's (guessable, small-sequential-integer) relay id as `to` and
   * have it forwarded as if it were real transfer data — 64 KB of attacker-controlled bytes
   * delivered to a victim with no holder role required — AND, by setting `index === total - 1`,
   * trigger `release()` against the VICTIM's real in-flight transfer, prematurely freeing the REAL
   * holder's serving slot and defeating `MAX_CONCURRENT_SERVES_PER_HOLDER`. There is no legitimate
   * "retry from a different holder" case this check could wrongly reject: a retry to a different
   * holder happens via a NEW `blob.request` (`handleRequest`), which records that NEW holder as
   * `inFlightByRequester`'s value BEFORE any of its chunks can arrive — `sender` is checked against
   * whatever holder is CURRENTLY on record for `target`, always the right one.
   *
   * Completion is inferred from `index`/`total` (0-based `index`, doc-07's header fields) — doc-03
   * defines no separate "transfer complete" message, so the LAST chunk (`index === total - 1`)
   * freeing this transfer's flow-control slots is the only signal available; forwarding still
   * happens for that final chunk exactly like every other one, this is purely release bookkeeping
   * that happens to piggyback on it. */
  handleChunk(sender: Conn, frame: Uint8Array): void {
    const decoded = decodeBlobChunkHeader(frame);
    if (!decoded) return;
    const target = this.connFor(decoded.to);
    if (target === undefined) return;
    const active = this.inFlightByRequester.get(target);
    if (!active || active.holder !== sender) return;
    this.connections.sendBinary(target, frame);
    if (decoded.index >= decoded.total - 1) {
      this.release(target, active.holder);
    }
  }

  /** Adapter-called on connection close (`CampaignActor.onConnectionClosed`, mirroring its existing
   * presence hook) — removes `conn` from every holder set/first-holder record, releases an
   * in-flight transfer it was the REQUESTER of (so its flow-control slot doesn't stay stuck
   * forever waiting for a chunk that will now never arrive, AND so the holder it was paired with
   * gets its serving-count slot back — see the [fix round 1, I1] note below), releases every
   * in-flight transfer it was the HOLDER of for some OTHER still-connected requester (that
   * requester's own next `blob.request` should be free to pick a different holder rather than
   * staying wedged behind a dead one), and drops its relay-local connection id (never reused — see
   * `connIds`'s own field doc comment) plus its `hashCountByConn` entry (fix round 1, I3).
   *
   * [fix round 1, Important I1] `conn`'s own `inFlightByRequester` entry is released via
   * `release()`, not a bare `Map.delete` — before this fix, closing a REQUESTER mid-transfer only
   * ever deleted ITS OWN `inFlightByRequester` key, never decremented the recorded HOLDER's
   * `servingCountByHolder`. That holder permanently lost one of its two serving slots per such
   * disconnect (a `Map.delete` on a key that was never the one tracking the holder's count) — twice
   * and it could never serve anyone again, with no way to recover short of that holder itself
   * reconnecting (a fresh `Conn` identity, per `connIds`'s "never reused" doc comment). */
  handleConnectionClosed(conn: Conn): void {
    for (const [hash, set] of this.holders) {
      set.delete(conn);
      if (set.size === 0) this.holders.delete(hash);
      if (this.firstHolder.get(hash) === conn) this.firstHolder.delete(hash);
    }
    const ownActive = this.inFlightByRequester.get(conn);
    if (ownActive) this.release(conn, ownActive.holder);
    for (const [requester, info] of this.inFlightByRequester) {
      if (info.holder === conn) this.inFlightByRequester.delete(requester);
    }
    this.servingCountByHolder.delete(conn);
    this.hashCountByConn.delete(conn);
    const id = this.connIds.get(conn);
    if (id !== undefined) {
      this.connIds.delete(conn);
      this.connsById.delete(id);
    }
  }

  private release(requester: Conn, holder: Conn): void {
    this.inFlightByRequester.delete(requester);
    const count = this.servingCountByHolder.get(holder) ?? 0;
    if (count <= 1) this.servingCountByHolder.delete(holder);
    else this.servingCountByHolder.set(holder, count - 1);
  }

  private idFor(conn: Conn): number {
    let id = this.connIds.get(conn);
    if (id === undefined) {
      id = this.nextConnId++;
      this.connIds.set(conn, id);
      this.connsById.set(id, conn);
    }
    return id;
  }

  /** Return type `Conn`, not `Conn | undefined` — see `selectHolder`'s doc comment for why. */
  private connFor(id: number): Conn {
    return this.connsById.get(id);
  }
}
