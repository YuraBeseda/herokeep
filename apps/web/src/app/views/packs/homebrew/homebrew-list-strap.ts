import type { StrapConfig } from '../../../ui/action-strap/action-strap.service';

/** What the homebrew list strap's buttons do; the list supplies the callbacks. */
export interface HomebrewListStrapHandlers {
  readonly back: () => void;
  readonly newEntry: () => void;
  /** `null` while the homebrew pack is not loaded (nothing to export). */
  readonly exportPack: () => void;
  /** Full i18n key of why Export is unavailable, or `null`. */
  readonly exportReason: string | null;
}

/** The strap on `/packs/homebrew` (board PK04): Back, New (a chooser) and Export as .hkpack. */
export function buildHomebrewListStrap(h: HomebrewListStrapHandlers): StrapConfig {
  return {
    exit: [{ id: 'back', label: 'shell.strap.back', icon: 'leave', kind: 'ghost', run: h.back }],
    primary: [
      {
        id: 'new-entry',
        label: 'shell.strap.homebrew-new',
        icon: 'add',
        kind: 'primary',
        run: h.newEntry,
      },
    ],
    secondary: [
      {
        id: 'import-entries',
        label: 'shell.strap.homebrew-import',
        icon: 'import',
        kind: 'icon',
        disabled: true,
        disabledReason: 'shell.strap.homebrew-import-none',
        run: () => undefined,
      },
      {
        id: 'export-pack',
        label: 'shell.strap.packs-export',
        icon: 'export',
        kind: 'icon',
        disabled: h.exportReason !== null,
        ...(h.exportReason ? { disabledReason: h.exportReason } : {}),
        run: h.exportPack,
      },
    ],
  };
}
