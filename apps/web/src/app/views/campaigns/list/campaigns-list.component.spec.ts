import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { HkDb, type CampaignRow } from '@shared/services/storage/dexie.db';
import { SyncService, type SyncStateValue } from '@shared/services/sync/sync.service';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { CampaignsListComponent } from './campaigns-list.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

function mkRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Curse of Strahd',
    system: 'srd-5e-2024',
    role: 'dm',
    lastSeq: 3,
    updatedAt: 1000,
    ...overrides,
  };
}

function configure(options: { open?: ReturnType<typeof vi.fn> } = {}): {
  open: ReturnType<typeof vi.fn>;
  syncState: ReturnType<typeof vi.fn>;
} {
  const open = options.open ?? vi.fn().mockReturnValue({ closed: Promise.resolve(undefined) });
  const syncStateSignals = new Map<string, ReturnType<typeof signal<SyncStateValue>>>();
  const syncState = vi.fn((streamId: string) => {
    let sig = syncStateSignals.get(streamId);
    if (!sig) {
      sig = signal<SyncStateValue>('synced');
      syncStateSignals.set(streamId, sig);
    }
    return sig;
  });

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
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
      { provide: SyncService, useValue: { syncState } },
      { provide: DialogService, useValue: { open } },
    ],
  });

  return { open, syncState };
}

function strapRun(id: string): void {
  TestBed.tick();
  TestBed.inject(ActionStrapService)
    .config()!
    .primary.find((a) => a.id === id)!
    .run();
}

describe('CampaignsListComponent', () => {
  it('shows the empty state with no cached rows', async () => {
    configure();
    // The Dexie fake is shared across spec files: start from no campaign rows.
    await TestBed.inject(HkDb).campaigns.clear();
    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.campaigns-list__empty-text')?.textContent?.trim()).toBe(
      campaignsEn.list.empty,
    );
  });

  it('lists cached campaigns with a role badge, opening one navigates to /g/:id', async () => {
    configure();
    const db = TestBed.inject(HkDb);
    await db.campaigns.clear();
    await db.campaigns.put(mkRow());
    await db.campaigns.put(
      mkRow({ id: '00000000-0000-4000-8000-000000000002', name: 'Icewind Dale', role: 'player' }),
    );

    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    const names = Array.from(compiled.querySelectorAll('.campaigns-list__name')).map((el) =>
      el.textContent?.trim(),
    );
    expect(names).toEqual(['Curse of Strahd', 'Icewind Dale']);
    const roles = Array.from(compiled.querySelectorAll('.campaigns-list__role')).map((el) =>
      el.textContent?.trim(),
    );
    expect(roles).toEqual([campaignsEn.roles.dm, campaignsEn.roles.player]);

    compiled.querySelector<HTMLButtonElement>('.campaigns-list__open')!.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/g', '00000000-0000-4000-8000-000000000001']);
  });

  it('"New campaign" opens the create dialog and navigates to the lobby on success', async () => {
    const open = vi.fn().mockReturnValue({ closed: Promise.resolve('camp:new-id') });
    configure({ open });
    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    strapRun('new-campaign');
    await fixture.whenStable();

    expect(open).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/g', 'new-id', 'lobby']);
  });

  it('"Join campaign" navigates to /join', async () => {
    configure();
    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    strapRun('join');
    expect(navigateSpy).toHaveBeenCalledWith(['/join']);
  });

  it('renders a sync badge sourced from SyncService.syncState("camp:"+id)', async () => {
    const { syncState } = configure();
    const db = TestBed.inject(HkDb);
    await db.campaigns.put(mkRow());

    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();

    expect(syncState).toHaveBeenCalledWith('camp:00000000-0000-4000-8000-000000000001');
    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector('.campaigns-list__sync-badge')?.getAttribute('data-sync-state'),
    ).toBe('synced');
  });

  it('puts New campaign and Join in strap zone 2 scoped to /campaigns', async () => {
    configure();
    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    TestBed.tick();
    const config = TestBed.inject(ActionStrapService).config()!;
    expect(config.primary.map((a) => a.id)).toEqual(['new-campaign', 'join']);
    expect(config.scope).toEqual(['/campaigns']);
    fixture.destroy();
    expect(TestBed.inject(ActionStrapService).config()).toBeNull();
  });

  it('counts the campaigns, plural-aware, and opens each tab from a card quick link', async () => {
    configure();
    const db = TestBed.inject(HkDb);
    await db.campaigns.clear();
    await db.campaigns.put(mkRow());
    await db.campaigns.put(
      mkRow({ id: '00000000-0000-4000-8000-000000000002', name: 'Icewind Dale', role: 'player' }),
    );
    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.campaigns-list__count')?.textContent?.trim()).toBe(
      '2 campaigns',
    );
    const firstCard = compiled.querySelector('.campaigns-list__item')!;
    const tabs = Array.from(firstCard.querySelectorAll<HTMLButtonElement>('.campaigns-list__tab'));
    expect(tabs.map((t) => t.dataset['tab'])).toEqual(['party', 'log', 'lobby', 'settings']);
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Party', 'Table', 'Lobby', 'Settings']);
    tabs[1].click();
    expect(navigateSpy).toHaveBeenCalledWith(['/g', '00000000-0000-4000-8000-000000000001', 'log']);
  });

  it('names the open button after the campaign and its role', async () => {
    configure();
    const db = TestBed.inject(HkDb);
    await db.campaigns.clear();
    await db.campaigns.put(mkRow());
    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    const open = (fixture.nativeElement as HTMLElement).querySelector('.campaigns-list__open')!;
    expect(open.getAttribute('aria-label')).toBe('Open Curse of Strahd, DM');
  });

  it('puts the New campaign and Join calls to action inside the empty state', async () => {
    const open = vi.fn().mockReturnValue({ closed: Promise.resolve(undefined) });
    configure({ open });
    await TestBed.inject(HkDb).campaigns.clear();
    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    compiled
      .querySelector<HTMLButtonElement>('.campaigns-list__empty .campaigns-list__join')!
      .click();
    expect(navigateSpy).toHaveBeenCalledWith(['/join']);
    compiled
      .querySelector<HTMLButtonElement>('.campaigns-list__empty .campaigns-list__create')!
      .click();
    expect(open).toHaveBeenCalled();
  });
});
