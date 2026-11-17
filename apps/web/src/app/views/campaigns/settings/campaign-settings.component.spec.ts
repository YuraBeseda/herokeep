import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { parsePack, type CampaignSettings, type MembershipRole, type Pack } from '@hk/protocol';
import { DialogService } from '@app/ui/dialog/dialog.service';

import { ToastService } from '@shared/components/toast/toast.service';
import { ApiError } from '@shared/services/api/api-fetch';
import {
  CampaignPacksService,
  CampaignPackUploadMismatchError,
  type CampaignPackInstallStatus,
} from '@shared/services/campaigns/campaign-packs.service';
import type { CampaignState, EnabledPack } from '@shared/services/campaigns/campaign-projection';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CampaignStore, CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import { PackStore } from '@shared/stores/pack.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import packsEn from '../../../../assets/i18n/packs/en.json';
import sampleJson from '../../../../testing/fixtures/packs/sample-content.json';
import { CampaignExportDialogComponent } from './campaign-export-dialog.component';
import { CampaignSettingsComponent } from './campaign-settings.component';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    if (langPath === 'packs/en') return of(packsEn);
    return of({});
  }
}

const parsedSample = parsePack(sampleJson);
if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
const sample: Pack = parsedSample.pack;
/** A newer version of `sample` installed beside it (one campaign version per pack id). */
const sampleNext: Pack = { ...sample, version: '1.1.0' };
const second: Pack = {
  ...sample,
  id: 'second-pack',
  name: 'Second pack',
  entities: [],
  assets: [],
};
/** A homebrew line — an installed content pack the campaign section never offers. */
const homebrew: Pack = {
  ...sample,
  id: 'homebrew-0a1b2c3d',
  name: 'My homebrew',
  entities: [],
  assets: [],
};
const CORE = { id: 'srd-5e-2024', version: '0.1.0' };
const SHA = 'a'.repeat(64);

function enabledAt(version: string): EnabledPack {
  return { version, sha256: SHA };
}

/** `en` text with ICU-style `{name}` params filled in (what the messageformat transpiler renders). */
function fill(text: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce(
    (out, [key, value]) => out.replace(`{${key}}`, String(value)),
    text,
  );
}

const packsText = campaignsEn.settings.packs;

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

interface PacksServiceMock {
  enable: ReturnType<typeof vi.fn>;
  changeVersion: ReturnType<typeof vi.fn>;
  disable: ReturnType<typeof vi.fn>;
  retryInstall: ReturnType<typeof vi.fn>;
  installStatus: ReturnType<typeof vi.fn>;
}

function configure(options: {
  role?: MembershipRole;
  isLeader?: boolean;
  settings?: CampaignSettings | null;
  appendTx?: ReturnType<typeof vi.fn>;
  /** The campaign's enabled packs (`CampaignStore.enabledPacks` for `CAMPAIGN_ID`). */
  enabled?: ReadonlyMap<string, EnabledPack>;
  /** `PackStore.installedContent()`. */
  installed?: Pack[];
  /** `CampaignPacksService.installStatus(CAMPAIGN_ID)()`. */
  installStatus?: ReadonlyMap<string, CampaignPackInstallStatus>;
  packs?: Partial<Omit<PacksServiceMock, 'installStatus'>>;
}): {
  appendTx: ReturnType<typeof vi.fn>;
  toastShow: ReturnType<typeof vi.fn>;
  dialogOpen: ReturnType<typeof vi.fn>;
  packsService: PacksServiceMock;
} {
  const appendTx = options.appendTx ?? vi.fn().mockResolvedValue(undefined);
  const toastShow = vi.fn();
  const dialogOpen = vi.fn().mockReturnValue({ closed: Promise.resolve(undefined) });
  const state = signal<Partial<CampaignState>>({
    name: 'The Sunless Citadel',
    system: 'srd-5e-2024',
    settings: options.settings === undefined ? mkSettings() : options.settings,
  });
  const packsService: PacksServiceMock = {
    enable: options.packs?.enable ?? vi.fn().mockResolvedValue(undefined),
    changeVersion: options.packs?.changeVersion ?? vi.fn().mockResolvedValue(undefined),
    disable: options.packs?.disable ?? vi.fn().mockResolvedValue(undefined),
    retryInstall: options.packs?.retryInstall ?? vi.fn().mockResolvedValue(undefined),
    installStatus: vi.fn().mockReturnValue(signal(options.installStatus ?? new Map())),
  };

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
      provideTranslocoMessageformat(),
      {
        provide: CampaignStore,
        useValue: {
          state,
          role: signal(options.role ?? 'dm'),
          appendTx,
          campaignId: signal(CAMPAIGN_ID),
          enabledPacks: signal(new Map([[CAMPAIGN_ID, options.enabled ?? new Map()]])),
        },
      },
      { provide: LeaderService, useValue: { isLeader: signal(options.isLeader ?? true) } },
      { provide: ToastService, useValue: { show: toastShow } },
      { provide: DialogService, useValue: { open: dialogOpen } },
      {
        provide: PackStore,
        useValue: { installedContent: signal(options.installed ?? []), corePack: signal(CORE) },
      },
      { provide: CampaignPacksService, useValue: packsService },
    ],
  });

  return { appendTx, toastShow, dialogOpen, packsService };
}

