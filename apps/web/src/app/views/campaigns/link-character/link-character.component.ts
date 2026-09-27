import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@shared/services/auth/auth.service';
import {
  bareCharacterId,
  runCampaignLinkSequence,
  retryCampaignLinkStepB,
  type CampaignLinkAction,
  type CampaignLinkParams,
  type CampaignLinkStepResult,
} from '@shared/services/campaigns/campaign-link-sequence';
import {
  lastCampaignLinkEvent,
  type CampaignLinkEventInfo,
} from '@shared/services/campaigns/character-campaign-link';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SyncService } from '@shared/services/sync/sync.service';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';

type SyncBucket = 'synced' | 'pending' | 'connecting' | 'offline';
type Eligibility = 'eligible' | 'resume' | 'resumeLeave' | 'linkedElsewhere' | 'notSynced';

interface Candidate {
  readonly row: CharacterRow;
  /** `lastCampaignLinkEvent`'s result, snapshotted at load time (see class doc for why this is a
   * one-time read rather than a live signal) — `undefined` for a character that has never touched
   * a campaign link at all. */
  readonly linkInfo: CampaignLinkEventInfo | undefined;
}

/**
 * [plan-10 Task 12] Ruling 6's claim flow, M's own half: once the DM's handover fully commits
 * (`pregen-handover-sequence.ts`), the roster ALREADY lists M as this characterId's owner and the
 * character is ALREADY fully joined to this campaign at the protocol level — there is no further
 * `character.campaign_joined`/`campaign.character_joined` for M to send (that would be a
 * duplicate, harmless but pointless, join). What M's OWN device is still missing is simply a LOCAL
 * copy (this pregen was never in `CharactersRepository` — the DM created it, not M) — reaching for
 * one requires new sync/gateway-mediated-write plumbing outside this task's scope (see
 * task-12-report.md's "M's claim completion" section for the full server-rule tracing: a claimed
 * pregen's D1 `owner_id` never moves in this codebase, so M's own device cannot open a DIRECT
 * socket to it, and the campaign gateway cannot bootstrap a not-yet-rostered character's first
 * write either — no path exists for M to author anything on this stream). This bucket is
 * deliberately HONEST about that: it surfaces the (already-true) claimed state and a link back to
 * the party (where the character is already visible, owned by M, per the roster), not a broken
 * "link" action pretending to do more than the server currently supports.
 */
export interface ClaimedPregen {
  /** Bare character uuid — `CampaignState.roster`'s own key shape. */
  readonly characterId: string;
  readonly name: string;
}

/**
 * `/g/:id/link-character` (plan-10 task-7-brief.md): "pick an existing SYNCED character (or
 * create-new via the wizard then return) → ruling-4 two-append sequence with per-step status +
 * retry UI". Reached from `JoinComponent.confirm()` right after a campaign join succeeds, and from
 * `CreateWizardComponent`'s own `?returnUrl=` back-navigation once a brand-new character is
 * created from here.
 *
 * `campaignGuard` (`app.routes.ts`) has already `CampaignStore.open()`'d this campaign — same
 * "read `CampaignStore.campaignId()`, never re-parse `:id`" convention `LobbyComponent`/
 * `CampaignSettingsComponent` already establish — so this component never injects
 * `ActivatedRoute` itself.
 *
 * ## Eligibility (per candidate character)
 *
 * `lastCampaignLinkEvent` (N-pf1) is read ONCE per character at load time, straight off
 * `EventsRepository.byStream` (never through `CharacterStore`, which only ever holds ONE loaded
 * stream — see that helper's own class doc). Five buckets:
 *   - `'eligible'` — no campaign link at all (or one for a campaign this character already fully
 *     left) — a fresh two-step JOIN.
 *   - `'resume'` — the char-side `character.campaign_joined` for THIS campaign already exists
 *     (committed in an earlier, interrupted attempt) — ruling 4's documented JOIN recovery path,
 *     `retryCampaignLinkStepB` alone.
 *   - `'resumeLeave'` (fix round 1, finding 1) — the MIRROR-IMAGE stuck state for LEAVE: the
 *     campaign's own roster (`CampaignStore.state().roster`, keyed by bare characterId) still
 *     lists this (this-account-owned) character as active (`left: false`), but the char-side link
 *     no longer points here (`character.campaign_left` was sent — a `LeaveCampaignDialogComponent`
 *     that got dismissed, or its own tab closed, between step (a) committing and step (b) ever
 *     landing). `campaignIdOfCharacter`/the chip's own campaign-linked check would show NOTHING
 *     for this character (the char-side is already cleared) — this roster cross-check is the ONLY
 *     way such a half-left character is ever discoverable again, which is exactly why this bucket
 *     exists.
 *   - `'linkedElsewhere'` — linked to a DIFFERENT campaign — never selectable (payload facts,
 *     task-7-brief.md: "UI must surface 'this character is already in a campaign' rather than
 *     sending a doomed sequence" — one campaign per character).
 *   - `'notSynced'` — sync state (`SyncService.syncState`, mirroring `characters-list.component.
 *     ts`'s own bucketing, read LIVE per render) isn't `'synced'` yet.
 */
