import { EncounterPlateComponent } from '../encounter-plate/encounter-plate.component';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { MembershipRole } from '@hk/protocol';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { AuthService } from '@shared/services/auth/auth.service';
import type { PartyOverview } from '@shared/services/campaigns/campaign-projection';
import type { HpSnapshot } from '@shared/services/campaigns/dm-effects';
import { mergeMemberPresence } from '@shared/services/campaigns/member-presence';
import { SyncService } from '@shared/services/sync/sync.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CampaignStore } from '@shared/stores/campaign.store';
import { IconComponent } from '../../../shared/icons/icon.component';
import { HkBannerComponent } from '../../../ui/banner/banner.component';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { DialogService } from '../../../ui/dialog/dialog.service';
import {
  HkPartyCardComponent,
  type PartyCondition,
} from '../../../ui/party-card/party-card.component';
import { HkPortraitFrameComponent } from '../../../ui/portrait-frame/portrait-frame.component';
import { CampaignSelectionService, type DmEffectKind } from '../shell/campaign-selection.service';
import { HandoverCharacterDialogComponent } from './handover-character-dialog.component';
import { MemberSheetDrawerComponent } from './member-sheet-drawer/member-sheet-drawer.component';
import { QuickEffectsLeafComponent } from './quick-effects-leaf/quick-effects-leaf.component';
import { UnlinkCharacterDialogComponent } from './unlink-character-dialog.component';

/** A `visibility.partySheets` mode, resolved with the same default `defaultCampaignSettings`
 * (`campaign-settings.component.ts`, task-6-report.md judgment call 7) uses for a campaign with
 * no `campaign.settings_changed` event yet. */
type PartySheetsMode = 'none' | 'overview' | 'full';

/** One roster card (task-8-brief.md: "cards from `state.overviews`" + "roster entries with no
 * overview yet -> name-only card (from roster.name)"). `overview` is `undefined` for either
 * reason: no `party.overview_updated` has landed for this character yet, or this viewer isn't
 * shown one at all. */
interface PartyCardVm {
  readonly characterId: string;
  readonly name: string;
  readonly left: boolean;
  readonly ownerId: string;
  readonly overview: PartyOverview | undefined;
}

/** One row in the "members without an active character" section (task-8-brief.md interfaces
 * note 16: "members with no characters -> row per member (`state.members` minus roster
 * owners)"). */
interface MemberWithoutCharacterVm {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  readonly removed: boolean;
}

/** The sheet drawer's target while it is open. */
interface DrawerTarget {
  readonly characterId: string;
  readonly name: string;
  readonly opener: HTMLElement | null;
}

/** The quick-effect chips on a DM card, in the board's order; the XP / Level pair is one chip. */
const FX_ORDER: readonly DmEffectKind[] = [
  'damage',
  'heal',
  'temp',
  'condition',
  'xp',
  'level',
  'item',
  'inspiration',
  'override',
];

const FX_ICONS: Record<DmEffectKind, string> = {
  damage: 'ui:damage',
  heal: 'ui:heal',
  temp: 'ui:temp-hp',
  condition: 'ui:condition',
  xp: 'ui:xp',
  level: 'ui:level-up',
  item: 'ui:bag',
  inspiration: 'ui:inspiration',
  override: 'ui:edit',
};

