import { inject, Injectable } from '@angular/core';
import { reduce } from '@hk/engine';
import { lastCampaignLinkEvent } from '@shared/services/campaigns/character-campaign-link';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';

/** What a hero card shows beyond the Library index row. */
export interface HeroSummary {
  readonly classes: readonly { readonly classId: string; readonly level: number }[];
  readonly campaign?: { readonly id: string; readonly name: string };
}

/**
 * Read-only facts for the hero cards on Home and the heroes list: the classes and levels, and the
 * campaign the hero is currently linked to. The Library index row (`CharacterRow`) carries
 * neither, and loading a hero into `CharacterStore` just to list it would replay its whole log, so
 * this folds each stream with the pure reducer over its cached snapshot (nothing is written) and
 * scans the same events for the last campaign link.
 */
@Injectable({ providedIn: 'root' })
export class HeroSummaryService {
  private readonly eventsRepository = inject(EventsRepository);
  private readonly snapshotsRepository = inject(SnapshotsRepository);
  private readonly campaignsRepository = inject(CampaignsRepository);

  async summarize(ids: readonly string[]): Promise<Map<string, HeroSummary>> {
    const entries = await Promise.all(ids.map(async (id) => [id, await this.one(id)] as const));
    return new Map(entries);
  }

  private async one(id: string): Promise<HeroSummary> {
    const [events, snapshot] = await Promise.all([
      this.eventsRepository.byStream(id),
      this.snapshotsRepository.get(id),
    ]);
    const facts = reduce(events, snapshot, snapshot?.rules).classes;
    const classes = facts.map((entry) => ({ classId: entry.classId, level: entry.level }));

    const link = lastCampaignLinkEvent(events);
    if (link?.type !== 'character.campaign_joined') return { classes };
    const row = await this.campaignsRepository.get(link.campaignId);
    return row ? { classes, campaign: { id: row.id, name: row.name } } : { classes };
  }
}
