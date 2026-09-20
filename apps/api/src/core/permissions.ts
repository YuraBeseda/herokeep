/**
 * ADR-012/doc-08 §Authorization for CHARACTER streams, as data (doc-10 §StreamActor: "check
 * `permissions.allowed(type, actor.role)`"). This module is character-stream-scoped only — the
 * campaign-stream half of the authorization matrix lives in `CampaignActor` (Phase 3, plan-9),
 * not here. Plan-9 Task 2 audited every character-stream `EVENT_ACTORS` entry that grants `dm`
 * against doc-08/doc-02/ADR-012 verbatim; the full per-entry citations (including the two
 * genuinely-ambiguous OWNER-FLAGged groups) live in `@hk/protocol`'s
 * `packages/protocol/src/events/character.ts` (the table itself) and
 * `packages/protocol/test/character-actor-audit.test.ts` (one test per citation) — not
 * duplicated a third time here. Summary, POST-audit:
 *
 *   Owner: `char.*` (character.created/appearance_set/gender_set/archived/restored,
 *     `character.renamed` — DM edits only via `override.applied`, corrected by the audit),
 *     `character.owner_transferred`/`campaign_joined`/`campaign_left` (also DM), `decision.*`,
 *     most in-play events (level.gained, hit_dice.*, slot.*, spell.*, item.equipped/unequipped/
 *     attuned/unattuned/updated, rest.taken), `portrait.*`, `note.*`, `pack.pinned`,
 *     `event.reverted` (only events the owner authored — see `canRevertOwn` below).
 *   DM (of the character's campaign): the doc-08-row-3 dm.*-class — ADR-012/doc-08 are explicit
 *     that "dm.*" is a PERMISSION CLASS, not a literal type prefix ("the protocol schema marks
 *     each event type with `actors: [...]`, and the DO consults that table") — covering
 *     hp.changed, condition.*, xp.awarded, item.added/removed, currency.changed,
 *     inspiration.changed (`level.granted` is the one dm.*-class type the audit found doc-02
 *     withholds Owner from even in solo play — kept dm-only, OWNER-FLAGged), plus
 *     `override.applied`, `event.reverted` (any), `character.owner_transferred`,
 *     `character.campaign_joined`/`campaign_left` (doc-02 line, no doc-08 row). Also dm-granted
 *     but OWNER-FLAGged by the audit (doc-08's "in-play" bucket vs doc-02's unqualified "O, D"
 *     textually conflict): `death_save.recorded`, `stabilized`, `resource.spent`/`restored`,
 *     `concentration.started`/`ended`.
 *   Member (not owner, not this campaign's DM): never appends to a CHARACTER stream (read-only,
 *     subject to `visibility.partySheets`) — see `allowed()` below. A campaign MEMBER can and
 *     does author events directly on the CAMPAIGN stream (`roll.logged`, `chat.message`,
 *     `member.renamed`, own `campaign.character_joined/left`, per doc-08's campaign rows) — that
 *     is a different stream and a different actor table (`CampaignActor`'s, not this module's);
 *     "members never author" below is scoped to character streams specifically.
 *
 * `@hk/protocol`'s `EVENT_ACTORS` (packages/protocol/src/events/index.ts) is the MERGED
 * character+campaign table (character.ts's own table, Task 1's campaign.ts table layered on
 * top) — because the protocol package is where event-type metadata has to live for
 * `parseEvent`'s dispatch to sit next to it, and one flat table is what a "does this type exist,
 * and who may author it" lookup needs. That merge is exactly why this module's `allowed()` alone
 * cannot reject a campaign-only type reaching a character-stream permission check (it has a
 * real, non-empty actor list in the merged table) — `core/validate.ts`'s stream-binding guard
 * (plan-9 Task 2, T2 obligation (b)) closes that gap earlier in the pipeline, before `allowed()`
 * is ever called. `allowed()` below is a thin, role-narrowing wrapper over `EVENT_ACTORS` — not
 * a hand-duplicated second copy of the table that could drift from the protocol package.
 */
import { EVENT_ACTORS, type Event } from '@hk/protocol';

