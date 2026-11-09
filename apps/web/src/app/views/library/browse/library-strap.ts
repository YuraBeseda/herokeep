import type { StrapConfig } from '../../../ui/action-strap/action-strap.service';

/** What the library browse strap's buttons do; the browse view supplies the callbacks. */
export interface LibraryStrapHandlers {
  readonly newHomebrew: () => void;
  readonly importPack: () => void;
  readonly focusFilter: () => void;
  readonly focusSearch: () => void;
}

/**
 * The strap on `/library` (board LB01): New homebrew and Import pack in zone 2 (both lead to the
 * packs screens), Filter and Search in zone 3 (they move focus to the type chips and the field).
 */
export function buildLibraryStrap(h: LibraryStrapHandlers): StrapConfig {
  return {
    primary: [
      {
        id: 'new-homebrew',
        label: 'shell.strap.library-new-homebrew',
        icon: 'add',
        kind: 'primary',
        run: h.newHomebrew,
      },
      {
        id: 'import-pack',
        label: 'shell.strap.library-import-pack',
        icon: 'import',
        kind: 'parchment',
        run: h.importPack,
      },
    ],
    secondary: [
      {
        id: 'filter',
        label: 'shell.icon.filter',
        icon: 'filter',
        kind: 'icon',
        run: h.focusFilter,
      },
      {
        id: 'search',
        label: 'shell.icon.search',
        icon: 'search',
        kind: 'icon',
        run: h.focusSearch,
      },
    ],
  };
}
