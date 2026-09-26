import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
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

function configure(options: { isLeader?: boolean } = {}): void {
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
      {
        provide: CampaignStore,
        useValue: {
          state: signal({ name: 'Curse of Strahd' }),
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
