import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { AuthService } from '@shared/services/auth/auth.service';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { DialogService } from '../../../ui/dialog/dialog.service';
import { TabBarService } from '../../../ui/tab-bar/tab-bar.service';
import { stubViewport } from '../../../ui/testing/viewport';
import { CampaignExportDialogComponent } from '../settings/campaign-export-dialog.component';
import { CampaignSelectionService } from './campaign-selection.service';
import { CampaignShellComponent } from './campaign-shell.component';

const ID = '00000000-0000-4000-8000-000000000001';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

interface Spies {
  appendTx: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
}

function configure(
  options: {
    isLeader?: boolean;
    session?: { active: boolean; title?: string };
    role?: 'dm' | 'player';
    roster?: [string, { ownerId: string; left: boolean }][];
  } = {},
): Spies {
  const appendTx = vi.fn().mockResolvedValue(undefined);
  const open = vi.fn().mockReturnValue({ closed: Promise.resolve(undefined) });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'g/:id',
          component: CampaignShellComponent,
          children: [
            { path: '', pathMatch: 'full', redirectTo: 'party' },
            { path: 'party', children: [] },
            { path: 'log', children: [] },
            { path: 'settings', children: [] },
            { path: 'lobby', children: [] },
          ],
        },
        { path: 'elsewhere', children: [] },
      ]),
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
          state: signal({
            name: 'Curse of Strahd',
            session: options.session,
            roster: new Map(options.roster ?? []),
          }),
          role: signal(options.role ?? 'dm'),
          campaignId: signal(ID),
          appendTx,
        },
      },
      { provide: LeaderService, useValue: { isLeader: signal(options.isLeader ?? true) } },
      { provide: AuthService, useValue: { user: signal({ userId: 'u1' }) } },
      { provide: DialogService, useValue: { open } },
    ],
  });
  return { appendTx, open };
}

function strapAction(id: string) {
  const config = TestBed.inject(ActionStrapService).config();
  return [...(config?.primary ?? []), ...(config?.secondary ?? [])].find((a) => a.id === id);
}

