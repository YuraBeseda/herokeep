# ADR-001 — Topology: local-first replicas + thin authoritative sync core

**Status:** Approved 2026-08-30. Everything else in this plan depends on this decision.

## Context

The app is used at a table on unreliable wifi, on phones, tablets and laptops. Budget is
zero. Images must never be persisted on project infrastructure. The owner's original
candidate was "pure local-first": the DM's browser holds the session state and the server
is only a signaling/relay bridge. During planning the owner permitted the server to hold
*small, non-image* data (character/campaign JSON under a quota) tied to lightweight
accounts. That permission changes the answer.

## Options considered

### A. Pure local-first, host-authoritative

The DM's browser is the sequencer and the holder of truth for the session; players hold
their own characters; the server is a stateless relay (or WebRTC signaling).

- Pro: nothing but lobby codes ever lives on the server; matches the original vision.
- Con: the DM's device is a single point of failure mid-session (tab closed, laptop dies,
  phone locks → everyone stalls).
- Con: **two** sync protocols are needed — one for live play (relay) and one for backup
  (server), each with its own reconciliation rules.
- Con: host-offline edge cases everywhere: queued player edits, host handoff, "who is
  authoritative after both sides changed", the DM's stale copy after a player levels up at
  home.
- Con: recovery of a lost character depends on the DM being online with a copy.

### B. Conventional client/server

The server holds all state; browsers are thin clients that render server responses.

- Pro: simplest mental model; trivially consistent; well-understood.
- Con: nothing works when the wifi drops; solo mode needs a server round-trip for every
  change; the app degrades to a spreadsheet with a spinner at exactly the moment it matters.
- Con: images would naturally be uploaded to the server — violating a fixed constraint —
  and bolting on "images stay on devices" makes it a hybrid anyway.

### C. Local-first replicas + thin authoritative sync core (chosen)

Every device keeps a full local replica of the streams it cares about and works offline
against it. The *canonical* event streams — one per character, one per campaign — live in
Cloudflare Durable Objects (SQLite-backed, on the free plan). A Durable Object assigns
sequence numbers, stores events, enforces permissions and quotas, and fans events out to
every connected device. Images are never stored server-side; they move device-to-device
through the DO in memory only (ADR-010).

- Pro: one sync protocol serves live play, cross-device sync and backup.
- Pro: the DM is a *role* with permissions, not a network topology. A DM can rejoin from
  a phone if the laptop dies; the session continues without any device.
- Pro: reconnection is "send me everything after sequence N" — the simplest possible
  resumption, exactly what flaky wifi needs.
- Pro: three copies of every character exist by construction: the player's device, the
  DM's device (as a campaign member), and the server. "My character vanished" becomes a
  restore, not a loss (ADR-003).
- Pro: offline edits are queued locally and committed in arrival order when back online;
  the deterministic reducer (ADR-007) makes every replica converge.
- Con: session data (small JSON, quota-capped) lives on project infrastructure. Permitted
  by the owner; mitigated by quotas, export, and the absence of any personal data beyond a
  username (ADR-012).
- Con: dependency on Cloudflare's free plan. Mitigated by writing the backend core against
  runtime ports with a second, conformance-tested Node + SQLite adapter for self-hosting
  (ADR-014), and by the fact that every device holds full replicas and can export.

## Trade-offs summary

| | A. Host-authoritative | B. Client/server | C. Replicas + sync core |
|---|---|---|---|
| Works offline at the table | partly (host must be up) | no | yes |
| DM device dies mid-session | session stalls | fine | fine |
| Sync protocols to build | 2 | 1 (request/response) | 1 |
| Images off the server | yes | needs bolt-on | yes |
| Server holds game data | no | all | small JSON, quota-capped |
| Recovery of lost character | via DM copy or file | server | server, DM copy, or file |
| Complexity of edge cases | high | low | medium |

## Decision

Option **C**. Concretely:

- **Streams**: `CharacterStream` (one per character) and `CampaignStream` (one per
  campaign). Each is a Durable Object holding an append-only, sequence-numbered event log.
- **Contexts**: a client opens one WebSocket per context. *Solo context* connects directly
  to a `CharacterStream`. *Campaign context* connects to the `CampaignStream`, which acts
  as the session gateway and forwards character events to the relevant `CharacterStream`
  (DO-to-DO call), which then notifies the campaign so every member sees the change.
- **Authority**: the DO is the sequencer and permission checker. It never runs the rules
  engine (it validates envelope shape, size and who-may-append-what). Clients apply events
  optimistically, then reconcile to the server order.
- **Replicas**: every device stores its streams in IndexedDB (Dexie), with cached
  snapshots. Solo mode without an account works entirely locally; logging in later uploads
  the local streams.

## Consequences

- The "host PC" is now simply the DM's device: it holds a full replica of the campaign and
  all member characters (so it is also a backup) and acts as the image super-peer
  (ADR-010), but nothing depends on it being online.
- "Editing between sessions" is possible for free; it becomes a per-campaign DM setting.
- The server needs accounts (ADR-012) because streams have owners and campaigns have
  members.
- The event catalog and envelope (02-architecture/02) must be designed so that the server
  can authorize by *type and actor* without understanding game semantics.
- A WebRTC LAN fast-path can be added later as a transport optimization (ADR-002) without
  changing the model, because the DO remains the sequencer.

## Open points

- Free-plan budget math is in `02-architecture/08-security-permissions-quotas.md`; if
  usage ever exceeds it, the Workers Paid plan is $5/month — the only foreseeable cost.
- Whether Cloudflare's free plan requires a credit card was not confirmed on an official
  page (see `04-reference/open-questions.md`).
