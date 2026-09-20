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
   * connection's prior holdings are never cleared by a later, smaller `blob.have`. */
  handleHave(conn: Conn, hashes: readonly string[]): void {
    for (const hash of hashes) {
      let set = this.holders.get(hash);
      if (!set) {
        set = new Set<Conn>();
        this.holders.set(hash, set);
      }
      set.add(conn);
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
   * too short, wrong magic, oversized payload) or whose `to` doesn't resolve to a currently-known
   * connection (never issued, or the requester has since disconnected — doc-07: "DO drops chunks
   * for closed sockets") is dropped silently: a binary frame has no `rid`/JSON shape to answer with
   * a reject, matching this class's `handleRequest` stance on unhonorable requests.
   *
   * Completion is inferred from `index`/`total` (0-based `index`, doc-07's header fields) — doc-03
   * defines no separate "transfer complete" message, so the LAST chunk (`index === total - 1`)
   * freeing this transfer's flow-control slots is the only signal available; forwarding still
   * happens for that final chunk exactly like every other one, this is purely release bookkeeping
   * that happens to piggyback on it.
   *
   * `_sender` (the socket the bytes physically arrived on) is intentionally unused: the relay
   * trusts `decoded.to` to find the requester and `inFlightByRequester`'s own recorded `holder` for
   * release bookkeeping — it does not cross-check that `_sender` is actually that recorded holder
   * (doing so would reject a legitimate retry-from-a-different-holder scenario the client-side
   * design already allows for — doc-07: "mismatch -> discard and retry from another holder"). */
  handleChunk(_sender: Conn, frame: Uint8Array): void {
    const decoded = decodeBlobChunkHeader(frame);
    if (!decoded) return;
    const target = this.connFor(decoded.to);
    if (target === undefined) return;
    this.connections.sendBinary(target, frame);
    if (decoded.index >= decoded.total - 1) {
      const active = this.inFlightByRequester.get(target);
      if (active) this.release(target, active.holder);
    }
  }

  /** Adapter-called on connection close (`CampaignActor.onConnectionClosed`, mirroring its existing
   * presence hook) — removes `conn` from every holder set/first-holder record, releases an
   * in-flight transfer it was the REQUESTER of (so its flow-control slot doesn't stay stuck
   * forever waiting for a chunk that will now never arrive), releases every in-flight transfer it
   * was the HOLDER of for some OTHER still-connected requester (that requester's own next
   * `blob.request` should be free to pick a different holder rather than staying wedged behind a
   * dead one), and drops its relay-local connection id (never reused — see `connIds`'s own field
   * doc comment). */
  handleConnectionClosed(conn: Conn): void {
    for (const [hash, set] of this.holders) {
      set.delete(conn);
      if (set.size === 0) this.holders.delete(hash);
      if (this.firstHolder.get(hash) === conn) this.firstHolder.delete(hash);
    }
    this.inFlightByRequester.delete(conn);
    for (const [requester, info] of this.inFlightByRequester) {
      if (info.holder === conn) this.inFlightByRequester.delete(requester);
    }
    this.servingCountByHolder.delete(conn);
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