@Component({
  selector: 'app-link-character',
  imports: [TranslocoDirective, ButtonComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './link-character.component.html',
  styleUrl: './link-character.component.scss',
})
export class LinkCharacterComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly characterStore = inject(CharacterStore);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly syncService = inject(SyncService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly campaignId = computed(() => this.campaignStore.campaignId());
  private readonly roster = computed(() => this.campaignStore.state()?.roster);

  protected readonly loading = signal(true);
  protected readonly candidates = signal<readonly Candidate[]>([]);

  private readonly activeRow = signal<CharacterRow | undefined>(undefined);
  private activeAction: CampaignLinkAction = 'join';
  protected readonly activeCharacterId = computed(() => this.activeRow()?.id);
  protected readonly steps = signal<readonly CampaignLinkStepResult[]>([]);
  protected readonly busy = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly linkedOk = computed(
    () => this.steps().length > 0 && this.steps().every((s) => s.outcome === 'committed'),
  );
  /** Fix round 1 (finding 3): also true when an exception was THROWN before any step was ever
   * recorded (e.g. `CampaignStoreNotLeaderError` firing synchronously inside `appendTx`, between
   * this screen resetting `steps` to `[]` and either helper ever resolving) — without this, that
   * path left `steps` empty, `canRetry()` false, and the user stuck looking at a generic error
   * banner with no way back into either the character list OR a retry. */
  protected readonly canRetry = computed(() => {
    if (this.busy()) return false;
    const list = this.steps();
    const lastStepIncomplete = list.length > 0 && list.at(-1)?.outcome !== 'committed';
    return lastStepIncomplete || this.errorKey() !== undefined;
  });

  constructor() {
    void this.loadCandidates();
  }

  private async loadCandidates(): Promise<void> {
    const rows = await this.charactersRepository.list();
    const candidates: Candidate[] = [];
    for (const row of rows) {
      if (row.archived) continue;
      const events = await this.eventsRepository.byStream(row.id);
      candidates.push({ row, linkInfo: lastCampaignLinkEvent(events) });
    }
    this.candidates.set(candidates);
    this.loading.set(false);
  }

  /** Mirrors `characters-list.component.ts`'s own `syncStateBucket` — this screen only needs to
   * distinguish "synced" (selectable) from everything else, so the `pending-${n}` count itself is
   * folded into the same `'pending'` bucket rather than surfaced separately. */
  protected syncBucket(id: string): SyncBucket {
    const state = this.syncService.syncState(id)();
    if (state === 'synced' || state === 'connecting' || state === 'offline') return state;
    return 'pending';
  }

  protected eligibility(candidate: Candidate): Eligibility {
    const campaignId = this.campaignId();
    const ownerId = this.authService.user()?.userId;
    const rosterEntry = this.roster()?.get(bareCharacterId(candidate.row.id));

    // Fix round 1, finding 1: a stuck LEAVE — the roster still lists this owned character as
    // active, but the char-side already recorded leaving THIS campaign.
    if (
      candidate.linkInfo?.type === 'character.campaign_left' &&
      candidate.linkInfo.campaignId === campaignId &&
      rosterEntry !== undefined &&
      !rosterEntry.left &&
      ownerId !== undefined &&
      rosterEntry.ownerId === ownerId
    ) {
      return 'resumeLeave';
    }

    const linkedTo =
      candidate.linkInfo?.type === 'character.campaign_joined'
        ? candidate.linkInfo.campaignId
        : undefined;
    if (linkedTo !== undefined && linkedTo !== campaignId) return 'linkedElsewhere';
    if (this.syncBucket(candidate.row.id) !== 'synced') return 'notSynced';
    return linkedTo === campaignId ? 'resume' : 'eligible';
  }

  protected isSelectable(candidate: Candidate): boolean {
    const e = this.eligibility(candidate);
    return e === 'eligible' || e === 'resume' || e === 'resumeLeave';
  }

  /** See `ClaimedPregen`'s own class doc. A roster row that is `!left`, owned (per the roster) by
   * ME, and NOT already one of my local `CharactersRepository` rows — the only way a roster entry
   * satisfies "owned by me" without also being a candidate above is a DM handover that landed on a
   * character I never created locally myself. */
  protected readonly claimedPregens = computed<readonly ClaimedPregen[]>(() => {
    const roster = this.roster();
    const userId = this.authService.user()?.userId;
    if (!roster || !userId) return [];
    const localIds = new Set(this.candidates().map((c) => bareCharacterId(c.row.id)));
    const result: ClaimedPregen[] = [];
    for (const [characterId, entry] of roster) {
      if (entry.left || entry.ownerId !== userId || localIds.has(characterId)) continue;
      result.push({ characterId, name: entry.name });
    }
    return result;
  });

  protected goToParty(): void {
    const campaignId = this.campaignId();
    if (campaignId) void this.router.navigate(['/g', campaignId, 'party']);
  }

  protected async select(candidate: Candidate): Promise<void> {
    if (this.busy() || !this.isSelectable(candidate)) return;
    const campaignId = this.campaignId();
    const user = this.authService.user();
    if (!campaignId || !user) return;

    const action: CampaignLinkAction =
      this.eligibility(candidate) === 'resumeLeave' ? 'leave' : 'join';
    this.activeAction = action;
    this.activeRow.set(candidate.row);
    this.errorKey.set(undefined);
    this.steps.set([]);
    this.busy.set(true);
    try {
      await this.runAttempt(candidate.row, action, campaignId, user.userId);
      if (this.linkedOk()) {
        await this.router.navigate(['/g', campaignId, 'lobby']);
      }
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async retry(): Promise<void> {
    const row = this.activeRow();
    const campaignId = this.campaignId();
    const user = this.authService.user();
    if (!row || !campaignId || !user || this.busy()) return;

    this.errorKey.set(undefined);
    this.busy.set(true);
    try {
      await this.runAttempt(row, this.activeAction, campaignId, user.userId);
      if (this.linkedOk()) {
        await this.router.navigate(['/g', campaignId, 'lobby']);
      }
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Loads `row` into `CharacterStore` (needed either way — a fresh JOIN/LEAVE appends through it
   * directly; a resume needs its `events()` signal live to verify/await step (a)'s commit state —
   * fix round 1, finding 2), then re-derives WHETHER step (a) already exists for `action`/
   * `campaignId` fresh off the just-loaded events (never trusting `candidate.linkInfo`'s
   * load-time snapshot for this decision — that snapshot is only ever used to render the
   * eligibility BADGE). If it does, resumes via `retryCampaignLinkStepB` (which internally
   * verifies/awaits step (a)'s commit state itself); otherwise runs the FULL fresh sequence. Safe
   * to call from BOTH `select()` (first attempt) and `retry()` (any later attempt, including one
   * that only ever got as far as a THROWN exception with no step recorded at all) — it always
   * re-checks reality rather than assuming what the caller last saw.
   */
  private async runAttempt(
    row: CharacterRow,
    action: CampaignLinkAction,
    campaignId: string,
    ownerId: string,
  ): Promise<void> {
    await this.characterStore.load(row.id);
    const expectedType =
      action === 'join' ? 'character.campaign_joined' : 'character.campaign_left';
    const linkInfo = lastCampaignLinkEvent(this.characterStore.events());
    const alreadyHasStepA = linkInfo?.type === expectedType && linkInfo.campaignId === campaignId;

    const params = this.buildParams(action, row, campaignId, ownerId);
    if (alreadyHasStepA) {
      const step = await retryCampaignLinkStepB(params);
      this.steps.update((current) =>
        current.length > 0 ? [...current.slice(0, -1), step] : [step],
      );
    } else {
      const outcome = await runCampaignLinkSequence(params);
      this.steps.set(outcome.steps);
    }
  }

  protected createNew(): void {
    const campaignId = this.campaignId();
    if (!campaignId) return;
    void this.router.navigate(['/characters/new'], {
      queryParams: { returnUrl: `/g/${campaignId}/link-character` },
    });
  }

  protected goToCharactersList(): void {
    void this.router.navigate(['/characters']);
  }

  protected skip(): void {
    const campaignId = this.campaignId();
    if (campaignId) void this.router.navigate(['/g', campaignId, 'lobby']);
  }

  private buildParams(
    action: CampaignLinkAction,
    row: CharacterRow,
    campaignId: string,
    ownerId: string,
  ): CampaignLinkParams {
    return {
      action,
      characterPort: this.characterStore,
      campaignPort: this.campaignStore,
      campaignId,
      characterId: row.id,
      ownerId,
      characterName: row.name,
    };
  }

  // Template renders every scope-RELATIVE key through `*transloco="let t; read: 'campaigns'"`,
  // which auto-prepends the `campaigns.` prefix — `CampaignStoreNotLeaderError`/
  // `CampaignStoreNotAuthenticatedError`'s own `.code` is ALREADY `campaigns.*` (shared with
  // `ToastService.show`, which always resolves GLOBAL keys), so it's stripped here first to avoid
  // the double-prefix bug task-6-report.md documents (`JoinComponent`'s own identical pattern).
  // `CharacterStoreNotLeaderError.code` is `characters.not-leader` — a DIFFERENT scope entirely,
  // not stripped-and-reused; this screen has its own local key describing the same condition.
  private toErrorKey(err: unknown): string {
    if (
      err instanceof CampaignStoreNotLeaderError ||
      err instanceof CampaignStoreNotAuthenticatedError
    ) {
      return err.code.replace(/^campaigns\./, '');
    }
    if (err instanceof CharacterStoreNotLeaderError) return 'link.errors.characterNotLeader';
    return 'link.errors.generic';
  }
}
