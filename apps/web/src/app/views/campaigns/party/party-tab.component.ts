import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { MembershipRole } from '@hk/protocol';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { HpBarComponent } from '@shared/components/hp-bar/hp-bar.component';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { AuthService } from '@shared/services/auth/auth.service';
import type { PartyOverview } from '@shared/services/campaigns/campaign-projection';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { PlaceholderService, type Monogram } from '@shared/services/images/placeholder.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { MemberSheetDialogComponent } from './member-sheet-dialog.component';

/** A `visibility.partySheets` mode, resolved with the same default `defaultCampaignSettings`
 * (`campaign-settings.component.ts`, task-6-report.md judgment call 7) uses for a campaign with
 * no `campaign.settings_changed` event yet. */
type PartySheetsMode = 'none' | 'overview' | 'full';

/** One roster card (task-8-brief.md: "cards from `state.overviews`" + "roster entries with no
 * overview yet -> name-only card (from roster.name)"). `overview` is `undefined` for either
 * reason — no `party.overview_updated` has landed for this character yet, or (below) this
 * viewer isn't shown one at all. */
interface PartyCardVm {
  readonly characterId: string;
  readonly name: string;
  readonly left: boolean;
  readonly overview: PartyOverview | undefined;
}

/** One row in the "members without an active character" section (task-8-brief.md interfaces
 * note 16: "members with no characters -> row per member (`state.members` minus roster
 * owners)"). Mirrors `lobby.component.ts`'s own `MemberVm` field set (minus `online` — presence
 * has no bearing on this list). */
interface MemberWithoutCharacterVm {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  readonly removed: boolean;
}

/**
 * `/g/:id/party` (plan-10 task-8-brief.md): the party overview grid. Replaces Task 6's
 * placeholder outright. `campaignGuard` (`app.routes.ts`) has already `CampaignStore.open()`'d
 * the stream, so `campaignStore.state()`/`.role()`/`.campaignId()` already point here — same
 * "no own data-loading, the guard already did it" relationship every other campaign tab
 * (`LobbyComponent`, `CampaignSettingsComponent`) has to `CampaignStore`.
 *
 * ## `partySheets` gating (doc-08 verification, task-8-brief.md's own instruction)
 *
 * `party.overview_updated` is NOT in doc-08's "Filtering on read" paragraph (only `dm.note_*`
 * and `roll.logged`/`chat.message` visibility are server-filtered) — every member's socket
 * receives every overview event regardless of `visibility.partySheets`. That setting is
 * therefore enforced CLIENT-SIDE here, for non-DM viewers only (`doc-08`'s authorization matrix
 * always lets the DM read everything; "the client renders, never re-enforces" describes the
 * SERVER's posture toward the wire protocol, not this component's own presentation choice):
 * `'none'` renders every card name-only (as if no overview existed at all, even when one has
 * arrived); `'overview'`/`'full'` both render the full card for a member — `'full'`'s ONLY
 * additional effect is enabling a DM-only sheet-subscribe drill-in, which is Task 9's own work,
 * not this component's. The DM always sees full detail, unconditionally.
 */
@Component({
  selector: 'app-party-tab',
  imports: [TranslocoDirective, ButtonComponent, HpBarComponent, BlobUrlPipe],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './party-tab.component.html',
  styleUrl: './party-tab.component.scss',
})
export class PartyTabComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly authService = inject(AuthService);
  private readonly engineFacade = inject(EngineFacade);
  private readonly placeholderService = inject(PlaceholderService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialogService = inject(DialogService);

  protected readonly state = this.campaignStore.state;
  protected readonly role = this.campaignStore.role;
  protected readonly isDm = computed(() => this.role() === 'dm');

  protected readonly partySheetsMode = computed<PartySheetsMode>(
    () => this.state()?.settings?.visibility.partySheets ?? 'overview',
  );

  /** [plan-10 Task 9] Gates the party card's "View sheet" drill-in affordance — ruling 8's exact
   * wording (task-8-report.md carry): "`'full'` additionally enables DM (and only DM) sheet-
   * subscribe drill-in." */
  protected readonly canDrillIn = computed(() => this.isDm() && this.partySheetsMode() === 'full');

  /** DM: always full detail. Member: full detail UNLESS `partySheets === 'none'` — see class
   * doc's "partySheets gating" section. */
  protected readonly showOverviewDetails = computed(
    () => this.isDm() || this.partySheetsMode() !== 'none',
  );

  protected readonly cards = computed<PartyCardVm[]>(() => {
    const state = this.state();
    if (!state) return [];
    return [...state.roster.entries()].map(([characterId, entry]) => ({
      characterId,
      name: entry.name,
      left: entry.left,
      overview: state.overviews.get(characterId),
    }));
  });

  protected readonly membersWithoutCharacter = computed<MemberWithoutCharacterVm[]>(() => {
    const state = this.state();
    if (!state) return [];
    const activeOwnerIds = new Set(
      [...state.roster.values()].filter((r) => !r.left).map((r) => r.ownerId),
    );
    const rows: MemberWithoutCharacterVm[] = [];
    for (const [userId, entry] of state.members) {
      if (activeOwnerIds.has(userId)) continue;
      rows.push({
        userId,
        displayName: entry.displayName,
        role: entry.role,
        removed: entry.removed,
      });
    }
    return rows;
  });

  /** Whether the SIGNED-IN user already has an active (non-`left`) character in this campaign's
   * roster — drives the "link a character" empty-state CTA (task-8-brief.md's Task-7-flagged
   * extra obligation). Defaults to `true` (CTA hidden) while `state`/`user` haven't resolved yet,
   * so the CTA never flashes on briefly before the real answer is known. */
  protected readonly hasOwnActiveCharacter = computed(() => {
    const state = this.state();
    const userId = this.authService.user()?.userId;
    if (!state || !userId) return true;
    return [...state.roster.values()].some((r) => r.ownerId === userId && !r.left);
  });

  protected classLine(
    t: (key: string, params?: Record<string, unknown>) => string,
    ov: PartyOverview,
  ): string {
    if (ov.classes.length === 0) return '';
    const localizer = this.engineFacade.localizer();
    return ov.classes
      .map((c) => t('party.card.classLevel', { class: localizer.name(c.classId), level: c.level }))
      .join(' · ');
  }

  protected conditionName(conditionId: string): string {
    return this.engineFacade.localizer().name(conditionId) || conditionId;
  }

  protected monogram(name: string, characterId: string): Monogram {
    return this.placeholderService.monogram(name, characterId);
  }

  protected goToLinkCharacter(): void {
    void this.router.navigate(['../link-character'], { relativeTo: this.route });
  }

  /** [plan-10 Task 9] Opens the DM party-sheet drill-in for `card` — the caller (the template)
   * already gates this behind `canDrillIn()`, so this method trusts it was only ever invoked for
   * an authorized viewer (same "the opener already checked" posture `MemberSheetDialogComponent`
   * itself documents). `campaignId()` is guaranteed defined here — this component only ever
   * renders once `campaignGuard` has already opened a campaign stream. */
  protected openMemberSheet(card: PartyCardVm): void {
    const campaignId = this.campaignStore.campaignId();
    if (!campaignId) return;
    this.dialogService.open(MemberSheetDialogComponent, {
      data: { campaignId, characterId: card.characterId, name: card.name },
      sheet: true,
    });
  }
}
