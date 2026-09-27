import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import type { CampaignSettings, MembershipRole } from '@hk/protocol';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import type { CampaignState } from '@shared/services/campaigns/campaign-projection';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CampaignStore, CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { CampaignExportDialogComponent } from './campaign-export-dialog.component';
import { CampaignSettingsComponent } from './campaign-settings.component';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

function mkSettings(overrides: Partial<CampaignSettings> = {}): CampaignSettings {
  return {
    system: 'srd-5e-2024',
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
    visibility: { partySheets: 'overview', rolls: 'everyone', allowPrivateRolls: true },
    join: { open: true, requireApproval: false },
    ...overrides,
  };
}

function configure(options: {
  role?: MembershipRole;
  isLeader?: boolean;
  settings?: CampaignSettings | null;
  appendTx?: ReturnType<typeof vi.fn>;
}): {
  appendTx: ReturnType<typeof vi.fn>;
  toastShow: ReturnType<typeof vi.fn>;
  dialogOpen: ReturnType<typeof vi.fn>;
} {
  const appendTx = options.appendTx ?? vi.fn().mockResolvedValue(undefined);
  const toastShow = vi.fn();
  const dialogOpen = vi.fn().mockReturnValue({ closed: Promise.resolve(undefined) });
  const state = signal<Partial<CampaignState>>({
    name: 'The Sunless Citadel',
    system: 'srd-5e-2024',
    settings: options.settings === undefined ? mkSettings() : options.settings,
  });

  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      {
        provide: CampaignStore,
        useValue: {
          state,
          role: signal(options.role ?? 'dm'),
          appendTx,
          campaignId: signal(CAMPAIGN_ID),
        },
      },
      { provide: LeaderService, useValue: { isLeader: signal(options.isLeader ?? true) } },
      { provide: ToastService, useValue: { show: toastShow } },
      { provide: DialogService, useValue: { open: dialogOpen } },
    ],
  });

  return { appendTx, toastShow, dialogOpen };
}

describe('CampaignSettingsComponent', () => {
  it('shows a read-only notice and no Save button for a player', async () => {
    configure({ role: 'player' });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.campaign-settings__readonly-notice')?.textContent?.trim()).toBe(
      campaignsEn.settings.readOnlyNotice,
    );
    expect(compiled.querySelector('.campaign-settings__save')).toBeNull();
    // Read-only mode renders plain values, not interactive chips.
    expect(compiled.querySelector('hk-chip')).toBeNull();
  });

  it('renders plain values matching the current settings for a player', async () => {
    configure({
      role: 'player',
      settings: mkSettings({ houseRules: { ...mkSettings().houseRules, xpMode: 'milestone' } }),
    });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const values = Array.from(compiled.querySelectorAll('.campaign-settings__value')).map((el) =>
      el.textContent?.trim(),
    );
    expect(values).toContain(campaignsEn.settings.houseRules.xpMode.milestone);
  });

  it('shows the Save button and chip pickers for the DM on the leader tab', async () => {
    configure({ role: 'dm', isLeader: true });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.campaign-settings__save')).not.toBeNull();
    expect(compiled.querySelectorAll('hk-chip').length).toBeGreaterThan(0);
  });

  it('disables editing for the DM on a NON-leader tab (canEdit = isDm && isLeader)', async () => {
    configure({ role: 'dm', isLeader: false });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.campaign-settings__save')).toBeNull();
    expect(compiled.querySelector('hk-chip')).toBeNull();
  });

  it('editing a field then saving appends campaign.settings_changed with the FULL settings document', async () => {
    const { appendTx } = configure({ role: 'dm', isLeader: true });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const milestoneChip = Array.from(compiled.querySelectorAll<HTMLElement>('hk-chip')).find(
      (el) => el.textContent?.trim() === campaignsEn.settings.houseRules.xpMode.milestone,
    )!;
    milestoneChip.click();
    await fixture.whenStable();

    compiled.querySelector<HTMLButtonElement>('.campaign-settings__save')!.click();
    await fixture.whenStable();

    expect(appendTx).toHaveBeenCalledTimes(1);
    const [[drafts]] = appendTx.mock.calls as [[{ type: string; v: number; payload: unknown }[]]];
    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe('campaign.settings_changed');
    expect(drafts[0].payload).toEqual({
      settings: {
        ...mkSettings(),
        houseRules: { ...mkSettings().houseRules, xpMode: 'milestone' },
      },
    });
  });

  it('toasts the not-leader error code (verbatim, no generic fallback) when appendTx rejects that way', async () => {
    const appendTx = vi.fn().mockRejectedValue(new CampaignStoreNotLeaderError());
    const { toastShow } = configure({ role: 'dm', isLeader: true, appendTx });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.campaign-settings__save')!.click();
    await fixture.whenStable();

    expect(toastShow).toHaveBeenCalledWith('campaigns.not-leader');
  });

  it('falls back to sensible doc-02 defaults when no settings document exists yet', async () => {
    configure({ role: 'dm', isLeader: true, settings: null });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const value = compiled.querySelector('hk-number-field');
    expect(value).not.toBeNull();
  });

  // --- campaign export (plan-10 Task 15) ------------------------------------------------------

  it('shows the Export campaign button for the DM, even on a NON-leader tab (export is DM-gated, not leader-gated)', async () => {
    configure({ role: 'dm', isLeader: false });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const button = compiled.querySelector<HTMLButtonElement>('.campaign-settings__export');
    expect(button).not.toBeNull();
    expect(button!.textContent?.trim()).toBe(campaignsEn.settings.exportAction);
  });

  it('hides the Export campaign button for a player', async () => {
    configure({ role: 'player' });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.campaign-settings__export')).toBeNull();
  });

  it('clicking Export opens CampaignExportDialogComponent with the current campaignId and name', async () => {
    const { dialogOpen } = configure({ role: 'dm', isLeader: true });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.campaign-settings__export')!.click();

    expect(dialogOpen).toHaveBeenCalledWith(CampaignExportDialogComponent, {
      data: { campaignId: CAMPAIGN_ID, name: 'The Sunless Citadel' },
    });
  });
});
