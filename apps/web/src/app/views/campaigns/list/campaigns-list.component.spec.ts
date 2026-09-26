import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
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
      { provide: SyncService, useValue: { syncState } },
      { provide: DialogService, useValue: { open } },
    ],
  });

  return { open, syncState };
}

describe('CampaignsListComponent', () => {
  it('shows the empty state with no cached rows', async () => {
    configure();
    const fixture = TestBed.createComponent(CampaignsListComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.campaigns-list__empty')?.textContent?.trim()).toBe(
      campaignsEn.list.empty,
    );
  });

  it('lists cached campaigns with a role badge, opening one navigates to /g/:id', async () => {
    configure();
    const db = TestBed.inject(HkDb);
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
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.campaigns-list__create')!.click();
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
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.campaigns-list__join')!.click();
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
});
