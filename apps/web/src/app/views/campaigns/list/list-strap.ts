import type { StrapConfig } from '../../../ui/action-strap/action-strap.service';

/** What the campaigns list strap's buttons do; the list supplies the callbacks. */
export interface CampaignsListStrapHandlers {
  readonly create: () => void;
  readonly join: () => void;
}

/** Zone 2 of the strap on `/campaigns` (board C01): New campaign and Join. */
export function buildCampaignsListStrap(h: CampaignsListStrapHandlers): StrapConfig {
  return {
    primary: [
      {
        id: 'new-campaign',
        label: 'shell.strap.campaign-new',
        icon: 'add',
        kind: 'primary',
        run: h.create,
      },
      {
        id: 'join',
        label: 'shell.strap.campaign-join',
        icon: 'join',
        kind: 'parchment',
        run: h.join,
      },
    ],
    scope: ['/campaigns'],
  };
}