describe('CampaignShellComponent', () => {
  it('gives the campaign name a tooltip with the full text, not a native title', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const hosts = harness.fixture.debugElement.queryAll(By.css('.campaign-shell__name'));
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host.injector.get(HkTooltipDirective, null)).not.toBeNull();
      expect(host.nativeElement.hasAttribute('title')).toBe(false);
      expect(host.nativeElement.hasAttribute('data-truncate')).toBe(true);
    }
  });

  it('renders the campaign name and role badge', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const compiled = harness.routeNativeElement!;
    expect(compiled.querySelector('.campaign-shell__name')?.textContent?.trim()).toBe(
      'Curse of Strahd',
    );
    expect(compiled.querySelector('.campaign-shell__role')?.textContent?.trim()).toBe(
      campaignsEn.roles.dm,
    );
  });

  it('redirects the bare /g/:id to the party tab by default', async () => {
    configure();
    await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/g/00000000-0000-4000-8000-000000000001/party');
  });

  it('shows no stale notice on the leader tab', async () => {
    configure({ isLeader: true });
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const compiled = harness.routeNativeElement!;
    expect(compiled.querySelector('.campaign-shell__stale')).toBeNull();
  });

  it('shows the follower-mode stale notice when this tab is not the leader', async () => {
    configure({ isLeader: false });
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const compiled = harness.routeNativeElement!;
    expect(
      compiled.querySelector('[role="status"].campaign-shell__stale')?.textContent?.trim(),
    ).toBe(campaignsEn.shell.staleNotice);
  });

  it('shows no active-session indicator when there is no session yet', async () => {
    configure({ session: undefined });
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const compiled = harness.routeNativeElement!;
    expect(compiled.querySelector('.campaign-shell__session')).toBeNull();
  });

  it('shows no active-session indicator while the session is inactive', async () => {
    configure({ session: { active: false } });
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const compiled = harness.routeNativeElement!;
    expect(compiled.querySelector('.campaign-shell__session')).toBeNull();
  });

  it('shows the active-session indicator (with title) as a status region while a session is active', async () => {
    configure({ session: { active: true, title: 'Session 4: Into the mist' } });
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const compiled = harness.routeNativeElement!;
    const indicator = compiled.querySelector('.campaign-shell__session');
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute('role')).toBe('status');
    expect(indicator?.textContent?.trim()).toBe(
      campaignsEn.shell.session.activeWithTitle.replace('{title}', 'Session 4: Into the mist'),
    );
  });

  it('shows the title-less active-session indicator when the started session carries no title', async () => {
    configure({ session: { active: true } });
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const compiled = harness.routeNativeElement!;
    expect(compiled.querySelector('.campaign-shell__session')?.textContent?.trim()).toBe(
      campaignsEn.shell.session.active,
    );
  });

  it('coexists with the follower-mode stale notice (both render when both conditions hold)', async () => {
    configure({ isLeader: false, session: { active: true, title: 'Session 4' } });
    const harness = await RouterTestingHarness.create('/g/00000000-0000-4000-8000-000000000001');
    const compiled = harness.routeNativeElement!;
    expect(compiled.querySelector('.campaign-shell__stale')).not.toBeNull();
    expect(compiled.querySelector('.campaign-shell__session')).not.toBeNull();
  });

  it('navigates between tabs via the tab row', async () => {
    configure();
    const harness = await RouterTestingHarness.create(
      '/g/00000000-0000-4000-8000-000000000001/party',
    );
    const compiled = harness.routeNativeElement!;
    const lobbyTab = Array.from(compiled.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (el) => el.textContent?.trim() === campaignsEn.shell.tabs.lobby,
    )!;
    lobbyTab.click();
    await harness.fixture.whenStable();
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/g/00000000-0000-4000-8000-000000000001/lobby');
  });

  describe('the campaign tabs, the strap and the phone tab bar', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('puts Party · Table · Lobby · Settings on the phone tab bar, the Table tab keeping the log route', async () => {
      stubViewport({ phone: true });
      configure();
      await RouterTestingHarness.create(`/g/${ID}/party`);
      const tabs = TestBed.inject(TabBarService).tabs();
      expect(tabs?.map((t) => t.route)).toEqual([
        ['/g', ID, 'party'],
        ['/g', ID, 'log'],
        ['/g', ID, 'lobby'],
        ['/g', ID, 'settings'],
      ]);
      expect(tabs?.map((t) => t.label)).toEqual([
        'shell.tabs.campaign-party',
        'shell.tabs.campaign-table',
        'shell.tabs.campaign-lobby',
        'shell.tabs.campaign-settings',
      ]);
      expect(campaignsEn.shell.tabs.log).toBe('Table');
    });

    it('leaves the tab bar empty on desktop and shows the four tabs on the page', async () => {
      stubViewport({ phone: false });
      configure();
      const harness = await RouterTestingHarness.create(`/g/${ID}/log`);
      expect(TestBed.inject(TabBarService).tabs()).toBeNull();
      const tabs = Array.from(
        harness.routeNativeElement!.querySelectorAll<HTMLElement>('[role="tab"]'),
      );
      expect(tabs.map((t) => t.textContent?.trim())).toEqual([
        'Party',
        'Table',
        'Lobby',
        'Settings',
      ]);
      expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual([
        'false',
        'true',
        'false',
        'false',
      ]);
    });

    it('sets the DM strap scoped to the campaign, effects disabled until a member is selected', async () => {
      configure();
      await RouterTestingHarness.create(`/g/${ID}/party`);
      const config = TestBed.inject(ActionStrapService).config()!;
      expect(config.primary.map((a) => a.id)).toEqual([
        'damage',
        'heal',
        'condition',
        'xp',
        'item',
      ]);
      expect(config.secondary?.map((a) => a.id)).toEqual(['session', 'export']);
      expect(config.scope).toEqual(['/g', ID]);
      expect(strapAction('damage')?.disabled).toBe(true);

      TestBed.inject(CampaignSelectionService).toggle({ characterId: 'c1', name: 'Ilyana' });
      TestBed.tick();
      expect(strapAction('damage')?.disabled).toBeFalsy();
    });

    it('sends a strap effect to the selected member', async () => {
      configure();
      await RouterTestingHarness.create(`/g/${ID}/party`);
      const selection = TestBed.inject(CampaignSelectionService);
      selection.toggle({ characterId: 'c1', name: 'Ilyana' });
      TestBed.tick();
      strapAction('condition')!.run();
      expect(selection.request()).toMatchObject({ kind: 'condition', characterId: 'c1' });
    });

    it('starts the session from the strap while none is running', async () => {
      const spies = configure({ session: undefined });
      await RouterTestingHarness.create(`/g/${ID}/party`);
      strapAction('session')!.run();
      expect(spies.appendTx).toHaveBeenCalledWith([{ type: 'session.started', v: 1, payload: {} }]);
    });

    it('ends the running session from the strap', async () => {
      const spies = configure({ session: { active: true } });
      await RouterTestingHarness.create(`/g/${ID}/party`);
      strapAction('session')!.run();
      expect(spies.appendTx).toHaveBeenCalledWith([{ type: 'session.ended', v: 1, payload: {} }]);
    });

    it('opens the export dialog from the strap', async () => {
      const spies = configure();
      await RouterTestingHarness.create(`/g/${ID}/party`);
      strapAction('export')!.run();
      expect(spies.open).toHaveBeenCalledWith(CampaignExportDialogComponent, {
        data: { campaignId: ID, name: 'Curse of Strahd' },
      });
    });

    it('gives a player Open my sheet only when they have a hero, and no DM actions', async () => {
      configure({ role: 'player', roster: [['c9', { ownerId: 'u1', left: false }]] });
      await RouterTestingHarness.create(`/g/${ID}/party`);
      const config = TestBed.inject(ActionStrapService).config()!;
      expect(config.primary.map((a) => a.id)).toEqual(['open-sheet']);
      expect(config.secondary ?? []).toEqual([]);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      strapAction('open-sheet')!.run();
      expect(navigate).toHaveBeenCalledWith(['/c', 'c9']);
    });

    it('clears the strap, the tab bar and the selection when the campaign closes', async () => {
      stubViewport({ phone: true });
      configure();
      const harness = await RouterTestingHarness.create(`/g/${ID}/party`);
      TestBed.inject(CampaignSelectionService).toggle({ characterId: 'c1', name: 'Ilyana' });
      expect(TestBed.inject(TabBarService).tabs()).not.toBeNull();
      harness.fixture.destroy();
      expect(TestBed.inject(ActionStrapService).config()).toBeNull();
      expect(TestBed.inject(TabBarService).tabs()).toBeNull();
      expect(TestBed.inject(CampaignSelectionService).selected()).toBeNull();
    });

    it('follows the campaign id when the shell is reused for another campaign, and drops the selection', async () => {
      stubViewport({ phone: true });
      configure();
      const other = '00000000-0000-4000-8000-000000000002';
      const harness = await RouterTestingHarness.create(`/g/${ID}/party`);
      const selection = TestBed.inject(CampaignSelectionService);
      selection.toggle({ characterId: 'c1', name: 'Ilyana' });
      selection.requestEffect('damage');
      TestBed.tick();
      expect(TestBed.inject(ActionStrapService).config()?.scope).toEqual(['/g', ID]);

      await harness.navigateByUrl(`/g/${other}/party`);
      TestBed.tick();

      expect(TestBed.inject(ActionStrapService).config()?.scope).toEqual(['/g', other]);
      expect(TestBed.inject(TabBarService).tabs()?.[0].route).toEqual(['/g', other, 'party']);
      expect(selection.selected()).toBeNull();
      expect(selection.request()).toBeNull();
    });

    it('runs a strap effect pressed on another tab by going to Party first, once', async () => {
      configure();
      const harness = await RouterTestingHarness.create(`/g/${ID}/log`);
      const selection = TestBed.inject(CampaignSelectionService);
      selection.toggle({ characterId: 'c1', name: 'Ilyana' });
      TestBed.tick();
      strapAction('condition')!.run();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe(`/g/${ID}/party`);
      expect(selection.request()).toMatchObject({ kind: 'condition', characterId: 'c1' });
    });
  });
});
