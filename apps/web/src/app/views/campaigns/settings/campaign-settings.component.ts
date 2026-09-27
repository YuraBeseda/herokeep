import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { CampaignSettings } from '@hk/protocol';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { LeaderService } from '@shared/services/storage/leader.service';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';
import { CampaignExportDialogComponent } from './campaign-export-dialog.component';

/** doc-02 §"Campaign settings document"'s own example values — the ONLY defaults that document
 * pins explicitly (`attunementMax: 3`, `startingLevel: 1`); the remaining enum defaults
 * (`encumbrance`, `visibility.partySheets`) aren't pinned by doc-02, so this picks the most
 * "vanilla 5e SRD, nothing hidden" option for each rather than the loosest/strictest extreme.
 * Used ONLY the very first time a campaign's DM opens this screen before ANY
 * `campaign.settings_changed` event exists yet (`CampaignState.settings` is `null` until then,
 * campaign-projection.ts) — saving these once establishes the real document going forward. */
function defaultCampaignSettings(system: string): CampaignSettings {
  return {
    system,
    packs: [],
    houseRules: {
      strictValidation: true,
      allowOverrides: true,
      editOutsideSession: 'free',
      xpMode: 'xp',
      hpOnLevelUp: 'roll',
      encumbrance: 'standard',
      attunementMax: 3,
      startingLevel: 1,
    },
    visibility: {
      partySheets: 'overview',
      rolls: 'everyone',
      allowPrivateRolls: true,
    },
    join: { open: true, requireApproval: false },
  };
}

type HouseRules = CampaignSettings['houseRules'];
type Visibility = CampaignSettings['visibility'];
type Join = CampaignSettings['join'];

/**
 * `/g/:id/settings` (plan-10 task-6-brief.md): renders `CampaignSettings` — DM-editable (appends
 * the FULL document via `campaign.settings_changed`, per the brief's binding "Settings edit"
 * carry: "the form edits a copy of state.settings and appends the whole settings object"),
 * read-only for everyone else. Enum VALUES are the schema's own constants
 * (`CampaignSettingsSchema`'s literal unions); only their LABELS go through i18n keys.
 *
 * ## Draft/effective split (a judgment call, not spelled out by the brief)
 *
 * Before the user edits anything, the form tracks `CampaignStore.state()?.settings` REACTIVELY —
 * useful because a freshly opened campaign may still be mid-catch-up (task-4-report.md: "a brief
 * loading window" after create/join before events sync down), so the very first settings the DM
 * ever sees should update live rather than freeze at whatever was loaded first. The INSTANT the
 * DM edits any field, `draft` forks from `effective()` and the form stops following further live
 * updates (there shouldn't be any mid-edit for a single-DM-authored document, but this avoids ANY
 * chance of clobbering an in-progress edit with a same-tick echo of the DM's own prior save).
 * `save()` resets `draft` to `null` afterward so the form resumes tracking the just-appended
 * (already locally applied) document.
 */
