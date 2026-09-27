import type {
  CharacterCampaignJoined,
  CharacterCampaignLeft,
  CharacterOwnerTransferred,
  Event,
} from '@hk/protocol';

/**
 * N-pf1 (plan-10 task-7-brief.md's pre-flight note): "how does the CLIENT know a character's
 * current campaign link?" `@hk/engine`'s reducer treats both `character.campaign_joined@1` and
 * `character.campaign_left@1` as `notApplicableSolo` no-ops (`packages/engine/src/reduce/
 * handlers/identity.ts`) — `Facts` never carries a `campaignId` field at all. This module is the
 * small client-side helper that fills that gap: a PURE scan (no Angular, no store dependency) of a
 * character's own committed+pending event log for the LAST `character.campaign_joined`/
 * `character.campaign_left` event.
 *
 * Takes a plain `Event[]` (not a `CharacterStore`) so callers never need the character to be the
 * CURRENTLY LOADED stream in `CharacterStore` (which only ever holds one stream at a time) — Task
 * 8's party grid and Task 14's session-gating need this for potentially MANY characters at once,
 * read straight from `EventsRepository.byStream(characterId)`. `CharacterStore.events()` (the
 * currently loaded stream, if any) works here too, structurally — both are `Event[]`.
 *
 * Order-dependent: relies on `events` already being in the stream's natural order (committed rows
 * sorted by `seq`, any still-pending rows after them in `pendingOrder`) — exactly what
 * `EventsRepository.byStream` and `CharacterStore.events()` both already guarantee; this function
 * does no sorting of its own.
 */

/** `lastCampaignLinkEvent`'s result — the LAST `character.campaign_joined`/`campaign_left` event
 * found, whichever type it is, plus whether it has already been server-acked (`seq !== undefined`)
 * or is still a locally-pending write. `campaignId` is always the BARE uuid (never `camp:`-
 * prefixed — `CharacterCampaignJoinedV1`/`CharacterCampaignLeftV1`'s own field is already bare,
 * `packages/protocol/src/events/character.ts`). Fix round 1 (finding 2): exposing `committed` and
 * `eventId` (not just the bare campaignId `campaignIdOfCharacter` returns) is what lets a resume
 * flow verify — via `awaitEventSettled` against this exact `eventId` — that a still-PENDING link
 * event has actually landed before ever building on top of it, instead of assuming a "last event
 * present" match already means "safe to send step (b)".
 */
export interface CampaignLinkEventInfo {
  readonly type: 'character.campaign_joined' | 'character.campaign_left';
  readonly campaignId: string;
  readonly eventId: string;
  readonly committed: boolean;
}

/** The raw scan both `campaignIdOfCharacter` and the resume flows (fix round 1) build on —
 * `undefined` when the character has never touched a campaign link at all. */
export function lastCampaignLinkEvent(events: readonly Event[]): CampaignLinkEventInfo | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'character.campaign_joined') {
      return {
        type: event.type,
        campaignId: (event.payload as CharacterCampaignJoined).campaignId,
        eventId: event.id,
        committed: event.seq !== undefined,
      };
    }
    if (event.type === 'character.campaign_left') {
      return {
        type: event.type,
        campaignId: (event.payload as CharacterCampaignLeft).campaignId,
        eventId: event.id,
        committed: event.seq !== undefined,
      };
    }
  }
  return undefined;
}

/**
 * The linked campaign's bare id, or `undefined` when the character has never joined a campaign, or
 * its last relevant event was a `campaign_left` (regardless of whether that `campaign_left` has
 * been server-acked yet or is still pending — see `lastCampaignLinkEvent` if that distinction
 * matters to a caller).
 *
 * Named `campaignIdOfCharacter` — NOT the bare `campaignIdOf` the brief's working title uses —
 * because `sync.service.ts` already has an unrelated, unexported, module-private helper of that
 * exact name (bare-id-from-a-`camp:<uuid>`-STREAM-id stripping, a completely different concern).
 * The two never collide at the type-checker level (different modules, neither exported from the
 * other), but sharing a bare name across two genuinely different lookups in the same codebase is
 * exactly the kind of thing a later reader trips over — this name says what it's FOR.
 */
export function campaignIdOfCharacter(events: readonly Event[]): string | undefined {
  const last = lastCampaignLinkEvent(events);
  return last?.type === 'character.campaign_joined' ? last.campaignId : undefined;
}

/**
 * Plan-10 Task 12: "who currently owns this character?" — mirrors `campaignIdOfCharacter`'s own
 * finding exactly (`packages/engine/src/reduce/handlers/identity.ts`: `character.owner_transferred`
 * is ALSO `notApplicableSolo` — `Facts` never carries an `ownerId` field either). A pure, backward
 * scan for the LAST event that establishes ownership: `character.owner_transferred`'s own
 * `toUserId` payload field, or — if none has ever committed — `character.created`'s SESSION-VERIFIED
 * `actor.userId` (the server stamps this, never trusting a client-sent `actor` field for anything
 * ownership-relevant — `character-actor.ts`'s own header comment). Returns `undefined` only for an
 * empty event list (a character with no `character.created` at all is not reachable in practice —
 * same "not assumed away" stance `CharacterMeta`'s own doc comment takes server-side).
 */
export function currentOwnerIdOf(events: readonly Event[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'character.owner_transferred') {
      return (event.payload as CharacterOwnerTransferred).toUserId;
    }
    if (event.type === 'character.created') {
      return event.actor.userId;
    }
  }
  return undefined;
}
