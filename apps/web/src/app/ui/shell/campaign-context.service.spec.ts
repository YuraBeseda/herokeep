import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Event } from '@hk/protocol';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharacterStore } from '@shared/stores/character.store';
import { NavHistoryService } from '../nav/nav-history.service';
import { ShellCampaignContext } from './campaign-context.service';

const joined = {
  type: 'character.campaign_joined',
  id: 'e1',
  seq: 1,
  payload: { campaignId: 'camp-7' },
} as unknown as Event;

function setup(path: string, store: { streamId: string | null; events: Event[] }) {
  const currentPath = signal(path);
  TestBed.configureTestingModule({
    providers: [
      { provide: NavHistoryService, useValue: { currentPath } },
      {
        provide: CharacterStore,
        useValue: { streamId: () => store.streamId, events: () => store.events },
      },
      {
        provide: CampaignsRepository,
        useValue: {
          get: (id: string) =>
            Promise.resolve(id === 'camp-7' ? { id, name: 'Emberfall' } : undefined),
        },
      },
    ],
  });
  return { currentPath, context: TestBed.inject(ShellCampaignContext) };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
}

describe('ShellCampaignContext', () => {
  it('is empty away from campaigns and unlinked heroes', async () => {
    const { context } = setup('/characters', { streamId: null, events: [] });
    await settle();
    expect(context.current()).toBeNull();
  });

  it('follows a campaign route and resolves its name', async () => {
    const { context } = setup('/g/camp-7/party', { streamId: null, events: [] });
    await settle();
    expect(context.current()).toEqual({ id: 'camp-7', name: 'Emberfall' });
  });

  it('shows the campaign of the open hero when the hero is linked', async () => {
    const { context } = setup('/c/h1/play', { streamId: 'h1', events: [joined] });
    await settle();
    expect(context.current()).toEqual({ id: 'camp-7', name: 'Emberfall' });
  });

  it('does not use another hero link for the hero route', async () => {
    const { context } = setup('/c/h2/play', { streamId: 'h1', events: [joined] });
    await settle();
    expect(context.current()).toBeNull();
  });

  it('keeps the chip with no name while the campaign row is unknown', async () => {
    const { context } = setup('/g/zzz', { streamId: null, events: [] });
    await settle();
    expect(context.current()).toEqual({ id: 'zzz', name: null });
  });
});
