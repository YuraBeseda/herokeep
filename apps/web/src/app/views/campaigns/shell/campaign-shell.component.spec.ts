import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { LeaderService } from '@shared/services/storage/leader.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { CampaignShellComponent } from './campaign-shell.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

function configure(
  options: { isLeader?: boolean; session?: { active: boolean; title?: string } } = {},
): void {
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
          state: signal({ name: 'Curse of Strahd', session: options.session }),
          role: signal('dm'),
        },
      },
      { provide: LeaderService, useValue: { isLeader: signal(options.isLeader ?? true) } },
    ],
  });
}

describe('CampaignShellComponent', () => {
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

  it('navigates between tabs via hk-tabs', async () => {
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
});
