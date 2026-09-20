# Sync protocol

One WebSocket per context (ADR-001/002). Text frames carry JSON messages validated by
`@hk/protocol`; binary frames carry blob chunks. Every message has `t` (type) and, for
requests, `rid` (request id) so acks can be matched.

## Connection lifecycle

```mermaid
sequenceDiagram
  participant C as Client
  participant W as Worker
  participant DO as Stream DO
  C->>W: GET /api/campaigns/:id/ws (cookie)
  W->>W: session → user; membership check (D1); Origin check
  W->>DO: fetch(upgrade) with {userId, role}
  DO->>DO: acceptWebSocket(ws); attach {userId, role, subs: []}
  DO-->>C: 101 Switching Protocols
  C->>DO: hello {rid, proto: 1, app: "1.4.0", streams: [{id, lastSeq}], have: [hashes], pending: [events]}
  DO-->>C: welcome {rid, serverTime, streams: [{id, headSeq, quota}], members: [...], packs: [...]}
  DO-->>C: events {stream, events: [...]} (paged, ≤ 200 per frame, until caught up)
  DO-->>C: ack/reject per pending event
```

Solo context is identical against `/api/characters/:id/ws` with one stream.

Reconnect triggers: socket close, `online`, `visibilitychange` → visible, `pageshow`,
`resume` (Chromium). Backoff: 0.5 s × 2ⁿ with ±20 % jitter, cap 30 s; immediate on
user action. Only one tab per device holds the socket (Web Lock `hk:sync:<stream>`); other
tabs receive events via BroadcastChannel.

## Messages — client → server

| `t` | Fields | Semantics |
|-----|--------|-----------|
| `hello` | `proto, app, streams[{id,lastSeq}], have[], pending[]` | (re)subscribe, catch up, flush pending |
| `append` | `rid, events[]` | append 1–50 events to their streams (each event names its stream); all-or-nothing per stream |
| `subscribe` / `unsubscribe` | `stream, lastSeq?` | DM opening/closing a member sheet |
| `blob.have` | `hashes[]` | report cached blobs (after downloads) |
| `blob.request` | `rid, hash` | ask for a blob |
| `blob.chunk` (binary) | header `{hash, index, total, to}` + bytes | holder → DO → requester |
| `blob.cancel` | `hash` | |
| `presence` | `state: active \| idle` | optional; throttled to ≥ 60 s |

## Messages — server → client

| `t` | Fields | Semantics |
|-----|--------|-----------|
| `welcome` | as above | |
| `events` | `stream, events[]` | committed events in `seq` order; also used for catch-up paging |
| `ack` | `rid, results[{id, seq}]` | pending → committed |
| `reject` | `rid, results[{id, code, message}]` | codes: `forbidden`, `quota`, `invalid`, `duplicate` (with existing seq), `stream_closed` |
| `blob.pull` | `hash, to` | you hold this; start streaming to `to` |
| `blob.chunk` (binary) | | forwarded chunk |
| `blob.unavailable` | `hash` | no holder online |
| `members` | `[{userId, displayName, role, online}]` | presence snapshot; sent on change, throttled |
| `notice` | `level, key, params` | localized by the client (`quota.warning`, `pack.updated`) |
| `bye` | `reason` | server closes (session expired, removed from campaign) |

## `bye` triggers (plan-9 Task 9)

`bye {reason}` exists so a client can tell "you were removed" apart from an ordinary transient
disconnect (which never sends anything — the socket just drops). Exactly one trigger is wired
server-side today: a DM removing a member (`DELETE /api/campaigns/:id/members/:userId`) closes
every live connection that removed user currently has on that campaign stream with a `bye` frame,
then the WS close itself.

Two other candidate triggers were surveyed and are deliberately NOT wired, for concrete reasons
(not by omission): passive session expiry on an otherwise-idle open socket, and device revocation
(`DELETE /api/me/sessions/:id`) — neither has a session-id-to-live-connection mapping anywhere in
this codebase (on either adapter) to hang a `bye` off of, and character-stream sockets have the
identical gap already (not a new, campaign-only shortfall). A client with an actually-expired or
revoked session finds out on its next reconnect attempt (a real 401 at the WS-upgrade HTTP layer),
never via `bye` over the old socket. See `apps/api/src/core/streams/stream-actor.ts`'s
`byeCloseUser` doc comment for the full write-up.

Even the one wired trigger has a narrow TOCTOU: a WS handoff whose membership check reads as
still-a-member just before a concurrent removal commits, and whose connection only registers
after that removal's bye snapshot was taken, survives un-bye'd — same "no mid-socket re-check"
class as the two gaps above. See the doc comment for the exact window.

## Ordering and commit rules

- The DO assigns `seq` strictly increasing per stream; `events` frames are always in
  order; a client that detects a gap (`seq != lastSeq + 1`) re-sends `hello` for that
  stream (never guesses).
- Client-side: `committed[]` sorted by seq, `pending[]` in creation order. `facts =
  reduce(committed ++ pending)`. On `ack`, move the event to committed at its seq; on
  `reject`, drop it and re-derive; show a toast for `forbidden`/`quota`.
- Duplicates (same `id`) are acked with the existing `seq` (idempotent retries).
- Transactions: events sharing a `txId` are appended in one `append`; the DO commits them
  contiguously or rejects all (single-stream only — a level-up never spans streams).
- Cross-stream mirrors (`character.campaign_joined` ↔ `campaign.character_joined`) are
  two appends issued by the client; the DO for the campaign verifies the character event
  exists before accepting the mirror (RPC read), so a half-join is not possible.

## Permission enforcement point

The **CampaignStream** stamps `actor` from the socket attachment and checks role; for
character-stream events it calls `CharacterStream.append(events, actor)` by RPC, which
re-checks (owner/DM) against its own `meta` — so a compromised campaign object can't
forge owner events beyond DM rights. Direct solo sockets only allow the owner role.

Concretely, the CharacterStream's own re-check is split by role: for an `owner`-role
forwarded actor, it compares `actor.userId` against its OWN established `meta.ownerId`
directly (the CharacterStream has no visibility into which campaign forwarded the call, so
this is the only identity it can verify); for a `dm`-role forwarded actor, it re-checks only
that the event TYPE is dm-permitted (`EVENT_ACTORS`) — the forwarding campaign's own `dmId`
match already happened campaign-side (`CampaignActor`'s gateway mapping), since the
CharacterStream has no access to any campaign's `dmId` to re-verify it a second time.

## Catch-up performance

A character's full history is typically < 1 MB; the DO pages 200 events per frame. A
new device pulls each stream once; afterwards catch-up is incremental. Owner-uploaded
snapshots (`snapshot.put`) are reserved for a later version if first sync proves slow.

## Quota signalling

`welcome.streams[].quota = {bytesUsed, bytesMax, eventCount}`; the DO sends `notice
quota.warning` at 80 % and rejects with `quota` at 100 %. Archiving/exporting and hard-
deleting a character frees the space.

## Versioning

`proto` is the protocol version; the server supports the current and previous version
for 90 days after a bump. Event payload versions (`v`) are independent and never removed
from reducers. `app` is logged for support only.

## Transport-agnostic note

Frames are defined independently of WebSocket: the same JSON/binary frames could travel
over a WebRTC data channel between two peers (with the DO still receiving `append` for
sequencing). No v1 code depends on socket-specific features beyond open/close/message.