/**
 * `/g/:id/party` (boards C06, C06-Tablet and C07, plan 17 B11b): the party overview grid.
 * `campaignGuard` (`app.routes.ts`) has already `CampaignStore.open()`'d the stream, so
 * `campaignStore.state()`/`.role()`/`.campaignId()` already point here: no own data-loading, the
 * same relationship every other campaign tab has to `CampaignStore`.
 *
 * ## The DM view
 *
 * A grid of `hk-party-card`s. Pressing a card (or one of its effect chips) selects that member:
 * the selection (`CampaignSelectionService`) drives the quick-effects leaf beside the grid and the
 * campaign strap's Damage / Heal / Condition / XP / Item. A chip also picks the leaf's tab. The
 * card's book button opens the member sheet in a drawer (`partySheets: 'full'` only), and the leaf
 * footer offers Open full sheet, Hand over to... (the DM's own pregens) and Unlink (a roster entry
 * whose owner was removed). The encounter plate slot of C06 is empty until plan slice 2.
 *
 * ## The player view
 *
 * The same grid without the chips, the leaf or the drill-in; the viewer's own hero is highlighted
 * with a "Your hero" plate and an Open my sheet button.
 *
 * ## `partySheets` gating (doc-08 verification, task-8-brief.md's own instruction)
 *
 * `party.overview_updated` is NOT in doc-08's "Filtering on read" paragraph, so every member's
 * socket receives every overview regardless of `visibility.partySheets`. That setting is therefore
 * enforced CLIENT-SIDE here, for non-DM viewers only: `'none'` renders every card name-only;
 * `'overview'`/`'full'` both render the full card; `'full'`'s ONLY additional effect is the DM-only
 * sheet drill-in. The DM always sees full detail.
 *
 * ## Requests that cannot land
 *
 * A strap request or a selection for a member this tab cannot address (they left the roster, or
 * are absent from it) is dropped here, so a pending request never lingers for a leaf that will
 * never mount.
 */
