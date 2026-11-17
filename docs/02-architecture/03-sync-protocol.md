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
| `notice` | `level, key, params` | localized by the client (`quota.warning`). `key` is a free string in the schema (`NoticeMsgSchema`); `pack.updated` is named only in a comment there (`packages/protocol/src/sync/messages.ts:234-235`) and is never sent — a campaign's enabled packs travel as events, see §Campaign packs |
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

`member.removed` unlinks the MEMBERSHIP only (`meta.members`) — it does NOT unlink that member's
character(s) from the campaign roster (`meta.characters`). Unlinking a character is owner-driven,
via `character.campaign_left` (the character's own stream) mirror-verified by `campaign.
character_left` on the campaign stream — the same no-half-join two-step symmetry every other
mirror-verified transition in this protocol uses, and not something a removal can shortcut. Until
that happens, the DM's read/subscribe/gateway-write reach to the (now-former-member's) character
persists exactly as before the removal: `mapGatewayActor`/`handleSubscribe`'s roster check
(`meta.characters.has(characterId)`) has nothing to do with `meta.members`. The removed owner can
still clear their OWN half of the link (`character.campaign_left` on their character's own stream
has no campaign-membership dependency at all), but completing the CAMPAIGN-side half
(`campaign.character_left`) needs either the DM (exempt from the membership check) or the owner to
still be — or become again — a campaign member; a removed, non-rejoined owner cannot complete it
alone. A future client task (plan 10) should surface this: a removed member's character does not
silently disappear from the DM's tools, and finishing the unlink after a removal is a DM action,
not an automatic one.

## Campaign packs (plan 16)

A campaign's enabled content packs are campaign-stream events (`pack.enabled@1` /
`pack.disabled@1 {packId, version, sha256}`); the pack JSON itself never travels over the
socket. A body can reach 5 MiB while a WS frame is capped at 128 KB
(`packages/protocol/src/sync/messages.ts:24`), so there is **no pack-fetch WebSocket message**:
bodies move over two HTTP routes (`apps/api/src/core/routes/campaign-packs.ts`, mounted ahead of
the campaign routes at `apps/api/src/core/app.ts:51`).

| Route | Who | Semantics |
|-------|-----|-----------|
| `PUT /api/campaigns/:id/packs/:packId/:version` | the DM | Auth, then the DM check and path validation, run before any body byte is read; then a 5 MiB body limit (413), strict `parsePack`, id/version must match the URL, the pack must be `kind: content` (the only kind a member installs), and the body must equal its canonical JSON byte for byte (400 otherwise). Stores the exact bytes in the campaign stream's store and answers `{sha256}` (bare hex); 409 `quota_exceeded` for a new `packId` once 6 distinct packs are enabled, or past the campaign total (`campaign-packs.ts:94-149`, `campaign-actor.ts:800-808`) |
| `GET /api/campaigns/:id/packs/:packId/:version` | any member | The stored body, byte for byte, with `ETag: "<sha256>"`; a matching `If-None-Match` is a 304; 404 when that id@version is not stored (`campaign-packs.ts:151-166`) |

- **Upload before the event.** The campaign actor accepts `pack.enabled@1` only when the stream
  stores a body for that `packId` with the event's version, and its sha256 equals the event's
  (`apps/api/src/core/streams/campaign-actor.ts:580-603`). One version per `packId`: enabling a
  new version is a version change and replaces the body; `pack.disabled@1` matches by `packId`
  and deletes the body (`campaign-actor.ts:903-942`).
- **`packMissing` convention.** The `reject` code set above is a closed enum, so a missing or
  mismatched body is rejected as code `invalid` with a message starting `event.packMissing:`
  (`campaign-actor.ts:597-601`) — the same message-prefix convention as `event.txGroupInvalid`.
  The 7th distinct `packId` is rejected `quota` (`campaign-actor.ts:589-592`).
- **`welcome.packs`** is `[{id, version, sha256?}]` (`messages.ts:86-90`, `:176`), the campaign
  stream's currently enabled set (`campaign-actor.ts:951`). The client seeds the campaign
  projection with it (`apps/web/src/app/shared/services/sync/stream-sync-session.ts:540`,
  `campaign-projection.ts:99`, `:205`); later `pack.*` events keep it current.
- **Compatibility: an "additive" server→client field needs the client release first.** The
  client's nested message schemas are strict (`WelcomePackSchema` is a `z.strictObject`,
  `messages.ts:86`), so a client built before a field existed fails `parseServerMessage` on any
  frame that carries it, closes the socket and reconnects with backoff until the app updates.
  Plan 16's `welcome.packs[].sha256` is the example: a pre-slice-6 PWA cannot connect to a
  campaign with at least one enabled pack (one with none sends `packs: []`, which it parses) —
  members on such a build must reload once after the DM enables a pack. Rule for future protocol
  work: ship the client that accepts a new server→client field before the server sends it, or make
  the nested server→client shapes tolerant of unknown keys first.
- **Members install automatically.** For each enabled pack the device does not hold, the client
  GETs the body, validates it exactly like a `.hero` bundle pack (size, sha256 of the exact bytes
  against the event, strict parse, conflict rule, `validatePack`) and only then installs it
  (`apps/web/src/app/shared/services/campaigns/campaign-packs.service.ts:324-340`). Pinning stays
  the player's choice (a sheet banner offers it). Pack ASSETS ride the blob relay, see
  `07-images-and-blobs.md` §Pack assets.

## Encounters, rounds and house rules (plan 18)

- **Campaign events** (campaign stream): `encounter.started@1 {encounterId, startedAtSeq}`,
  `encounter.ended@1` and `round.advanced@1`, all DM-only. The campaign clock is derived from
  them: the open encounter and its round count.
- **Solo heroes** have no campaign stream, so a solo round is a character-stream event,
  `combat.round_advanced@1 {encounterId, round}`, actors `['owner']`. It is named differently
  because the protocol event tables are keyed by bare type name, and a same-named campaign and
  character event would collide.
- **Conditions.** `condition.added@2` adds `duration?`, `startedAtRound?`, `source?` (at most 80
  characters) and `encounterId?` to the `@1` fields; `condition.updated@1` edits a condition in
  place. Both are actors owner + dm. `@1` events replay unchanged.
- **House rules.** `campaign.settings_changed@2` extends `houseRules` with four optional
  booleans, `playersManageConditions`, `startingGold`, `multiclassing` and `playersAddItems`;
  absent means true. `@1` is unchanged and clients read both. The server does not enforce them:
  clients do, and the DM's override path (doc 08) audits. A rule flips live for connected members.
- **Starting gold and multiclassing gates.** With `startingGold=false`, a hero made for a
  campaign (the wizard's `?campaign=<id>`) has its gold-only kit options disabled, with the reason
  "Starting gold is off in <campaign> - ask your DM"; kits that contain items stay choosable. The
  multiclassing rule is snapshotted when level-up starts, so a flow finishes as started.
- **Item icons.** `item.added@1.custom.icon` is an `ItemIconRef`, `{kind:'gi', id}` or
  `{kind:'blob', hash}`, validated on read with `ItemIconRefSchema`. An invalid or missing icon
  falls back to the monogram; there is no new event version. The `icon` image is a 128 px blob
  (32 KB cap) that travels in `.hero` bundles and over the blob relay; the hashes it needs are read
  from events.
- **Compatibility (release note).** As with the plan 16 `welcome` field above, a client built
  before this slice ignores `campaign.settings_changed@2` and the three new campaign events (the
  house rules and round counter do not show), and it rejects a `.hero` bundle that carries an item
  icon image, because the bundle manifest's image `kind` is a strict enum that gains `'icon'`.
  Members and the DM should reload to the new build before using these features.

## Ordering and commit rules

- The DO assigns `seq` strictly increasing per stream; `events` frames are always in
  order; a client that detects a gap (`seq != lastSeq + 1`) re-sends `hello` for that
  stream (never guesses). Character streams hold to that check strictly; campaign streams
  tolerate FORWARD seq jumps instead of treating every gap as fatal, since doc-08's
  per-viewer visibility filtering leaves permanent, per-viewer holes in a campaign
  stream's seq numbering that a `hello` re-send can never close — a BACKWARD move stays a
  fatal divergence on both.
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
