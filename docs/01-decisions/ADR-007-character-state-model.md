# ADR-007 — Character state: append-only event log of decisions

**Status:** Approved 2026-08-30. Depends on ADR-001, ADR-008, ADR-013.

## Context

Level-up history, undo, and "what happened to my character" are core UX. The state must
also converge across devices after offline edits (ADR-001), survive pack updates
(ADR-008), and stay explainable ("why is my AC 17?").

## Options considered

### Mutable snapshot

The character is a JSON document; edits mutate it; history is a list of diffs.

- Pro: simple to render, simple to store.
- Con: history is an afterthought (diffs of derived numbers are meaningless: "AC 16 → 17"
  says nothing about *why*); undo is fragile; concurrent edits need a merge strategy per
  field; a pack update cannot be re-applied because the *decisions* were lost in the
  derived numbers.

### Append-only event log of decisions (chosen)

The character is the ordered list of things that happened: decisions made in the builder,
levels gained, damage taken, items found. State is computed by replaying the log through
a deterministic reducer; the sheet is derived from that state plus the content packs.

- Pro: history, undo, timeline, and audit are the *same feature* as storage.
- Pro: convergence across devices is guaranteed by a total order + deterministic reducer.
- Pro: pack updates re-derive from decisions (ADR-008 rebase).
- Con: reading requires replay — mitigated by snapshots.
- Con: reducers must stay backward-compatible with every past event version, forever.

### CRDT document (Automerge/Yjs)

- Pro: automatic merging, mature libraries.
- Con: history is at the JSON-patch level, not the semantic level; the "what happened"
  UX would still need a parallel semantic log. Heavier dependency. Rejected.

## Decision

### Events record decisions, never derived results

`decision.made {choiceId: "class/fighter@1/fighting-style", selection: ["feat/defense"]}`
— not `ac.bonus +1`. Derived numbers are recomputed by the engine (ADR-013) from decisions
and the pinned content packs; they are never stored in events.

The exception is **in-play state that is itself a fact**: current HP, temp HP, spent
slots, spent resources, conditions with their sources, inventory instances, currency,
notes. These are recorded as deltas (`hp.changed {delta: -7, kind: "damage", source:
"goblin"}`) and folded into *facts* by the reducer.

### Envelope

```
{
  id:      uuid v7 (client-generated; globally unique; time-ordered),
  stream:  "char:<characterId>" | "camp:<campaignId>",
  seq:     integer, assigned by the stream's Durable Object (absent while pending),
  ts:      ISO-8601 client wall clock (display only; never used for ordering),
  actor:   { userId, deviceId, role: "owner" | "dm" | "system" },
  type:    "hp.changed" (dotted, lowercase),
  v:       integer schema version of this event type,
  txId?:   uuid grouping events that must be reverted together (a level-up),
  payload: { ... }   (validated by the shared Zod schema for (type, v))
}
```

Ordering is **by `seq` only**. Pending (unacknowledged) events are applied after all
committed events, in local creation order, and re-applied after commit at their real
position.

### Reducer: `facts = fold(events)`

Pure, total, tolerant. An event that is invalid *given the current facts* (spend a slot
you don't have; equip an item you don't own) is not an error: the reducer records it in
`facts.skipped[]` with a reason and leaves the state unchanged, so replay never throws
and every replica agrees. Validation that *prevents* such events happens in the UI
before emitting (strict mode, ADR-013).

### Snapshots

The client caches `{seq, facts}` every 200 events and after every session; replay starts
from the latest snapshot whose `engineVersion` and event-schema set match. Snapshots are a
cache, never the truth. In v1 the server stores only events; owner-uploaded snapshots for
faster first sync on a new device are a later optimization.

### Undo and corrections

- `event.reverted {targetId}` (or `{txId}` for a group) — the reducer skips the target(s).
  Reverting a revert is allowed. Nothing is deleted.
- Overrides (`override.applied {path, value, reason}`) are events like any other and show
  in the timeline.
- Transactions: a level-up emits one `txId` across `level.gained` + its `decision.made`
  events so "undo level-up" is one action.

### Level-up (the "Baldur's Gate" flow)

- XP mode: `xp.awarded` events accumulate; when `facts.xp ≥ threshold(level+1)` (from the
  system's progression table), the sheet shows "Level up available".
- Milestone mode: the DM emits `level.granted`; same badge.
- The engine computes `pendingAdvancements`: for each level to gain, the class's
  progression row lists granted features and **choices** (subclass at 3, ASI/feat at 4,
  spells known/prepared, fighting style, skills…). The wizard walks the choices in order,
  validates prerequisites live, and emits one transaction. A half-finished wizard emits
  nothing — drafts are UI state only.
- Multiclassing (Phase 4) is the same flow with a "which class" choice first.

### Timeline UX

Every event renders as a human sentence in the current locale (ICU templates keyed by
event type), grouped by session/day, with filters (combat, progression, inventory,
overrides). Each derived number on the sheet links to the events and effects that produced
it (provenance from ADR-013).

## Consequences

- Event types and payloads are a public contract shared by `@hk/protocol`, the engine,
  the server (for permission checks) and export files. Catalog in `02-architecture/02`.
- Reducers keep upcasters for old versions; the engine version is recorded in
  `character.created` and in every snapshot.
- Storage grows linearly with play; a very active character is ~2,000 events/year at
  ~300 B each — negligible.

## Open points

- Whether to compact very old sessions (e.g. collapse 200 `hp.changed` into a summary)
  is deferred; compaction would itself be an event (`history.compacted`) that carries the
  folded facts, so it remains possible without breaking immutability.
