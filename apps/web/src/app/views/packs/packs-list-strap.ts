import type { StrapConfig } from '../../ui/action-strap/action-strap.service';

/** What the packs list strap's buttons do; the list supplies the callbacks. */
export interface PacksListStrapHandlers {
  readonly importPack: () => void;
  readonly newHomebrew: () => void;
  readonly importing: boolean;
}

/** The strap on `/packs` (board PK01): Import pack and New homebrew in zone 2. */
export function buildPacksListStrap(h: PacksListStrapHandlers): StrapConfig {
  return {
    primary: [
      {
        id: 'import-pack',
        label: 'shell.strap.library-import-pack',
        icon: 'import',
        kind: 'primary',
        disabled: h.importing,
        run: h.importPack,
      },
      {
        id: 'new-homebrew',
        label: 'shell.strap.library-new-homebrew',
        icon: 'add',
        kind: 'parchment',
        run: h.newHomebrew,
      },
    ],
    secondary: [
      {
        id: 'check-updates',
        label: 'shell.strap.packs-check',
        icon: 'level-up',
        kind: 'icon',
        disabled: true,
        disabledReason: 'shell.strap.packs-check-none',
        run: () => undefined,
      },
    ],
  };
}
