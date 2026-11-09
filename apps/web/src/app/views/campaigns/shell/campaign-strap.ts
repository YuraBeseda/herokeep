import type { StrapAction, StrapConfig } from '../../../ui/action-strap/action-strap.service';
import type { DmEffectKind } from './campaign-selection.service';

/** What the campaign strap's buttons do; the shell supplies the callbacks. */
export interface CampaignStrapHandlers {
  readonly effect: (kind: DmEffectKind) => void;
  readonly toggleSession: () => void;
  readonly exportCampaign: () => void;
  readonly openSheet: () => void;
}

export interface CampaignStrapState {
  readonly role: 'dm' | 'player' | undefined;
  /** A party member is selected: the effects act on them. */
  readonly selected: boolean;
  readonly sessionActive: boolean;
  /** The player has an active hero in this campaign to open. */
  readonly canOpenSheet: boolean;
  /** The campaign's path prefix (`['/g', id]`) so the strap survives tab changes inside it. */
  readonly scope: readonly string[];
}

const NEEDS_MEMBER = 'shell.strap.campaign-select-member';

/**
 * The campaign's action strap (spec §3, boards C06 and C07): the DM gets Damage · Heal ·
 * Condition · XP · Item (acting on the selected member) and Session · Export; a player gets Open my
 * sheet. A pure builder: the shell calls it from an effect and hands the result to
 * `ActionStrapService`.
 */
export function buildCampaignStrap(
  state: CampaignStrapState,
  h: CampaignStrapHandlers,
): StrapConfig {
  if (state.role !== 'dm') {
    return {
      primary: state.canOpenSheet
        ? [
            {
              id: 'open-sheet',
              label: 'shell.strap.campaign-open-sheet',
              icon: 'heroes',
              kind: 'primary',
              run: h.openSheet,
            },
          ]
        : [],
      scope: state.scope,
    };
  }

  const effect = (
    kind: DmEffectKind,
    label: string,
    icon: StrapAction['icon'],
    style: StrapAction['kind'],
  ): StrapAction => ({
    id: kind,
    label,
    icon,
    kind: style,
    run: () => h.effect(kind),
    ...(state.selected ? {} : { disabled: true, disabledReason: NEEDS_MEMBER }),
  });

  return {
    primary: [
      effect('damage', 'shell.icon.damage', 'damage', 'ember'),
      effect('heal', 'shell.icon.heal', 'heal', 'primary'),
      effect('condition', 'shell.icon.condition', 'condition', 'ghost'),
      effect('xp', 'shell.icon.xp', 'xp', 'ghost'),
      effect('item', 'shell.strap.campaign-item', 'bag', 'ghost'),
    ],
    secondary: [
      {
        id: 'session',
        label: state.sessionActive
          ? 'shell.strap.campaign-session-end'
          : 'shell.strap.campaign-session-start',
        icon: 'session',
        kind: 'icon',
        run: h.toggleSession,
      },
      {
        id: 'export',
        label: 'shell.icon.export',
        icon: 'export',
        kind: 'icon',
        run: h.exportCampaign,
      },
    ],
    scope: state.scope,
  };
}
