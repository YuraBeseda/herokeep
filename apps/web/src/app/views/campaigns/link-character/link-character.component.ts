import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@shared/services/auth/auth.service';
import {
  runCampaignLinkSequence,
  retryCampaignLinkStepB,
  type CampaignLinkParams,
  type CampaignLinkStepResult,
} from '@shared/services/campaigns/campaign-link-sequence';
import { campaignIdOfCharacter } from '@shared/services/campaigns/character-campaign-link';
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
type Eligibility = 'eligible' | 'resume' | 'linkedElsewhere' | 'notSynced';

interface Candidate {
  readonly row: CharacterRow;
  /** `campaignIdOfCharacter`'s result, snapshotted at load time (see class doc for why this is a
   * one-time read rather than a live signal). */
  readonly linkedTo: string | undefined;
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
 * `campaignIdOfCharacter` (N-pf1) is read ONCE per character at load time, straight off
 * `EventsRepository.byStream` (never through `CharacterStore`, which only ever holds ONE loaded
 * stream — see that helper's own class doc): `undefined` → eligible for a fresh two-step JOIN;
 * equal to THIS campaign → the char-side (a) step already committed in an earlier attempt —
 * ruling 4's documented recovery path, resume with step (b) ALONE
 * (`retryCampaignLinkStepB`); anything else → linked to a DIFFERENT campaign, never selectable
 * (payload facts, task-7-brief.md: "UI must surface 'this character is already in a campaign'
 * rather than sending a doomed sequence" — one campaign per character). Sync state
 * (`SyncService.syncState`, mirroring `characters-list.component.ts`'s own bucketing) IS read
 * live per render — a character mid-upload flips to selectable the moment it finishes, with no
 * need to reload this screen.
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

  protected readonly loading = signal(true);
  protected readonly candidates = signal<readonly Candidate[]>([]);

  protected readonly activeCharacterId = signal<string | undefined>(undefined);
  protected readonly steps = signal<readonly CampaignLinkStepResult[]>([]);
  protected readonly busy = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly linkedOk = computed(
    () => this.steps().length > 0 && this.steps().every((s) => s.outcome === 'committed'),
  );
  protected readonly canRetry = computed(() => {
    const list = this.steps();
    return !this.busy() && list.length > 0 && list.at(-1)?.outcome !== 'committed';
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
      candidates.push({ row, linkedTo: campaignIdOfCharacter(events) });
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
    if (candidate.linkedTo !== undefined && candidate.linkedTo !== campaignId) {
      return 'linkedElsewhere';
    }
    if (this.syncBucket(candidate.row.id) !== 'synced') return 'notSynced';
    return candidate.linkedTo === campaignId ? 'resume' : 'eligible';
  }

  protected isSelectable(candidate: Candidate): boolean {
    const e = this.eligibility(candidate);
    return e === 'eligible' || e === 'resume';
  }

  protected async select(candidate: Candidate): Promise<void> {
    if (this.busy() || !this.isSelectable(candidate)) return;
    const campaignId = this.campaignId();
    const user = this.authService.user();
    if (!campaignId || !user) return;

    this.errorKey.set(undefined);
    this.activeCharacterId.set(candidate.row.id);
    this.steps.set([]);
    this.busy.set(true);
    try {
      const params = this.buildParams(candidate.row, campaignId, user.userId);
      if (candidate.linkedTo === campaignId) {
        // Resume: step (a) already committed in an earlier attempt — send step (b) alone.
        const step = await retryCampaignLinkStepB(params);
        this.steps.set([step]);
      } else {
        await this.characterStore.load(candidate.row.id);
        const outcome = await runCampaignLinkSequence(params);
        this.steps.set(outcome.steps);
      }
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
    const characterId = this.activeCharacterId();
    const campaignId = this.campaignId();
    const user = this.authService.user();
    const candidate = this.candidates().find((c) => c.row.id === characterId);
    if (!characterId || !campaignId || !user || !candidate || this.busy()) return;

    this.errorKey.set(undefined);
    this.busy.set(true);
    try {
      const params = this.buildParams(candidate.row, campaignId, user.userId);
      const step = await retryCampaignLinkStepB(params);
      this.steps.update((current) => [...current.slice(0, -1), step]);
      if (this.linkedOk()) {
        await this.router.navigate(['/g', campaignId, 'lobby']);
      }
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.busy.set(false);
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

  private buildParams(row: CharacterRow, campaignId: string, ownerId: string): CampaignLinkParams {
    return {
      action: 'join',
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
