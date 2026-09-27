import { TestBed } from '@angular/core/testing';
import { strFromU8, unzipSync } from 'fflate';
import { parseEvent, type Event } from '@hk/protocol';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { CampaignWriterService } from './campaign-writer.service';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const campaignId = uuid(1);
const streamId = `camp:${campaignId}`;

function mkEvent(id: string, type: string, payload: unknown): Event {
  return {
    id,
    stream: streamId,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: 'u', deviceId: 'd', role: 'dm' },
    type,
    v: 1,
    payload,
  };
}

async function unzipBlob(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

function parseNdjson(bytes: Uint8Array): unknown[] {
  const text = strFromU8(bytes);
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));
}

describe('CampaignWriterService', () => {
  // Same isolation posture as hero-writer.service.spec.ts — fake-indexeddb's `indexedDB` is
  // captured once at `dexie`'s own module-top-level scope, so clearing tables (not swapping the
  // global) is what actually isolates each test.
  beforeEach(async () => {
    const db = TestBed.inject(HkDb);
    await Promise.all([db.events.clear(), db.campaigns.clear()]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('round-trips: every committed event survives export → unzip → NDJSON parse → parseEvent, byte-equal to the source, with eventCount matching', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const created = mkEvent(uuid(10), 'campaign.created', {
      name: 'The Sunless Citadel',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '0.1.0' },
    });
    const renamed = mkEvent(uuid(11), 'campaign.renamed', { name: 'The Sunless Citadel' });
    await eventsRepository.append([created, renamed]);

    const writer = TestBed.inject(CampaignWriterService);
    const { blob, fileName } = await writer.export(campaignId, 'The Sunless Citadel');

    expect(fileName).toBe('The Sunless Citadel.herocampaign');
    expect(blob.type).toBe('application/zip');

    const zip = await unzipBlob(blob);
    expect(zip['manifest.json']).toBeDefined();
    expect(zip['events.ndjson']).toBeDefined();

    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      format: 'herokeep-campaign',
      formatVersion: 1,
      campaignId,
      name: 'The Sunless Citadel',
      eventCount: 2,
    });
    expect(typeof manifest['exportedAt']).toBe('string');

    const lines = parseNdjson(zip['events.ndjson']);
    expect(lines).toHaveLength(2);
    for (const raw of lines) {
      const result = parseEvent(raw);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    // `EventsRepository.append` assigns each event its committed `seq` (1, 2, …) — the round-trip
    // compares against the ACTUAL committed rows (via `byStream`, same source this writer reads),
    // not the pre-append draft objects, which never carried a `seq` at all.
    const committed = await eventsRepository.byStream(streamId);
    expect(lines).toEqual(committed);
  });

  it('excludes PENDING (not-yet-committed) events — only committed rows count toward events.ndjson and manifest.eventCount', async () => {
    const eventsRepository = TestBed.inject(EventsRepository);
    const created = mkEvent(uuid(20), 'campaign.created', {
      name: 'Pending Test',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '0.1.0' },
    });
    await eventsRepository.append([created]);
    const pending = mkEvent(uuid(21), 'campaign.renamed', { name: 'Pending Test Renamed' });
    await eventsRepository.appendPending([pending], 0);

    const writer = TestBed.inject(CampaignWriterService);
    const { blob } = await writer.export(campaignId, 'Pending Test');
    const zip = await unzipBlob(blob);

    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as { eventCount: number };
    expect(manifest.eventCount).toBe(1);

    const lines = parseNdjson(zip['events.ndjson']) as Event[];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.id).toBe(created.id);
    expect(lines.some((e) => e.id === pending.id)).toBe(false);
  });

  it('an empty campaign stream exports a manifest with eventCount 0 and an empty events.ndjson', async () => {
    const writer = TestBed.inject(CampaignWriterService);
    const { blob } = await writer.export(campaignId, 'Brand New');
    const zip = await unzipBlob(blob);

    const manifest = JSON.parse(strFromU8(zip['manifest.json'])) as { eventCount: number };
    expect(manifest.eventCount).toBe(0);
    expect(parseNdjson(zip['events.ndjson'])).toEqual([]);
  });
});
