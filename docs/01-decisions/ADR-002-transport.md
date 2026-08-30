# ADR-002 — Transport: WebSocket to Durable Objects; no WebRTC in v1

**Status:** Approved 2026-08-30. Depends on ADR-001.

## Context

Requirements that shape transport: images must not be *persisted* server-side (transit in
memory is permitted — owner's answer to Q2); venue wifi is unreliable; phones lock their
screens constantly at the table; the server must be free. Research facts (see
`04-reference/platform-research.md`, checked 2026-08-29):

- iOS Safari suspends JavaScript, closes WebSockets and suspends WebRTC within seconds of
  the screen locking or the app backgrounding. Any transport must be built around cheap,
  fast reconnection — not around keeping connections alive.
- Venue access points frequently enable client isolation, which blocks LAN peer-to-peer
  entirely; browsers also now hide LAN addresses behind mDNS and macOS 26 prompts for
  "Local Network" permission for any peer connection. LAN-direct WebRTC is therefore not
  a reliable path at the table.
- Cloudflare Durable Objects support WebSockets with a Hibernation API on the free plan:
  outgoing messages are free, incoming messages count 20:1 against the 100k requests/day
  budget, and idle connections cost nothing.
- Cloudflare offers free unlimited STUN and a 1,000 GB/month free TURN tier — so a later
  WebRTC path would also be free.

## Options considered

### 1. WebRTC data channels (star: DM ↔ each player), server for signaling only

- Pro: traffic never touches the server after signaling; lowest latency on a good LAN.
- Con: fragile on exactly our devices: iOS backgrounding, ICE renegotiation on every
  reconnect (seconds, not milliseconds), AP isolation forcing TURN anyway.
- Con: incompatible with ADR-001 — the DO must see every event to sequence it, so the
  data channel could only carry *images*, not state.
- Con: N peer connections on the DM's phone/laptop; each renegotiated every time a player's
  phone locks.

### 2. WebSocket relay to a stateless server

- Pro: dead simple, reconnects in one round-trip, passes every corporate/venue firewall
  (WSS on 443).
- Con: with a stateless relay, reconnection must re-sync from the host (ADR-001 option A
  problems).

### 3. WebSocket to the authoritative Durable Object (chosen)

- Pro: everything in option 2, plus the DO holds the log, so a reconnect is `hello
  {lastSeq}` → missing events. No renegotiation, no host dependency.
- Pro: image chunks relay through the same socket; the DO holds a chunk in memory only
  while forwarding it (never written to storage).
- Con: all traffic — including image bytes — flows through Cloudflare. Volumes are tiny
  (a campaign's images total tens of MB, fetched once per device and cached).
- Con: no LAN-only operation when the venue has no internet at all. Accepted: nothing else
  in the app (login, join codes) works in that case either; local replicas keep each
  individual device usable.

### 4. Hybrid: WebSocket for state, WebRTC for image bytes

- Pro: image bytes stay off the server entirely.
- Con: all of option 1's fragility for the least important payload. Rejected for v1; kept
  as a possible optimization because the blob protocol (ADR-010) is transport-agnostic.

## Decision

**Option 3.** One WebSocket per context (ADR-001) from the browser to the Worker, upgraded
and handed to the `CampaignStream` or `CharacterStream` Durable Object using the
Hibernation API. JSON text frames for control and events; binary frames for image chunks.

Client rules:

- Reconnect on `online`, `visibilitychange` → visible, `pageshow`, and on socket close,
  with jittered exponential backoff (0.5 s → 30 s cap). Reconnect is `hello` carrying the
  last known sequence number per subscribed stream plus any pending (uncommitted) events.
- Never rely on heartbeats from the client (they cost requests and wake the phone);
  protocol-level pings from the server side are free and handled by hibernation.
- Every message is small (≤ 128 KB; image chunks 64 KB). No message is ever required to
  be delivered "live" — the log is the truth, the socket is just a notification channel.
- Optimistic UI: local events apply immediately, show as "pending" subtly, and settle on
  ack. A rejected event is rolled back with a visible toast (permission or quota).

Server rules:

- The Worker authenticates the upgrade (cookie session, ADR-012), routes to the DO by id,
  and does nothing else. The DO checks the actor's permission per event type, validates
  the envelope with shared Zod schemas, assigns `seq`, persists, acks the sender and fans
  out to other sockets.
- Use `WebSocketPair` with `state.acceptWebSocket()` (Hibernation API) and
  `serializeAttachment` to keep per-socket identity across hibernation.

## Consequences

- No STUN/TURN, no ICE, no SDP in v1. One transport to test.
- The message protocol (`02-architecture/03-sync-protocol.md`) is designed so that a
  future WebRTC data channel could carry the same frames between two peers with the DO
  still receiving the events for sequencing.
- Bandwidth budget: ~40 sockets, a few messages per minute each, plus ≤ 100 MB/month of
  image chunks — far inside the free plan (see quotas doc).

## Open points

- Whether protocol pings alone keep iOS Safari sockets alive is moot (iOS kills them
  anyway); the design assumes frequent reconnects and must be tested on a real iPhone
  early in Phase 3.