@Component({
  selector: 'app-campaign-settings',
  imports: [TranslocoDirective, ButtonComponent, ChipComponent, NumberFieldComponent, FormsModule],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './campaign-settings.component.html',
  styleUrl: './campaign-settings.component.scss',
})
export class CampaignSettingsComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly leaderService = inject(LeaderService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);

  protected readonly role = this.campaignStore.role;
  protected readonly isDm = computed(() => this.role() === 'dm');
  protected readonly canEdit = computed(() => this.isDm() && this.leaderService.isLeader());

  protected readonly saving = signal(false);
  private readonly draft = signal<CampaignSettings | null>(null);

  // Enum option lists the template iterates for each field's chip row (edit mode) — the VALUES
  // are the schema's own literal unions verbatim (task-6-brief.md: "values from the schema
  // constants"); only the rendered LABEL goes through an i18n key per option.
  protected readonly editOutsideSessionOptions: HouseRules['editOutsideSession'][] = [
    'free',
    'dmApproval',
    'locked',
  ];
  protected readonly xpModeOptions: HouseRules['xpMode'][] = ['xp', 'milestone'];
  protected readonly hpOnLevelUpOptions: HouseRules['hpOnLevelUp'][] = [
    'roll',
    'average',
    'choice',
  ];
  protected readonly encumbranceOptions: HouseRules['encumbrance'][] = [
    'off',
    'standard',
    'variant',
  ];
  protected readonly partySheetsOptions: Visibility['partySheets'][] = ['none', 'overview', 'full'];
  protected readonly rollsOptions: Visibility['rolls'][] = ['everyone', 'dm'];

  protected readonly effective = computed<CampaignSettings>(() => {
    const state = this.campaignStore.state();
    return state?.settings ?? defaultCampaignSettings(state?.system ?? '');
  });

  protected readonly current = computed<CampaignSettings>(() => this.draft() ?? this.effective());

  private setField(mutate: (s: CampaignSettings) => CampaignSettings): void {
    if (!this.canEdit()) return;
    this.draft.set(mutate(structuredClone(this.current())));
  }

  private setHouseRules(mutate: (h: HouseRules) => HouseRules): void {
    this.setField((s) => ({ ...s, houseRules: mutate(s.houseRules) }));
  }

  private setVisibility(mutate: (v: Visibility) => Visibility): void {
    this.setField((s) => ({ ...s, visibility: mutate(s.visibility) }));
  }

  private setJoin(mutate: (j: Join) => Join): void {
    this.setField((s) => ({ ...s, join: mutate(s.join) }));
  }

  protected setStrictValidation(value: boolean): void {
    this.setHouseRules((h) => ({ ...h, strictValidation: value }));
  }

  protected setAllowOverrides(value: boolean): void {
    this.setHouseRules((h) => ({ ...h, allowOverrides: value }));
  }

  protected setEditOutsideSession(value: HouseRules['editOutsideSession']): void {
    this.setHouseRules((h) => ({ ...h, editOutsideSession: value }));
  }

  protected setXpMode(value: HouseRules['xpMode']): void {
    this.setHouseRules((h) => ({ ...h, xpMode: value }));
  }

  protected setHpOnLevelUp(value: HouseRules['hpOnLevelUp']): void {
    this.setHouseRules((h) => ({ ...h, hpOnLevelUp: value }));
  }

  protected setEncumbrance(value: HouseRules['encumbrance']): void {
    this.setHouseRules((h) => ({ ...h, encumbrance: value }));
  }

  protected setAttunementMax(value: number | null): void {
    if (value === null) return;
    this.setHouseRules((h) => ({ ...h, attunementMax: value }));
  }

  protected setStartingLevel(value: number | null): void {
    if (value === null) return;
    this.setHouseRules((h) => ({ ...h, startingLevel: value }));
  }

  protected setPartySheets(value: Visibility['partySheets']): void {
    this.setVisibility((v) => ({ ...v, partySheets: value }));
  }

  protected setRollsVisibility(value: Visibility['rolls']): void {
    this.setVisibility((v) => ({ ...v, rolls: value }));
  }

  protected setAllowPrivateRolls(value: boolean): void {
    this.setVisibility((v) => ({ ...v, allowPrivateRolls: value }));
  }

  protected setJoinOpen(value: boolean): void {
    this.setJoin((j) => ({ ...j, open: value }));
  }

  protected setJoinRequireApproval(value: boolean): void {
    this.setJoin((j) => ({ ...j, requireApproval: value }));
  }

  protected async save(): Promise<void> {
    if (!this.canEdit() || this.saving()) return;
    const settings = this.current();

    this.saving.set(true);
    try {
      await this.campaignStore.appendTx([
        { type: 'campaign.settings_changed', v: 1, payload: { settings } },
      ]);
      this.draft.set(null);
      this.toastService.show('campaigns.settings.toast.saved');
    } catch (err) {
      const key =
        err instanceof CampaignStoreNotLeaderError ||
        err instanceof CampaignStoreNotAuthenticatedError
          ? err.code
          : 'campaigns.settings.toast.saveFailed';
      this.toastService.show(key);
    } finally {
      this.saving.set(false);
    }
  }

  /** DM-only, gated by `isDm()` alone — NOT `canEdit()` (task-15-brief.md: "DM-only … gated
   * isDm"). Exporting is a read-only backup action, not an edit of the campaign document, so a DM
   * on a non-leader tab can still use it (unlike `save()`, which genuinely needs the write lock). */
  protected openExportDialog(): void {
    const campaignId = this.campaignStore.campaignId();
    if (!this.isDm() || !campaignId) return;
    this.dialogService.open(CampaignExportDialogComponent, {
      data: { campaignId, name: this.campaignStore.state()?.name ?? '' },
    });
  }
}
