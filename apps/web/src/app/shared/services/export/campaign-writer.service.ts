import { inject, Injectable } from '@angular/core';
import type { Event } from '@hk/protocol';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { sanitizeHeroFileName } from './hero-writer.service';

/**
 * Task 15's ruling-9 CAMPAIGN backup bundle — a SEPARATE, small module from `HeroWriterService`
 * (a judgment call, documented here rather than extending that class): the two bundles share only
 * the fflate lazy-chunk zip PATTERN, not any content. A `.hero` bundle carries `reduce()`-derived
 * `facts`, portrait/thumb images, engine/app version pins, and a numeric `format`/`kind` manifest
 * shape (`HeroBundleManifestSchema`, `@hk/protocol`) — none of that applies here. `format`/
 * `formatVersion` here is a DIFFERENT, unrelated identifier (`'herokeep-campaign'`/`1`, ruling 9's
 * own literal shape) with no `@hk/protocol` schema of its own: v1 has no import route to validate
 * against (ruling 9: "No import in v1 — export is a backup artifact"), so a full Zod schema would
 * have no consumer — YAGNI, per task-15-brief.md's own scope cut. `sanitizeHeroFileName` IS reused
 * (imported, not copied) from `hero-writer.service.ts` — the filesystem-safety rules for a
 * `<name>.<ext>` export file are identical for a campaign name as for a character name.
 *
 * Scope cut (ruling 9, BINDING): the bundle is the CAMPAIGN stream ONLY — no member character
 * events (ownership/privacy), no blobs/images at all (campaign-stream events carry no portraits of
 * their own). `EventsRepository.byStream` returns committed rows (by `seq` asc) THEN any pending
 * (seq-less) rows appended — this writer keeps only the committed prefix (`e.seq !== undefined`);
 * pending campaign edits are a local, not-yet-synced concern that has no business inside a shared
 * backup artifact.
 *
 * `fflate` is imported LAZILY (`await import('fflate')`), same as `HeroWriterService.export` — this
 * service is the only other thing that ever pulls it in for the campaign side.
 */
@Injectable({ providedIn: 'root' })
export class CampaignWriterService {
  private readonly eventsRepository = inject(EventsRepository);

  async export(campaignId: string, name: string): Promise<CampaignBundleResult> {
    const streamId = `camp:${campaignId}`;
    const events = await this.eventsRepository.byStream(streamId);
    const committed = events.filter(
      (event): event is Event & { seq: number } => event.seq !== undefined,
    );

    const manifest: CampaignBundleManifest = {
      format: 'herokeep-campaign',
      formatVersion: 1,
      campaignId,
      name,
      exportedAt: new Date().toISOString(),
      eventCount: committed.length,
    };

    const { strToU8, zipSync } = await import('fflate');
    const ndjson = committed.map((event) => JSON.stringify(event)).join('\n');
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2) + '\n'),
      'events.ndjson': strToU8(committed.length > 0 ? ndjson + '\n' : ''),
    };
    const zipped = zipSync(files);
    const blob = new Blob([zipped], { type: 'application/zip' });

    return { blob, fileName: `${sanitizeHeroFileName(name)}.herocampaign` };
  }
}

export interface CampaignBundleManifest {
  readonly format: 'herokeep-campaign';
  readonly formatVersion: 1;
  readonly campaignId: string;
  readonly name: string;
  readonly exportedAt: string;
  readonly eventCount: number;
}

export interface CampaignBundleResult {
  readonly blob: Blob;
  readonly fileName: string;
}