/** Sync-protocol actor roles reachable at the permission check (ADR-012 §Authorization; the
 * sync `Actor` schema's role union). Distinct from the event envelope's `ActorRole`
 * (`owner|dm|system|member`) only in that `Role` excludes `system` — no sync-protocol actor is
 * ever stamped as the internal `system` role. Plan-9 Task 1 widened `ActorRoleSchema` to add
 * `member` for campaign-stream events, so the two are no longer distinguished by whether
 * `member` exists at all; on a CHARACTER stream specifically, `member` still never authors a
 * stored event (see `allowed()`'s early return below) — that scoping matters now that
 * `EVENT_ACTORS` (imported below) is the merged character+campaign table, and campaign-stream
 * types DO grant `member` in it. */
export type Role = 'owner' | 'dm' | 'member';

/**
 * Whether `role` may append an event of `eventType` to a CHARACTER stream. No CHARACTER-stream
 * `EVENT_ACTORS` entry (packages/protocol/src/events/character.ts) ever grants `member` — only
 * `owner`/`dm` values exist there (campaign-stream types in the same MERGED `EVENT_ACTORS` table
 * do grant `member`, but this function is only ever called from a character-stream actor's
 * pipeline, after `core/validate.ts`'s stream-binding guard has already rejected any
 * campaign-only type that reached here) — so `member` always returns `false` without needing a
 * table lookup, kept as an explicit early return for readability, not as an optimization. An
 * unknown `eventType` (no entry in the table) also returns `false`, matching "nothing" in
 * ADR-012's "Anyone else" row; in practice `StreamActor` never reaches this call with an unknown
 * type, since the earlier schema check (`validate.ts`/`parseEvent`) already rejects it as
 * `invalid`.
 */
export function allowed(eventType: string, role: Role): boolean {
  if (role !== 'owner' && role !== 'dm') return false;
  const roles = EVENT_ACTORS[eventType];
  return roles?.includes(role) ?? false;
}

/**
 * `event.reverted`'s "own events only" rule for Owner — ADR-012 §Authorization table, verbatim:
 * "Owner | ... `event.reverted` (only events the owner authored) | ..." / "DM of the character's
 * campaign | ... `event.reverted` (any) | ...". doc-08's matrix row states the same thing in the
 * compact form `EVENT_ACTORS` mirrors: `event.reverted | own events | any | ✖ | ✖`.
 *
 * [final whole-branch review, Important — THIS is the real implementation; Phase 2 shipped this
 * as a documented pass-through stub with ZERO call sites, safe ONLY because Phase 2 had no DM
 * role reachable on a character stream at all (every committed event was, without exception,
 * owner-authored, so "revert your own" and "revert anything" were the same set of targets).
 * Plan-9 made multi-author character streams REAL: `CampaignActor`'s gateway forwards genuine
 * `dm`-role commits (`hp.changed`, `override.applied`, etc.) onto a character stream via
 * `Rpc.forwardAppend` — so an owner could otherwise `event.reverted` a DM-authored event and have
 * it commit, a live ADR-012 violation. `StreamActor.append` (`stream-actor.ts`) now wires this in
 * for real, resolving the target via its OWN `resolveRevertTarget` (the Stage-0 batched
 * `findByIds` lookup this doc comment originally anticipated) BEFORE calling here — see that
 * method's doc comment for the full resolution rules, including WHY a same-batch target needs no
 * special-casing (provably always the reverting actor's own, by construction) and the disclosed
 * `txId`-only cross-batch gap (`StreamStore` has no "find by `txId`" query; out of this fix's
 * scope, `targetId` — the common case and everything red-first-tested — is fully enforced).]
 *
 * `target === undefined` (an unresolvable target — a genuinely nonexistent `targetId`, or the
 * disclosed cross-batch `txId` gap above) FAILS OPEN, matching `@hk/engine`'s own reducer
 * behavior for a revert target it can't find: "fails silently rather than erroring"
 * (`packages/engine/src/reduce/reducer.ts`'s `preScanReverted` doc comment) — reverting nothing
 * resolvable is harmless, not a privilege escalation, so there is nothing here to forbid.
 */
export function canRevertOwn(
  actor: { readonly userId: string; readonly role: Role },
  target: Event | undefined,
): boolean {
  if (actor.role === 'dm') return true; // ADR-012: DM may revert any event
  if (target === undefined) return true; // unresolvable target — see doc comment above
  return target.actor.userId === actor.userId; // ADR-012: Owner may revert only events they authored
}
