import {
  computed,
  effect,
  inject,
  Injectable,
  InjectionToken,
  resource,
  signal,
  type Signal,
} from '@angular/core';
import type { Event } from '@hk/protocol';
import { AuthService } from '../auth/auth.service';
import { EventsRepository } from '../storage/events.repository';
import { projectCampaign, type CampaignState } from './campaign-projection';
import { campaignIdOfCharacter } from './character-campaign-link';

/** `'dmApprovalV1'` is the DISTINCT mode ruling 7 asks for when `houseRules.editOutsideSession ===
 * 'dmApproval'` — v1 renders it identically to a flat `'locked'` (see `campaignEditLockFromState`'s
 * own OWNER-FLAG comment: no approval-queue workflow exists yet), but the member still sees a
 * DIFFERENT explanatory banner key (`campaigns.edit.dmApprovalV1` vs `campaigns.edit.locked`) so
 * they aren't told "locked" when their DM's house rule actually promises an approval path — just
 * not one this app can act on yet. */
export type CampaignEditLockMode = 'locked' | 'dmApprovalV1';

export interface CampaignEditLockState {
  readonly locked: boolean;
  readonly mode?: CampaignEditLockMode;
}

const NOT_LOCKED: CampaignEditLockState = { locked: false };

/**
 * Ruling 7 (Edit-outside-session), pure projection half — the campaign STATE + acting userId in,
 * a lock verdict out. Exported standalone (no Angular/DI/resource machinery) so the full matrix
 * (`editOutsideSession` value x `session.active` x role member/DM/solo) is testable directly; see
 * `CampaignEditLockService.editLockFor` for the reactive, cross-stream READ half this is combined
 * with in the app (task-14-brief.md: "settings live in the campaign STATE, which needs the
 * campaign's events").
 *
 * `state: null` means "no campaign context at all" — either a genuinely solo (never-linked)
 * character, or a linked character whose campaign events haven't synced down/loaded yet. Both
 * FAIL OPEN (never locked) — same "no settings document posted yet -> 'free'" default convention
 * `campaign-settings.component.ts`/`log-tab.component.ts`'s own visibility pickers already use
 * elsewhere in this codebase, applied here to the whole lock question: a sheet never blocks the
 * player on a lock verdict this device can't yet substantiate.
 */
export function campaignEditLockFromState(
  state: CampaignState | null,
  userId: string | undefined,
): CampaignEditLockState {
  if (!state) return NOT_LOCKED;
  // DM exempt (ruling 7: "the DM's OWN linked character is never locked") — checked BEFORE the
  // house rule at all, so a DM never sees a lock banner on their own sheet regardless of the
  // campaign's settings. `userId === undefined` (no signed-in user resolved yet) can never match a
  // real member row, so it correctly falls through to the ordinary-member path below rather than
  // being treated as exempt.
  if (userId !== undefined && state.members.get(userId)?.role === 'dm') return NOT_LOCKED;

  const rule = state.settings?.houseRules.editOutsideSession ?? 'free';
  if (rule === 'free') return NOT_LOCKED;
  if (state.session.active) return NOT_LOCKED;

  // OWNER-FLAG (task-14-brief.md ruling 7): `dmApproval` has NO approval-queue workflow in v1 — it
  // renders exactly like `locked` (the member's mutating actions are disabled the same way), the
  // ONLY difference being the distinct `mode` value below, which the banner uses to show a
  // different explanatory key (`campaigns.edit.dmApprovalV1`) instead of silently mislabeling this
  // as a flat lockout. A future task adding a real DM-approval request/response flow should extend
  // this branch (e.g. a per-request override), not remove the distinct `mode`.
  return { locked: true, mode: rule === 'dmApproval' ? 'dmApprovalV1' : 'locked' };
}

const DEFAULT_POLL_MS = 15_000;

/** DI seam over the poll interval below (mirrors `CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS`'s own pattern,
 * `campaign.store.ts`) — production code never overrides this; specs override it to a small real
 * duration. */
export const CAMPAIGN_EDIT_LOCK_POLL_INTERVAL_MS = new InjectionToken<number>(
  'CAMPAIGN_EDIT_LOCK_POLL_INTERVAL_MS',
  { factory: () => DEFAULT_POLL_MS },
);