async function render(): Promise<{
  fixture: ComponentFixture<CampaignSettingsComponent>;
  compiled: HTMLElement;
}> {
  const fixture = TestBed.createComponent(CampaignSettingsComponent);
  await fixture.whenStable();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

/** The content-packs section's row for `packId`. */
function packRow(root: HTMLElement, packId: string): HTMLElement {
  const row = root.querySelector<HTMLElement>(`.campaign-packs__row[data-pack-id="${packId}"]`);
  if (!row) throw new Error(`no content-pack row for ${packId}`);
  return row;
}

function packRowIds(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.campaign-packs__row')).map(
    (row) => row.dataset['packId'] ?? '',
  );
}

function buttonLabelled(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === label,
  );
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
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
    expect(compiled.querySelector('.campaign-settings__option')).toBeNull();
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
    expect(compiled.querySelectorAll('.campaign-settings__option').length).toBeGreaterThan(0);
  });

  it('disables editing for the DM on a NON-leader tab (canEdit = isDm && isLeader)', async () => {
    configure({ role: 'dm', isLeader: false });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.campaign-settings__save')).toBeNull();
    expect(compiled.querySelector('.campaign-settings__option')).toBeNull();
  });

  it('editing a field then saving appends campaign.settings_changed with the FULL settings document', async () => {
    const { appendTx } = configure({ role: 'dm', isLeader: true });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const milestoneChip = Array.from(
      compiled.querySelectorAll<HTMLElement>('.campaign-settings__option'),
    ).find((el) => el.textContent?.trim() === campaignsEn.settings.houseRules.xpMode.milestone)!;
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

  it('shows the four house-rule toggles on by default; switching one off saves campaign.settings_changed@2', async () => {
    const { appendTx } = configure({ role: 'dm', isLeader: true });
    const fixture = TestBed.createComponent(CampaignSettingsComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const label = campaignsEn.settings.houseRules.rules.playersAddItems.label;
    const toggles = Array.from(compiled.querySelectorAll<HTMLElement>('hk-toggle')).filter((el) =>
      Object.values(campaignsEn.settings.houseRules.rules).some((r) =>
        el.textContent?.includes(r.label),
      ),
    );
    expect(toggles).toHaveLength(4);
    toggles.forEach((el) =>
      expect(el.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true'),
    );

    toggles
      .find((el) => el.textContent?.includes(label))!
      .querySelector('button')!
      .click();
    await fixture.whenStable();
    compiled.querySelector<HTMLButtonElement>('.campaign-settings__save')!.click();
    await fixture.whenStable();

    const [[drafts]] = appendTx.mock.calls as [
      [{ type: string; v: number; payload: { settings: { houseRules: object } } }[]],
    ];
    expect(drafts[0]).toMatchObject({ type: 'campaign.settings_changed', v: 2 });
    expect(drafts[0].payload.settings.houseRules).toMatchObject({ playersAddItems: false });
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

  // --- content packs (plan-16 Task 3) ---------------------------------------------------------

  describe('content packs section', () => {
    it('sits right after House rules and lists one row per installed content pack for the DM — never a homebrew pack', async () => {
      configure({ role: 'dm', isLeader: true, installed: [sample, sampleNext, second, homebrew] });
      const { compiled } = await render();

      const headings = Array.from(compiled.querySelectorAll('.hk-leaf__title-text')).map((h) =>
        text(h),
      );
      expect(headings.slice(0, 3)).toEqual([
        campaignsEn.settings.houseRules.title,
        packsText.title,
        campaignsEn.settings.visibility.title,
      ]);
      expect(packRowIds(compiled)).toEqual(['sample-content', 'second-pack']);
      const row = packRow(compiled, 'sample-content');
      expect(text(row)).toContain(sample.name);
      // The highest installed version is the one on offer.
      expect(text(row)).toContain(fill(packsText.version, { version: '1.1.0' }));
      expect(text(compiled.querySelector('.campaign-packs__quota'))).toBe(
        fill(packsText.quota, { count: 0, max: 6 }),
      );
    });

    it('Enable uploads the highest installed version through CampaignPacksService.enable() exactly once', async () => {
      const { packsService } = configure({ installed: [sample, sampleNext, second] });
      const { fixture, compiled } = await render();

      buttonLabelled(packRow(compiled, 'sample-content'), packsText.enable)!.click();
      await fixture.whenStable();

      expect(packsService.enable).toHaveBeenCalledTimes(1);
      expect(packsService.enable).toHaveBeenCalledWith(CAMPAIGN_ID, sampleNext);
    });

    it('a pack enabled at the installed version offers Disable only (no re-enable, no update); Disable calls disable()', async () => {
      const { packsService } = configure({
        installed: [sample, second],
        enabled: new Map([['sample-content', enabledAt('1.0.0')]]),
      });
      const { fixture, compiled } = await render();
      const row = packRow(compiled, 'sample-content');

      expect(text(row)).toContain(fill(packsText.enabledVersion, { version: '1.0.0' }));
      expect(buttonLabelled(row, packsText.enable)).toBeUndefined();
      expect(row.querySelector('.campaign-packs__update')).toBeNull();
      expect(text(compiled.querySelector('.campaign-packs__quota'))).toBe(
        fill(packsText.quota, { count: 1, max: 6 }),
      );

      buttonLabelled(row, packsText.disable)!.click();
      await fixture.whenStable();

      expect(packsService.disable).toHaveBeenCalledTimes(1);
      expect(packsService.disable).toHaveBeenCalledWith(CAMPAIGN_ID, 'sample-content');
      expect(packsService.enable).not.toHaveBeenCalled();
    });

    it('offers "Update campaign version" when this device holds a newer version; it calls changeVersion() with that version', async () => {
      const { packsService } = configure({
        installed: [sample, sampleNext],
        enabled: new Map([['sample-content', enabledAt('1.0.0')]]),
      });
      const { fixture, compiled } = await render();
      const row = packRow(compiled, 'sample-content');

      const update = buttonLabelled(row, fill(packsText.update, { version: '1.1.0' }));
      expect(update).toBeDefined();
      update!.click();
      await fixture.whenStable();

      expect(packsService.changeVersion).toHaveBeenCalledTimes(1);
      expect(packsService.changeVersion).toHaveBeenCalledWith(CAMPAIGN_ID, sampleNext);
      expect(packsService.enable).not.toHaveBeenCalled();
    });

    it('never offers an update to an OLDER local version than the enabled one', async () => {
      configure({
        installed: [sample],
        enabled: new Map([['sample-content', enabledAt('2.0.0')]]),
      });
      const { compiled } = await render();
      const row = packRow(compiled, 'sample-content');

      expect(row.querySelector('.campaign-packs__update')).toBeNull();
      expect(buttonLabelled(row, packsText.enable)).toBeUndefined();
      expect(buttonLabelled(row, packsText.disable)).toBeDefined();
    });

    it('shows the quota as n / 6 and blocks Enable once the campaign is at the limit', async () => {
      const enabled = new Map(
        ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => [id, enabledAt('1.0.0')] as const),
      );
      configure({ installed: [second], enabled });
      const { compiled } = await render();

      expect(text(compiled.querySelector('.campaign-packs__quota'))).toBe(
        fill(packsText.quota, { count: 6, max: 6 }),
      );
      // The enabled packs this device does not hold are still listed (so they can be disabled).
      expect(packRowIds(compiled)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'second-pack']);
      expect(buttonLabelled(packRow(compiled, 'second-pack'), packsText.enable)!.disabled).toBe(
        true,
      );
      expect(buttonLabelled(packRow(compiled, 'p1'), packsText.disable)!.disabled).toBe(false);
    });

    it('while an upload runs the buttons are disabled and the row shows a busy indicator', async () => {
      let finish!: () => void;
      const upload = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const enable = vi.fn().mockReturnValue(upload);
      configure({ installed: [sample, second], packs: { enable } });
      const { fixture, compiled } = await render();

      buttonLabelled(packRow(compiled, 'sample-content'), packsText.enable)!.click();
      await fixture.whenStable();

      const row = packRow(compiled, 'sample-content');
      expect(text(row.querySelector('.campaign-packs__busy'))).toBe(packsText.busy);
      expect(buttonLabelled(row, packsText.enable)!.disabled).toBe(true);
      expect(buttonLabelled(packRow(compiled, 'second-pack'), packsText.enable)!.disabled).toBe(
        true,
      );

      finish();
      // The component's own continuation on `upload` runs first (it subscribed first), so by the
      // time this await resumes the busy flag is cleared and a render is scheduled.
      await upload;
      await fixture.whenStable();

      expect(compiled.querySelector('.campaign-packs__busy')).toBeNull();
      expect(buttonLabelled(packRow(compiled, 'second-pack'), packsText.enable)!.disabled).toBe(
        false,
      );
    });

    it.each([
      ['a 409 quota refusal', new ApiError(409, 'quota_exceeded', 'full'), 'quota'],
      ['a 413 too-large refusal', new ApiError(413, 'payload_too_large', 'big'), 'tooLarge'],
      ['any other failure', new Error('boom'), 'enableFailed'],
    ])('toasts %s from enable() with its own text', async (_label, error, key) => {
      const enable = vi.fn().mockRejectedValue(error);
      const { toastShow } = configure({ installed: [sample], packs: { enable } });
      const { fixture, compiled } = await render();

      buttonLabelled(packRow(compiled, 'sample-content'), packsText.enable)!.click();
      await fixture.whenStable();

      expect(toastShow).toHaveBeenCalledWith(`campaigns.settings.packs.toast.${key}`);
      // Settled: the row is usable again.
      expect(compiled.querySelector('.campaign-packs__busy')).toBeNull();
      expect(buttonLabelled(packRow(compiled, 'sample-content'), packsText.enable)!.disabled).toBe(
        false,
      );
    });

    it.each([
      ['an upload digest mismatch', new CampaignPackUploadMismatchError('sample-content@1.0.0')],
      ['a non-leader refusal', new CampaignStoreNotLeaderError()],
    ])('toasts the error code of %s verbatim', async (_label, error) => {
      const enable = vi.fn().mockRejectedValue(error);
      const { toastShow } = configure({ installed: [sample], packs: { enable } });
      const { fixture, compiled } = await render();

      buttonLabelled(packRow(compiled, 'sample-content'), packsText.enable)!.click();
      await fixture.whenStable();

      expect(toastShow).toHaveBeenCalledWith(error.code);
    });

    it('toasts a failed Disable', async () => {
      const disable = vi.fn().mockRejectedValue(new Error('boom'));
      const { toastShow } = configure({
        installed: [sample],
        enabled: new Map([['sample-content', enabledAt('1.0.0')]]),
        packs: { disable },
      });
      const { fixture, compiled } = await render();

      buttonLabelled(packRow(compiled, 'sample-content'), packsText.disable)!.click();
      await fixture.whenStable();

      expect(toastShow).toHaveBeenCalledWith('campaigns.settings.packs.toast.disableFailed');
    });

    it('a DM on a NON-leader tab sees the section disabled with the not-leader reason', async () => {
      const { packsService } = configure({
        role: 'dm',
        isLeader: false,
        installed: [sample, second],
        enabled: new Map([['sample-content', enabledAt('1.0.0')]]),
      });
      const { fixture, compiled } = await render();
      const section = compiled.querySelector<HTMLElement>('.campaign-packs')!;

      expect(text(section.querySelector('.campaign-packs__notice'))).toBe(
        campaignsEn['not-leader'],
      );
      const buttons = Array.from(section.querySelectorAll<HTMLButtonElement>('button'));
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((b) => b.disabled)).toBe(true);

      buttonLabelled(packRow(compiled, 'sample-content'), packsText.disable)!.click();
      await fixture.whenStable();
      expect(packsService.disable).not.toHaveBeenCalled();
    });

    it('the DM leader sees no not-leader reason', async () => {
      configure({ role: 'dm', isLeader: true, installed: [sample] });
      const { compiled } = await render();
      expect(compiled.querySelector('.campaign-packs__notice')).toBeNull();
    });

    it('a member sees the enabled packs read-only, each with its install status on this device', async () => {
      const { packsService } = configure({
        role: 'player',
        installed: [sample, second],
        enabled: new Map([
          ['sample-content', enabledAt('1.0.0')],
          ['second-pack', enabledAt('2.0.0')],
          ['other-pack', enabledAt('1.0.0')],
          ['gone-pack', enabledAt('1.0.0')],
        ]),
        installStatus: new Map<string, CampaignPackInstallStatus>([
          ['sample-content', { state: 'installed' }],
          ['second-pack', { state: 'installing' }],
          ['other-pack', { state: 'error', code: 'packs.import-failed-conflict' }],
          ['gone-pack', { state: 'error', code: 'campaigns.packs.install-failed-unavailable' }],
        ]),
      });
      const { compiled } = await render();

      expect(packsService.installStatus).toHaveBeenCalledWith(CAMPAIGN_ID);
      expect(packRowIds(compiled)).toEqual([
        'gone-pack',
        'other-pack',
        'sample-content',
        'second-pack',
      ]);
      const status = (packId: string) =>
        text(packRow(compiled, packId).querySelector('.campaign-packs__status'));
      expect(status('sample-content')).toBe(packsText.status.installed);
      expect(status('second-pack')).toBe(packsText.status.installing);
      // Error codes from the `packs` scope and the `campaigns` scope both render as text.
      expect(status('other-pack')).toBe(packsEn['import-failed-conflict']);
      expect(status('gone-pack')).toBe(campaignsEn.packs['install-failed-unavailable']);
      // Names come from the local copy when this device has one; otherwise the pack id.
      expect(text(packRow(compiled, 'sample-content'))).toContain(sample.name);
      expect(text(packRow(compiled, 'other-pack'))).toContain('other-pack');
      expect(text(packRow(compiled, 'second-pack'))).toContain(
        fill(packsText.version, { version: '2.0.0' }),
      );
      // Read-only: no Enable / Disable / update for a member.
      const section = compiled.querySelector<HTMLElement>('.campaign-packs')!;
      expect(buttonLabelled(section, packsText.enable)).toBeUndefined();
      expect(buttonLabelled(section, packsText.disable)).toBeUndefined();
      expect(section.querySelector('.campaign-packs__update')).toBeNull();
      expect(section.querySelector('.campaign-packs__quota')).toBeNull();
    });

    it('Retry on a refused pack calls retryInstall() for it — only refused packs offer Retry', async () => {
      const { packsService } = configure({
        role: 'player',
        enabled: new Map([
          ['sample-content', enabledAt('1.0.0')],
          ['other-pack', enabledAt('1.0.0')],
        ]),
        installStatus: new Map<string, CampaignPackInstallStatus>([
          ['sample-content', { state: 'installed' }],
          ['other-pack', { state: 'error', code: 'packs.import-failed-conflict' }],
        ]),
      });
      const { fixture, compiled } = await render();

      expect(buttonLabelled(packRow(compiled, 'sample-content'), packsText.retry)).toBeUndefined();
      buttonLabelled(packRow(compiled, 'other-pack'), packsText.retry)!.click();
      await fixture.whenStable();

      expect(packsService.retryInstall).toHaveBeenCalledTimes(1);
      expect(packsService.retryInstall).toHaveBeenCalledWith(CAMPAIGN_ID, 'other-pack');
    });

    it('a member on a NON-leader tab cannot Retry (installs run on the leader tab)', async () => {
      configure({
        role: 'player',
        isLeader: false,
        enabled: new Map([['other-pack', enabledAt('1.0.0')]]),
        installStatus: new Map<string, CampaignPackInstallStatus>([
          ['other-pack', { state: 'error', code: 'packs.import-failed-conflict' }],
        ]),
      });
      const { compiled } = await render();

      expect(buttonLabelled(packRow(compiled, 'other-pack'), packsText.retry)!.disabled).toBe(true);
    });

    it('shows an empty state for a DM with no content packs and for a campaign with none enabled', async () => {
      configure({ role: 'dm', installed: [homebrew] });
      const dm = await render();
      expect(text(dm.compiled.querySelector('.campaign-packs__empty'))).toBe(packsText.empty);

      TestBed.resetTestingModule();
      configure({ role: 'player' });
      const member = await render();
      expect(text(member.compiled.querySelector('.campaign-packs__empty'))).toBe(
        packsText.noneEnabled,
      );
    });
  });

  describe('house rules on the new library', () => {
    it('renders the boolean rules as switches that save through the same document', async () => {
      const { appendTx } = configure({ role: 'dm', isLeader: true });
      const fixture = TestBed.createComponent(CampaignSettingsComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const switches = Array.from(compiled.querySelectorAll<HTMLElement>('button[role="switch"]'));
      expect(
        switches.map((el) => el.querySelector('.hk-toggle__label')?.textContent?.trim()),
      ).toEqual([
        campaignsEn.settings.houseRules.strictValidation,
        campaignsEn.settings.houseRules.allowOverrides,
        ...Object.values(campaignsEn.settings.houseRules.rules).map((r) => r.label),
        campaignsEn.settings.visibility.allowPrivateRolls,
        campaignsEn.settings.join.open,
        campaignsEn.settings.join.requireApproval,
      ]);
      switches[1].click();
      await fixture.whenStable();
      compiled.querySelector<HTMLButtonElement>('.campaign-settings__save')!.click();
      await fixture.whenStable();
      const settings = (
        appendTx.mock.calls[0][0] as { payload: { settings: CampaignSettings } }[]
      )[0].payload.settings;
      expect(settings.houseRules.allowOverrides).toBe(false);
    });

    it('marks the chosen option of each single-choice rule as pressed and moves the mark on click', async () => {
      configure({ role: 'dm', isLeader: true });
      const fixture = TestBed.createComponent(CampaignSettingsComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const group = compiled.querySelector<HTMLElement>(
        '[role="group"][aria-label="Advancement"]',
      )!;
      const pressed = () =>
        Array.from(group.querySelectorAll('button'))
          .filter((b) => b.getAttribute('aria-pressed') === 'true')
          .map((b) => b.textContent?.trim());
      expect(pressed()).toEqual([campaignsEn.settings.houseRules.xpMode.xp]);
      Array.from(group.querySelectorAll('button'))[1].click();
      await fixture.whenStable();
      expect(pressed()).toEqual([campaignsEn.settings.houseRules.xpMode.milestone]);
    });

    it('shows a read-only player the switches off-limits instead of live controls', async () => {
      configure({ role: 'player' });
      const fixture = TestBed.createComponent(CampaignSettingsComponent);
      await fixture.whenStable();
      const switches = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
          'button[role="switch"]',
        ),
      );
      expect(switches.length).toBe(9);
      expect(switches.every((b) => b.disabled)).toBe(true);
    });
  });

  describe('leaving with unsaved house rules', () => {
    it('leaves silently while nothing is edited', async () => {
      const { dialogOpen } = configure({ role: 'dm', isLeader: true });
      const fixture = TestBed.createComponent(CampaignSettingsComponent);
      await fixture.whenStable();
      expect(await fixture.componentInstance.canLeave()).toBe(true);
      expect(dialogOpen).not.toHaveBeenCalled();
    });

    it('asks once once a rule is edited, stays on Keep editing and leaves on Discard', async () => {
      const { dialogOpen } = configure({ role: 'dm', isLeader: true });
      const fixture = TestBed.createComponent(CampaignSettingsComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      compiled.querySelectorAll<HTMLElement>('button[role="switch"]')[0].click();
      await fixture.whenStable();
      dialogOpen.mockReturnValueOnce({ closed: Promise.resolve(false) });
      expect(await fixture.componentInstance.canLeave()).toBe(false);
      dialogOpen.mockReturnValueOnce({ closed: Promise.resolve(true) });
      expect(await fixture.componentInstance.canLeave()).toBe(true);
      expect(dialogOpen).toHaveBeenCalledTimes(2);
    });

    it('does not ask after the edit is saved', async () => {
      const { dialogOpen } = configure({ role: 'dm', isLeader: true });
      const fixture = TestBed.createComponent(CampaignSettingsComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      compiled.querySelectorAll<HTMLElement>('button[role="switch"]')[0].click();
      await fixture.whenStable();
      compiled.querySelector<HTMLButtonElement>('.campaign-settings__save')!.click();
      await fixture.whenStable();
      expect(await fixture.componentInstance.canLeave()).toBe(true);
      expect(dialogOpen).not.toHaveBeenCalled();
    });
  });
});
