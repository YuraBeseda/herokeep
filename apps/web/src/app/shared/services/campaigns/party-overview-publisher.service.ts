import { inject, Injectable, InjectionToken } from '@angular/core';
import type { DraftEvent } from '@shared/stores/character.store';
import { CharacterStore } from '@shared/stores/character.store';
import { CampaignStore } from '@shared/stores/campaign.store';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SyncService } from '@shared/services/sync/sync.service';
import { bareCharacterId } from './campaign-link-sequence';
import { campaignIdOfCharacter } from './character-campaign-link';
import { projectCampaign } from './campaign-projection';
import { deriveOverview, overviewsEqual } from './party-overview';

/** Trailing debounce window (ruling 8, plan-10 task-8-brief.md: "debounced ≥5 s"). DI seam over
 * the literal so `party-overview-publisher.service.spec.ts` can override it to a small REAL
 * duration — same "no `vi.useFakeTimers()`" posture `CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS`
 * (`campaign.store.ts`) documents: fake timers starve real fake-indexeddb microtask scheduling.
 * Production code never overrides this — the factory default IS the real 5 s value. */
export const PARTY_OVERVIEW_PUBLISH_DEBOUNCE_MS = new InjectionToken<number>(
  'PARTY_OVERVIEW_PUBLISH_DEBOUNCE_MS',
  { factory: () => 5_000 },
);

/**
 * Ruling 8 (plan-10 task-8-brief.md, verbatim): "after each committed local append on a
 * campaign-linked character, the owning device derives `PartyOverviewUpdatedV1['overview']` from
 * the Sheet ... and appends `party.overview_updated` to the campaign stream, debounced ≥5 s and
 * skipped when unchanged (deep-equal)."
 *
 * ## Where this hook lives, and what triggers it
 *
 * `CharacterStore.onLocalAppend(cb)` (plan-8) is the ONLY seam that fires "after a committed
 * local append" in the sense ruling 8 means: it fires once `appendTx`/`revert`'s pending-write
 * branch has durably written to storage AND `applyAppended` has already recomputed `facts`/
 * `sheet` (`character.store.ts`'s own ordering contract) — reading `characterStore.sheet()`
 * synchronously inside this callback (or, as here, after a debounce delay) always sees the
 * POST-append Sheet, never a stale one. This only fires for a stream currently in
 * `enterSyncMode` (a syncing character) — a solo/offline character never publishes, which is
 * correct: ruling 8's OTHER gate ("a campaign session is open") could never pass for one anyway
 * (no live socket exists for an unauthenticated/offline device to publish over).
 *
 * `CampaignStore` has no equivalent "committed campaign append" concept to layer this on top
 * of — nor should it: the party overview is a property of the CHARACTER's own facts, derived
 * once per character commit, not once per campaign commit.
 *
 * ## Debounce + deep-equal (ruling 8)
 *
 * One `setTimeout` per character streamId (trailing debounce — a NEW committed append within the
 * window resets the timer rather than queuing a second publish), so a burst of rapid edits (e.g.
 * several HP taps) collapses into ONE publish reflecting the state ≥`PARTY_OVERVIEW_PUBLISH_
 * DEBOUNCE_MS` after the LAST one. When the timer fires, the overview is derived fresh (never a
 * snapshot taken at schedule time) and compared (`overviewsEqual`) against whatever this
 * character's campaign stream ALREADY has for it (`projectCampaign(...).overviews.get(...)`, read
 * directly via `EventsRepository` — never through `CampaignStore.state()`, which only reflects
 * whichever campaign is currently OPEN for viewing, almost certainly not this one). An unchanged
 * result is skipped outright — no event is appended.
 *
 * ## Why `CampaignStore.appendToStream`, not `appendTx`
 *
 * This runs in the background, independent of whatever campaign page (if any) is open in this
 * tab — the character sheet a player is editing has no necessary relationship to whichever
 * campaign `CampaignStore` currently has "open" for viewing (it could be a DIFFERENT campaign, or
 * none at all). `CampaignStore.appendTx` always targets `this.streamId()` and would silently
 * reroute that OTHER campaign's live view out from under whoever is looking at it — see
 * `appendToStream`'s own class doc (added by this task) for the full reasoning. This publisher is
 * the reason that method exists.
 *
 * ## The post-link initial publish (a judgment call, not a special case)
 *
 * task-8-brief.md's own text raises whether an initial publish is needed right after a successful
 * join, "so the party isn't empty until the next edit." No special-casing was added for this: a
 * successful join's step (a) — `character.campaign_joined` — is ITSELF a committed local append
 * on the character stream (`campaign-link-sequence.ts`'s `runCampaignLinkSequence`, via the
 * character `AppendablePort`'s `appendTx`), so it fires `onLocalAppend` through the exact same
 * path as any other character edit. Once step (a) commits, `campaignIdOfCharacter` immediately
 * returns the just-linked campaign id — the general mechanism below publishes the character's
 * CURRENT sheet state as the party's first overview for it, automatically, ≥`DEBOUNCE_MS` later.
 * The one open edge case: if the campaign's live session hasn't started yet by the time the
 * debounce timer fires (a race with `SyncService`'s own reactive session-start effect), this
 * publish attempt is silently skipped — the NEXT edit's own debounce window will publish
 * successfully once the session catches up. Not specifically tested (a timing race), flagged here
 * rather than silently ignored.
 *
 * ## Failure handling
 *
 * A failed `appendToStream` call (not the leader, not authenticated, a schema-validation reject —
 * e.g. a not-yet-built level-0 character, guarded against separately below) is swallowed, not
 * surfaced: this is a best-effort background sync with no user-facing action to retry or dismiss,
 * and the NEXT committed local append's own debounce window will simply try again with fresh
 * data. Scope guard: this file never toasts, never touches DM-only concerns (T11), never builds
 * subscribe/drill-in UI (T9).
 */