/**
 * The reactive, cross-stream READ half of ruling 7 (task-14-brief.md's own design ruling): a
 * member's play/build tab needs to know whether EDITING IS CURRENTLY LOCKED for a campaign that is
 * almost certainly NOT the one `CampaignStore` has open right now (`CampaignStore.state` only ever
 * reflects whichever campaign a `/g/:id` route happens to have open for VIEWING elsewhere — the
 * exact "not necessarily this character's own campaign" situation `PartyOverviewPublisherService`
 * (Task 8) and `PlayTabComponent.campaignRollSettings` (Task 10) already document and solve the
 * same way: read the OTHER campaign's own events straight from local storage via
 * `EventsRepository.byStream` + `projectCampaign`, never through the single "open" `CampaignStore`
 * slot).
 *
 * ## Staleness bounds (documented per task-14-brief.md's "design honestly" instruction)
 *
 * This device's leader tab runs an always-on `StreamSyncSession` for EVERY campaign in this
 * account's index (T5 ruling), so the linked campaign's OWN events (including a `session.started`
 * a DM fires from a DIFFERENT device) land in this device's local `EventsRepository` rows on their
 * own, live — but there is no reactive signal anywhere that announces "camp:<id>'s events just
 * changed" to an arbitrary listener outside `CampaignStore`'s own single open-stream slot (that
 * store's `applyServerCommit` hook is not reachable here for a campaign this tab never opens). Two
 * recompute triggers are used instead, both deliberately cheap (`EventsRepository.byStream` is a
 * local IndexedDB read, not a network call):
 *
 * 1. Whenever `characterEvents()` changes (a fresh `character.campaign_joined` commit, or the
 *    hosting sheet switching to a different loaded character) — immediate, via `resource()`'s own
 *    `params` reactivity.
 * 2. A bounded poll (`CAMPAIGN_EDIT_LOCK_POLL_INTERVAL_MS`, default 15s) that re-reads the SAME
 *    stream's events while a campaign link is resolved, so a session started on another device (or
 *    ended, or a house-rule change) unlocks (or locks) this sheet within one poll interval even if
 *    the player never navigates away or refocuses the tab. The poll runs only while a campaign
 *    link is resolved (`streamId() !== undefined`) and stops (interval cleared) the moment it
 *    isn't, or when the hosting component is destroyed (`effect()`'s own injector-scoped cleanup —
 *    see its call below).
 *
 * This is an honest v1 trade-off, not the two options task-14-brief.md names outright ("hook into
 * `applyServerCommit`, or poll-on-focus"): hooking `applyServerCommit` is structurally unavailable
 * for a stream this tab never opens (as the brief's own "PROBLEM" paragraph concludes), and a
 * PLAIN bounded poll (rather than a `visibilitychange`/`focus` listener) was chosen over
 * poll-on-focus so a player who never backgrounds the tab still unlocks within a bounded, testable
 * window — the existing `ReconnectSignals` class (`services/sync/reconnect-signals.ts`) exists for
 * an analogous purpose but is deliberately NOT reused here, since wiring a second consumer onto a
 * global DOM listener for a single low-frequency UI concern is a bigger surface than one
 * `setInterval` scoped to this signal's own lifetime.
 */
@Injectable({ providedIn: 'root' })
export class CampaignEditLockService {
  private readonly eventsRepository = inject(EventsRepository);
  private readonly authService = inject(AuthService);
  private readonly pollMs = inject(CAMPAIGN_EDIT_LOCK_POLL_INTERVAL_MS);

  /** Must be called from within an injection context (a component's own field initializer/
   * constructor, or `runInInjectionContext`) — the `effect()`/`resource()` it creates attach to
   * THAT context, so they're torn down automatically alongside whatever calls this (e.g. a
   * `PlayTabComponent`/`BuildTabComponent` instance), not this service's own root lifetime. */
  editLockFor(characterEvents: Signal<readonly Event[]>): Signal<CampaignEditLockState> {
    const streamId = computed<string | undefined>(() => {
      const campaignId = campaignIdOfCharacter(characterEvents());
      return campaignId ? `camp:${campaignId}` : undefined;
    });

    const pollTick = signal(0);
    let timer: ReturnType<typeof setInterval> | undefined;
    effect((onCleanup) => {
      const id = streamId();
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      if (id === undefined) return;
      timer = setInterval(() => pollTick.update((n) => n + 1), this.pollMs);
      onCleanup(() => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      });
    });

    const campaignEvents = resource({
      params: () => {
        const id = streamId();
        // A fresh object every tick (even for the SAME `id`) is deliberate — `resource()` refetches
        // whenever `params()` fails reference equality against its previous value, which a plain
        // repeated primitive would never do on its own; this is what makes the poll trigger #2
        // above actually cause a refetch.
        return id === undefined ? undefined : { id, tick: pollTick() };
      },
      loader: async ({ params }) =>
        params === undefined ? [] : await this.eventsRepository.byStream(params.id),
    });

    return computed<CampaignEditLockState>(() => {
      if (streamId() === undefined) return campaignEditLockFromState(null, undefined);
      const events = campaignEvents.value();
      const state = events === undefined ? null : projectCampaign(events);
      return campaignEditLockFromState(state, this.authService.user()?.userId);
    });
  }
}
