import { computed, inject, Injectable, resource, type Signal } from '@angular/core';
import { campaignIdOfCharacter } from '@shared/services/campaigns/character-campaign-link';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharacterStore } from '@shared/stores/character.store';
import { NavHistoryService } from '../nav/nav-history.service';

export interface ShellCampaign {
  readonly id: string;
  /** `null` while the campaign row is unknown (not yet loaded, or not on this device). */
  readonly name: string | null;
}

/**
 * The campaign the rail's chip points at (spec §2.2): the open campaign (`/g/:id/**`) or the
 * campaign the open hero (`/c/:id/**`) is linked to. Read-only over the stores: the hero's link is
 * the last join/leave event of the hero currently loaded in `CharacterStore`, trusted only when
 * that store holds the hero the route names.
 */
@Injectable({ providedIn: 'root' })
export class ShellCampaignContext {
  private readonly history = inject(NavHistoryService);
  private readonly characterStore = inject(CharacterStore);
  private readonly campaigns = inject(CampaignsRepository);

  private readonly campaignId = computed<string | undefined>(() => {
    const path = this.history.currentPath();
    const campaign = /^\/g\/([^/]+)/.exec(path);
    if (campaign) return campaign[1];
    const hero = /^\/c\/([^/]+)/.exec(path);
    if (hero && this.characterStore.streamId() === hero[1]) {
      return campaignIdOfCharacter(this.characterStore.events());
    }
    return undefined;
  });

  private readonly row = resource({
    params: () => this.campaignId(),
    loader: ({ params: id }) => (id ? this.campaigns.get(id) : Promise.resolve(undefined)),
  });

  readonly current: Signal<ShellCampaign | null> = computed(() => {
    const id = this.campaignId();
    if (!id) return null;
    const row = this.row.hasValue() ? this.row.value() : undefined;
    return { id, name: row?.id === id ? row.name : null };
  });
}