@Injectable({ providedIn: 'root' })
export class PartyOverviewPublisherService {
  private readonly characterStore = inject(CharacterStore);
  private readonly campaignStore = inject(CampaignStore);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly syncService = inject(SyncService);
  private readonly debounceMs = inject(PARTY_OVERVIEW_PUBLISH_DEBOUNCE_MS);

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.characterStore.onLocalAppend((streamId) => this.schedule(streamId));
  }

  private schedule(streamId: string): void {
    const existing = this.timers.get(streamId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(streamId);
      void this.publishNow(streamId);
    }, this.debounceMs);
    this.timers.set(streamId, timer);
  }

  private async publishNow(streamId: string): Promise<void> {
    // Ruling 8's SECOND gate half — "only when the character's campaignId is set". The FIRST
    // gate half, "and a campaign session is open", is checked below via `SyncService.syncState`.
    if (this.characterStore.streamId() !== streamId) return; // moved on to a different character
    const events = this.characterStore.events();
    const campaignId = campaignIdOfCharacter(events);
    if (!campaignId) return;

    const campaignStreamId = `camp:${campaignId}`;
    if (this.syncService.syncState(campaignStreamId)() === 'offline') return;

    const sheet = this.characterStore.sheet();
    // `PartyOverviewUpdatedV1.overview.level` requires 1..20 — a character with no class chosen
    // yet (level 0, mid-creation-wizard) has no schema-valid overview to report at all.
    if (!sheet || sheet.level < 1) return;

    const portraitThumb = this.characterStore.facts()?.portrait?.thumbHash;
    const overview = deriveOverview(sheet, portraitThumb);

    const campaignEvents = await this.eventsRepository.byStream(campaignStreamId);
    const characterId = bareCharacterId(streamId);
    const existingOverview = projectCampaign(campaignEvents).overviews.get(characterId);
    if (existingOverview && overviewsEqual(existingOverview, overview)) return;

    const draft: DraftEvent = {
      type: 'party.overview_updated',
      v: 1,
      payload: { characterId, overview },
    };
    try {
      await this.campaignStore.appendToStream(campaignStreamId, [draft]);
    } catch {
      // Best-effort background publish — see class doc's "Failure handling" section.
    }
  }
}
