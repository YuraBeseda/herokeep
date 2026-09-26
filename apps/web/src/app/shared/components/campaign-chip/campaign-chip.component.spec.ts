import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import type { Event } from '@hk/protocol';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharacterStore } from '@shared/stores/character.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { CampaignChipComponent } from './campaign-chip.component';
import { LeaveCampaignDialogComponent } from './leave-campaign-dialog.component';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const CHARACTER_STREAM = 'char:00000000-0000-4000-8000-0000000000c1';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

function mkEvent(type: string, payload: unknown, seq?: number): Event {
  return {
    id: `evt-${type}`,
    stream: CHARACTER_STREAM,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'usr_owner', deviceId: 'dev_1', role: 'owner' },
    type,
    v: 1,
    payload,
    ...(seq !== undefined ? { seq } : {}),
  };
}

function configure(options: {
  events?: Event[];
  campaignRow?: { name: string } | undefined;
  openSpy?: ReturnType<typeof vi.fn>;
}): { open: ReturnType<typeof vi.fn> } {
  const events = options.events ?? [];
  const open = options.openSpy ?? vi.fn().mockResolvedValue(undefined);

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
      {
        provide: CharacterStore,
        useValue: {
          events: signal(events),
          streamId: signal(CHARACTER_STREAM),
          facts: signal({ name: 'Aria' }),
        },
      },
      {
        provide: CampaignsRepository,
        useValue: {
          get: vi
            .fn()
            .mockResolvedValue(
              options.campaignRow ? { id: CAMPAIGN_ID, ...options.campaignRow } : undefined,
            ),
        },
      },
      { provide: DialogService, useValue: { open } },
    ],
  });

  return { open };
}

describe('CampaignChipComponent', () => {
  it('renders nothing for a character never linked to any campaign', async () => {
    configure({ events: [mkEvent('character.created', { name: 'Aria' }, 1)] });
    const fixture = TestBed.createComponent(CampaignChipComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.campaign-chip')).toBeNull();
  });

  it('renders nothing once the character has LEFT its last campaign', async () => {
    configure({
      events: [
        mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID }, 1),
        mkEvent('character.campaign_left', { campaignId: CAMPAIGN_ID }, 2),
      ],
    });
    const fixture = TestBed.createComponent(CampaignChipComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.campaign-chip')).toBeNull();
  });

  it('shows the campaign name (from CampaignsRepository) with a link to /g/:id, and a Leave button', async () => {
    configure({
      events: [mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID }, 1)],
      campaignRow: { name: 'Curse of Strahd' },
    });
    const fixture = TestBed.createComponent(CampaignChipComponent);
    await fixture.whenStable();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const link = compiled.querySelector<HTMLAnchorElement>('.campaign-chip__link')!;
    expect(link.textContent?.trim()).toBe('Curse of Strahd');
    expect(link.getAttribute('href')).toBe(`/g/${CAMPAIGN_ID}`);
    expect(compiled.querySelector('.campaign-chip__leave')?.textContent?.trim()).toBe(
      campaignsEn.chip.leave,
    );
  });

  it('falls back to a generic name when no CampaignsRepository row exists yet', async () => {
    configure({
      events: [mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID }, 1)],
      campaignRow: undefined,
    });
    const fixture = TestBed.createComponent(CampaignChipComponent);
    await fixture.whenStable();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.campaign-chip__link')?.textContent?.trim()).toBe(
      campaignsEn.chip.fallbackName,
    );
  });

  it('clicking Leave opens LeaveCampaignDialogComponent with the campaign/character identifiers', async () => {
    const { open } = configure({
      events: [mkEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID }, 1)],
      campaignRow: { name: 'Curse of Strahd' },
    });
    open.mockReturnValue({ closed: Promise.resolve(true) });
    const fixture = TestBed.createComponent(CampaignChipComponent);
    await fixture.whenStable();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.campaign-chip__leave')!.click();
    await fixture.whenStable();

    expect(open).toHaveBeenCalledWith(LeaveCampaignDialogComponent, {
      data: { campaignId: CAMPAIGN_ID, characterId: CHARACTER_STREAM, characterName: 'Aria' },
    });
  });
});