@Component({
  selector: 'app-party-tab',
  imports: [
    EncounterPlateComponent,
    TranslocoDirective,
    BlobUrlPipe,
    IconComponent,
    HkBannerComponent,
    HkButtonComponent,
    HkPartyCardComponent,
    HkPortraitFrameComponent,
    MemberSheetDrawerComponent,
    QuickEffectsLeafComponent,
  ],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './party-tab.component.html',
  styleUrl: './party-tab.component.scss',
})
export class PartyTabComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly authService = inject(AuthService);
  private readonly engineFacade = inject(EngineFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialogService = inject(DialogService);
  private readonly selection = inject(CampaignSelectionService);
  private readonly syncService = inject(SyncService);

  protected readonly state = this.campaignStore.state;
  protected readonly role = this.campaignStore.role;
  protected readonly campaignId = this.campaignStore.campaignId;
  protected readonly isDm = computed(() => this.role() === 'dm');
  protected readonly fxIcon = (kind: DmEffectKind): string => FX_ICONS[kind];

  protected readonly partySheetsMode = computed<PartySheetsMode>(
    () => this.state()?.settings?.visibility.partySheets ?? 'full',
  );

  /** [plan-10 Task 9] Gates the DM's sheet drill-in: `'full'` additionally enables DM (and only
   * DM) sheet-subscribe drill-in. */
  protected readonly canDrillIn = computed(() => this.isDm() && this.partySheetsMode() === 'full');

  /** DM: always full detail. Member: full detail UNLESS `partySheets === 'none'`. */
  protected readonly showOverviewDetails = computed(
    () => this.isDm() || this.partySheetsMode() !== 'none',
  );

  /** This campaign's own DM userId, derived from `state.members` (design ruling 3 has no separate
   * `dmId` field client-side). `undefined` only before `state` has resolved at all. */
  protected readonly dmUserId = computed(() => {
    const state = this.state();
    if (!state) return undefined;
    for (const [userId, entry] of state.members) {
      if (entry.role === 'dm') return userId;
    }
    return undefined;
  });

  /** A pregen (task-12-brief.md: "NO protocol flag exists: a pregen is just a DM-owned rostered
   * character"). */
  protected isPregen(card: PartyCardVm): boolean {
    const dmId = this.dmUserId();
    return dmId !== undefined && card.ownerId === dmId;
  }

  protected readonly cards = computed<PartyCardVm[]>(() => {
    const state = this.state();
    if (!state) return [];
    return [...state.roster.entries()].map(([characterId, entry]) => ({
      characterId,
      name: entry.name,
      left: entry.left,
      ownerId: entry.ownerId,
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
   * roster: drives the "link a character" empty-state CTA. Defaults to `true` (CTA hidden) while
   * `state`/`user` haven't resolved yet, so the CTA never flashes on briefly. */
  protected readonly hasOwnActiveCharacter = computed(() => {
    const state = this.state();
    const userId = this.authService.user()?.userId;
    if (!state || !userId) return true;
    return [...state.roster.values()].some((r) => r.ownerId === userId && !r.left);
  });

  /** Who is online, per owner, from the same derivation as the Lobby roster; `null` while there is
   * no live member list (presence unknown, nothing is drawn). */
  private readonly onlineByOwner = computed<ReadonlyMap<string, boolean> | null>(() => {
    const state = this.state();
    const id = this.campaignId();
    const live = id ? this.syncService.membersFor(id)() : null;
    if (!state || !live) return null;
    return new Map(mergeMemberPresence(state.members, live).map((m) => [m.userId, m.online]));
  });

  protected online(card: PartyCardVm): boolean | null {
    const map = this.onlineByOwner();
    return map ? (map.get(card.ownerId) ?? false) : null;
  }

  /** The chips on a DM card: XP in XP mode, Level in milestone mode (the leaf's pair). */
  protected readonly fxKinds = computed<readonly DmEffectKind[]>(() => {
    const xpMode = this.state()?.settings?.houseRules.xpMode ?? 'xp';
    return FX_ORDER.filter((kind) => (xpMode === 'xp' ? kind !== 'level' : kind !== 'xp'));
  });

  /** The card the quick-effects leaf is for: the DM's selection, while it can still be addressed. */
  protected readonly selectedCard = computed<PartyCardVm | undefined>(() => {
    if (!this.isDm()) return undefined;
    const id = this.selection.selected()?.characterId;
    return this.cards().find((card) => card.characterId === id && !card.left);
  });

  protected readonly drawer = signal<DrawerTarget | null>(null);

  constructor() {
    // A request or a selection for a member this tab cannot address (left, or absent from the
    // roster) is dropped: no leaf will ever mount for them, so it must not linger on the board.
    effect(() => {
      const state = this.state();
      const cards = this.cards();
      const selected = this.selection.selected();
      const request = this.selection.request();
      if (!state || !this.isDm()) return;
      const addressable = (characterId: string): boolean =>
        cards.some((card) => card.characterId === characterId && !card.left);
      untracked(() => {
        if (selected && !addressable(selected.characterId)) {
          this.selection.clear();
        } else if (request && !addressable(request.characterId)) {
          this.selection.consume(request);
        }
      });
    });
  }

  protected classLine(
    t: (key: string, params?: Record<string, unknown>) => string,
    card: PartyCardVm,
  ): string {
    const ov = card.overview;
    const parts: string[] = [];
    if (ov && ov.classes.length > 0) {
      const localizer = this.engineFacade.localizer();
      parts.push(
        ov.classes
          .map((c) =>
            t('party.card.classLevel', { class: localizer.name(c.classId), level: c.level }),
          )
          .join(' · '),
      );
    }
    const player = this.state()?.members.get(card.ownerId)?.displayName;
    if (player) parts.push(t('party.card.player', { name: player }));
    return parts.join(' · ');
  }

  protected conditions(card: PartyCardVm): PartyCondition[] {
    const localizer = this.engineFacade.localizer();
    return (card.overview?.conditions ?? []).map((id) => ({
      id,
      name: localizer.name(id) || id,
    }));
  }

  protected isMine(card: PartyCardVm): boolean {
    const userId = this.authService.user()?.userId;
    return userId !== undefined && card.ownerId === userId && !card.left;
  }

  protected goToLinkCharacter(): void {
    void this.router.navigate(['../link-character'], { relativeTo: this.route });
  }

  protected openMySheet(card: PartyCardVm): void {
    void this.router.navigate(['/c', card.characterId]);
  }

  /** [plan-10 Task 12] DM "add pregen": reuses the creation wizard's own `?returnUrl=` mechanism
   * verbatim, landing the DM back on `/g/:id/link-character` where the brand-new character shows
   * up as `'eligible'` and the DM completes the join with one more click. */
  protected addPregen(): void {
    const campaignId = this.campaignStore.campaignId();
    if (!campaignId) return;
    void this.router.navigate(['/characters/new'], {
      queryParams: { returnUrl: `/g/${campaignId}/link-character` },
    });
  }

  /** [plan-10 Task 12] "Hand over to…": DM-only, and only ever on a card this DM themselves
   * currently owns (`isPregen`) that hasn't already left the roster. */
  protected canHandOver(card: PartyCardVm): boolean {
    return this.isDm() && !card.left && this.isPregen(card);
  }

  protected openHandover(card: PartyCardVm): void {
    const campaignId = this.campaignStore.campaignId();
    if (!campaignId) return;
    this.dialogService.open(HandoverCharacterDialogComponent, {
      data: {
        campaignId,
        characterId: card.characterId,
        characterName: card.name,
        fromOwnerId: card.ownerId,
      },
    });
  }

  /** [plan-10 Task 9] Opens the DM party-sheet drill-in for `card` in a drawer. The callers gate
   * this behind `canDrillIn()`. `opener` is the control that was pressed: focus returns to it. */
  protected openMemberSheet(card: PartyCardVm, opener: HTMLElement | null): void {
    if (!this.campaignStore.campaignId()) return;
    this.drawer.set({ characterId: card.characterId, name: card.name, opener });
  }

  /** The card's book button: the cell's own button is the drawer's opener. */
  protected openFromCard(card: PartyCardVm, cell: HTMLElement): void {
    this.openMemberSheet(card, cell.querySelector<HTMLElement>('.hk-party__open'));
  }

  protected openFromLeaf(card: PartyCardVm, leaf: HTMLElement): void {
    this.openMemberSheet(card, leaf.querySelector<HTMLElement>('.qfx__open-sheet'));
  }

  /** [plan-10 Task 11] The leaf's HP baseline for THIS card: 'overview' mode only ever has
   * `PartyOverview.hp/hpMax/temp` (never `currentWasMax`, which only a live `Sheet` can supply).
   * `undefined` when no overview has arrived yet at all. */
  protected hpSnapshot(card: PartyCardVm): HpSnapshot | undefined {
    const ov = card.overview;
    return ov ? { current: ov.hp, max: ov.hpMax, temp: ov.temp } : undefined;
  }

  protected activeConditionIds(card: PartyCardVm): readonly string[] {
    return card.overview?.conditions ?? [];
  }

  /** [plan-10 Task 11] Scoped EXACTLY to doc-03's §bye obligation: a roster entry whose character
   * hasn't left yet but whose OWNING member has been removed/left the campaign. Deliberately NOT a
   * general "unlink any character" tool. */
  protected canUnlink(card: PartyCardVm): boolean {
    if (!this.isDm() || card.left) return false;
    return this.state()?.members.get(card.ownerId)?.removed === true;
  }

  protected openUnlink(card: PartyCardVm): void {
    const campaignId = this.campaignStore.campaignId();
    if (!campaignId) return;
    this.dialogService.open(UnlinkCharacterDialogComponent, {
      data: {
        campaignId,
        characterId: card.characterId,
        ownerId: card.ownerId,
        characterName: card.name,
      },
    });
  }

  // --- Selection -------------------------------------------------------------------------------

  protected isSelected(card: PartyCardVm): boolean {
    return this.selection.selected()?.characterId === card.characterId;
  }

  /** A press on a DM card's body toggles the selection; presses on its own controls do not. */
  protected onCellPress(event: Event, card: PartyCardVm): void {
    if (!this.isDm() || card.left) return;
    const target = event.target;
    // A press on one of the card's own controls is that control's, not the card's.
    const control =
      target instanceof Element ? target.closest('button, a, [role="img"], [tabindex]') : null;
    if (control && control !== event.currentTarget) return;
    this.selection.toggle({ characterId: card.characterId, name: card.name });
  }

  /** Enter or Space on the focused card itself does what a press on it does. */
  protected onCellKey(event: KeyboardEvent, card: PartyCardVm): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.onCellPress(event, card);
  }

  /** A chip selects the card (when it is not the selection yet) and asks its leaf for `kind`. */
  protected pickEffect(card: PartyCardVm, kind: DmEffectKind): void {
    if (!this.isSelected(card)) {
      this.selection.select({ characterId: card.characterId, name: card.name });
    }
    this.selection.requestEffect(kind);
  }

  protected closeLeaf(): void {
    this.selection.clear();
  }
}
