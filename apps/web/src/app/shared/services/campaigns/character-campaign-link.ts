import type { CharacterCampaignJoined, Event } from '@hk/protocol';

/**
 * N-pf1 (plan-10 task-7-brief.md's pre-flight note): "how does the CLIENT know a character's
 * current campaign link?" `@hk/engine`'s reducer treats both `character.campaign_joined@1` and
 * `character.campaign_left@1` as `notApplicableSolo` no-ops (`packages/engine/src/reduce/
 * handlers/identity.ts`) — `Facts` never carries a `campaignId` field at all. This is the small
 * client-side helper that fills that gap: a PURE scan (no Angular, no store dependency) of a
 * character's own committed+pending event log for the LAST `character.campaign_joined`/
 * `character.campaign_left` event, returning the linked campaign's bare id (never `camp:`-
 * prefixed — `CharacterCampaignJoinedV1`/`CharacterCampaignLeftV1`'s own `campaignId` field is
 * already bare, `packages/protocol/src/events/character.ts`) or `undefined` when the character has
 * never joined a campaign, or its last relevant event was a `campaign_left`.
 *
 * Named `campaignIdOfCharacter` — NOT the bare `campaignIdOf` the brief's working title uses —
 * because `sync.service.ts` already has an unrelated, unexported, module-private helper of that
 * exact name (bare-id-from-a-`camp:<uuid>`-STREAM-id stripping, a completely different concern).
 * The two never collide at the type-checker level (different modules, neither exported from the
 * other), but sharing a bare name across two genuinely different lookups in the same codebase is
 * exactly the kind of thing a later reader trips over — this name says what it's FOR.
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
export function campaignIdOfCharacter(events: readonly Event[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'character.campaign_joined') {
      return (event.payload as CharacterCampaignJoined).campaignId;
    }
    if (event.type === 'character.campaign_left') {
      return undefined;
    }
  }
  return undefined;
}
