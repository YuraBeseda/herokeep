import { TestBed } from '@angular/core/testing';
import { emptyFacts, ENGINE_VERSION } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';
import { HeroSummaryService } from './hero-summary.service';

const HERO = 'char:00000000-0000-4000-8000-000000000001';
const OTHER = 'char:00000000-0000-4000-8000-000000000002';
const CAMPAIGN = '00000000-0000-4000-8000-0000000000a1';

function linkEvent(stream: string, type: string, seq: number): Event {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    stream,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'usr_owner', deviceId: 'dev_1', role: 'owner' },
    type,
    v: 1,
    payload: { campaignId: CAMPAIGN },
    seq,
  };
}

describe('HeroSummaryService', () => {
  beforeEach(async () => {
    const db = TestBed.inject(HkDb);
    await Promise.all([db.events.clear(), db.snapshots.clear(), db.campaigns.clear()]);
  });

  afterEach(() => TestBed.inject(HkDb).close());

  it('reads the classes and levels from the stream', async () => {
    const facts = emptyFacts(HERO);
    facts.classes = [
      { classId: 'srd:class/fighter', level: 3 },
      { classId: 'srd:class/rogue', level: 1 },
    ];
    await TestBed.inject(SnapshotsRepository).put(HERO, {
      seq: 5,
      facts,
      engineVersion: ENGINE_VERSION,
    });

    const summary = await TestBed.inject(HeroSummaryService).summarize([HERO]);

    expect(summary.get(HERO)?.classes).toEqual([
      { classId: 'srd:class/fighter', level: 3 },
      { classId: 'srd:class/rogue', level: 1 },
    ]);
  });

  it('names the campaign the hero is currently linked to', async () => {
    await TestBed.inject(CampaignsRepository).put({
      id: CAMPAIGN,
      name: 'The Emberfall Company',
      system: 'srd-5e-2024',
      role: 'player',
      lastSeq: 0,
      updatedAt: 1,
    });
    await TestBed.inject(EventsRepository).append([
      linkEvent(HERO, 'character.campaign_joined', 1),
    ]);

    const summary = await TestBed.inject(HeroSummaryService).summarize([HERO, OTHER]);

    expect(summary.get(HERO)?.campaign).toEqual({ id: CAMPAIGN, name: 'The Emberfall Company' });
    expect(summary.get(OTHER)?.campaign).toBeUndefined();
  });

  it('shows no campaign once the hero left it', async () => {
    await TestBed.inject(CampaignsRepository).put({
      id: CAMPAIGN,
      name: 'The Emberfall Company',
      system: 'srd-5e-2024',
      role: 'player',
      lastSeq: 0,
      updatedAt: 1,
    });
    await TestBed.inject(EventsRepository).append([
      linkEvent(HERO, 'character.campaign_joined', 1),
      linkEvent(HERO, 'character.campaign_left', 2),
    ]);

    const summary = await TestBed.inject(HeroSummaryService).summarize([HERO]);

    expect(summary.get(HERO)?.campaign).toBeUndefined();
  });

  it('omits the chip when the campaign is not known on this device', async () => {
    await TestBed.inject(EventsRepository).append([
      linkEvent(HERO, 'character.campaign_joined', 1),
    ]);

    const summary = await TestBed.inject(HeroSummaryService).summarize([HERO]);

    expect(summary.get(HERO)?.campaign).toBeUndefined();
  });
});
