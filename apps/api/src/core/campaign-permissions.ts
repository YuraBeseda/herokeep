/**
 * ADR-012/doc-08 §Authorization for CAMPAIGN streams — the half `core/permissions.ts`'s own
 * header comment explicitly defers here ("the campaign-stream half of the authorization matrix
 * lives in `CampaignActor` (Phase 3, plan-9), not here"). `@hk/protocol`'s `EVENT_ACTORS` is the
 * MERGED character+campaign table (`packages/protocol/src/events/index.ts`); this module's
 * `allowed()` is a role check straight against it, deliberately WITHOUT `core/permissions.ts`'s
 * own early `if (role !== 'owner' && role !== 'dm') return false` short-circuit — that early
 * return is CHARACTER-stream-specific (no character-stream `EVENT_ACTORS` row ever grants
 * `'member'`, so the early return is a documented optimization/readability choice there, not a
 * behavior difference). Campaign-stream rows legitimately DO grant `'member'` (`roll.logged`,
 * `chat.message`, `member.renamed`, own `campaign.character_joined/left`, `party.overview_updated`
 * per doc-08's rows quoted in `campaign.ts`), so reusing `core/permissions.ts`'s `allowed()` here
 * would incorrectly forbid EVERY member-authored campaign event with the SAME reject code a truly
 * forbidden one gets — a silent, hard-to-notice correctness bug, not a type error, since both
 * modules structurally satisfy `stream-actor.ts`'s `PermissionsPort` interface identically.
 *
 * Safety argument for why a simple merged-table lookup is correct here (no character-only type
 * can slip through and be misread as campaign-authorized): `core/validate.ts`'s stream-binding
 * guard (plan-9 Task 2, T2 obligation (b), `EVENT_STREAM_KIND`) rejects a character-only type
 * reaching a `camp:` stream — with reject code `invalid`, BEFORE `permissions.allowed` is ever
 * called — earlier in `StreamActor.append`'s pipeline than this function ever runs.
 */
import { EVENT_ACTORS, type Event } from '@hk/protocol';
import type { Role } from './permissions.ts';

export type { Role };

/**
 * Whether `role` may append an event of `eventType` to a CAMPAIGN stream — `CampaignActor`'s
 * `PermissionsPort` implementation (`stream-actor.ts`'s injected dependency), used exactly like
 * `core/permissions.ts`'s `allowed()` is used by `CharacterActor`. Per-append refinements the
 * static table can't express (a `member` actor who isn't actually THIS campaign's member; a `dm`
 * actor who isn't THIS campaign's `dmId`; character-ownership checks for
 * `campaign.character_joined/left`/`party.overview_updated`) live in `CampaignActor.append`
 * itself, layered ON TOP of this static check — see that file's `refineAppendPermission`.
 */
export function allowed(eventType: string, role: Role): boolean {
  const roles = EVENT_ACTORS[eventType];
  return roles?.includes(role) ?? false;
}

/**
 * `event.reverted` is not a registered campaign-stream event type at all (`CAMPAIGN_EVENT_PAYLOADS`
 * in `campaign.ts` has no entry for it) — `core/validate.ts`'s stream-binding guard rejects it,
 * code `invalid`, before any campaign-stream permission check runs, so this hook is unreachable
 * in practice on a campaign stream. Kept only so this module satisfies `PermissionsPort`'s full
 * shape (`stream-actor.ts`), matching `core/permissions.ts`'s own `canRevertOwn` signature.
 */
export function canRevertOwn(
  _actor: { readonly userId: string; readonly role: Role },
  _target: Event | undefined,
): boolean {
  return true;
}
