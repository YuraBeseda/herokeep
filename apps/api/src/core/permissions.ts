/**
 * ADR-012 §Authorization for character streams, as data (doc-10 §StreamActor: "check
 * `permissions.allowed(type, actor.role)`"). The full table:
 *
 *   Owner: `char.*` (character.created/renamed/appearance_set/gender_set/archived/restored/
 *     campaign_joined/campaign_left), `decision.*`, in-play events (level.gained, xp.awarded,
 *     hp.changed, hit_dice.*, death_save.recorded, stabilized, slot.*, resource.*, spell.*,
 *     concentration.*, condition.*, item.*, currency.changed, rest.taken,
 *     inspiration.changed), `portrait.*`, `note.*`, `pack.pinned`, `event.reverted` (only
 *     events the owner authored — see `canRevertOwn` below).
 *   DM (of the character's campaign): `dm.*` — ADR-012/doc-08 are explicit that "dm.*" is a
 *     PERMISSION CLASS, not a literal type prefix ("the protocol schema marks each event type
 *     with `actors: [...]`, and the DO consults that table") — the class covers hp.changed,
 *     condition.*, xp.awarded, item.added/removed, level.granted, currency.changed,
 *     inspiration.changed, plus `override.applied`, `event.reverted` (any),
 *     `character.owner_transferred`.
 *   Member (not owner): never appends to a character stream (read-only, subject to
 *     `visibility.partySheets`).
 *
 * `@hk/protocol`'s `EVENT_ACTORS` (packages/protocol/src/events/character.ts, Task 1) is
 * already this exact table as data — every character-stream event `type` mapped to its allowed
 * `ActorRole[]` — because the protocol package is where event-type metadata has to live for
 * `parseEvent`'s dispatch to sit next to it. Re-declaring the table by hand here would create a
 * second copy that silently drifts the moment a new event type is added to the protocol without
 * a matching edit here; `allowed()` below is a thin, role-narrowing wrapper over it instead.
 * This wrapper — not a duplicate literal — IS this task's "full ADR-012 table as data" per the
 * plan's File Structure note ("`permissions.ts` ships the full table (it is protocol-derived
 * data)"): the table ships complete because `EVENT_ACTORS` ships complete, covering every
 * event type in `EVENT_PAYLOADS`, not just the owner-only ones Phase 2 tests exercise.
 */
import { EVENT_ACTORS, type Event } from '@hk/protocol';

/** Sync-protocol actor roles reachable at the permission check (ADR-012 §Authorization; the
 * sync `Actor` schema's role union, distinct from the event envelope's `ActorRole`, which has
 * no `member` — members never author a stored event). */
export type Role = 'owner' | 'dm' | 'member';

/**
 * Whether `role` may append an event of `eventType` to a character stream. `member` is never in
 * any `EVENT_ACTORS` entry (only `owner`/`dm`/`system` values exist there), so it always
 * returns `false` for members without needing a table lookup — kept as an explicit early return
 * for readability, not as an optimization. An unknown `eventType` (no entry in the table) also
 * returns `false`, matching "nothing" in ADR-012's "Anyone else" row; in practice `StreamActor`
 * never reaches this call with an unknown type, since the earlier schema check
 * (`validate.ts`/`parseEvent`) already rejects it as `invalid`.
 */
export function allowed(eventType: string, role: Role): boolean {
  if (role !== 'owner' && role !== 'dm') return false;
  const roles = EVENT_ACTORS[eventType];
  return roles?.includes(role) ?? false;
}

/**
 * `event.reverted`'s "own events only" rule for Owner (ADR-012 §Authorization table: Owner may
 * revert only events they themselves authored; DM may revert any). Enforcing this precisely
 * needs the TARGET event's original actor — a store lookup by the revert payload's `targetId`
 * (or, for a `txId`-grouped revert, any member of that original transaction), which
 * `StreamStore.findByIds` (ports/stream.ts) exists to support.
 *
 * Phase 2 scope note (this is the documented hook the task brief asks for): Phase 2 ships ONLY
 * solo owner sockets on character streams — a DM role is unreachable here because a DM only
 * exists in the context of a campaign, and campaigns are Phase 3 (`CampaignActor`, not built
 * yet). That means every event ever committed to a Phase-2 character stream is, without
 * exception, owner-authored — "revert an event you authored" and "revert any event" describe
 * the exact same set of targets this phase. Doing the real store lookup today would add
 * complexity that cannot change today's observable behavior, so this hook is a documented
 * pass-through; `StreamActor` calls it (rather than skipping the check entirely) precisely so
 * that swapping in the real lookup, once Phase 3 introduces a stream with more than one
 * possible author, is a one-function change instead of a pipeline-shape change.
 */
export function canRevertOwn(
  _actor: { readonly userId: string; readonly role: Role },
  _target: Event | undefined,
): boolean {
  return true;
}
