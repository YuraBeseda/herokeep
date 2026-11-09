import type { StrapConfig } from '../../ui/action-strap/action-strap.service';

/** What the pack detail strap's buttons do; the detail view supplies the callbacks. */
export interface PackDetailStrapHandlers {
  readonly back: () => void;
  readonly exportPack: () => void;
  /** Full i18n key of why Export is unavailable (not found, core pack, importer would refuse it,
   * an export already running), or `null` when it is available. */
  readonly exportReason: string | null;
}

/**
 * The strap on `/packs/:key` (board PK02): Back in zone 1; "Update pack" in zone 2, drawn
 * DISABLED with its reason (updates are versions installed on the device that heroes adopt from
 * their Build tab, so there is nothing to start from the pack screen); Export as .hkpack and a
 * disabled "Browse entries in the library" in zone 3.
 */
export function buildPackDetailStrap(h: PackDetailStrapHandlers): StrapConfig {
  return {
    exit: [{ id: 'back', label: 'shell.strap.back', icon: 'leave', kind: 'ghost', run: h.back }],
    primary: [
      {
        id: 'update-pack',
        label: 'shell.strap.packs-update',
        icon: 'level-up',
        kind: 'primary',
        disabled: true,
        disabledReason: 'shell.strap.packs-update-none',
        run: () => undefined,
      },
    ],
    secondary: [
      {
        id: 'export-pack',
        label: 'shell.strap.packs-export',
        icon: 'export',
        kind: 'icon',
        disabled: h.exportReason !== null,
        ...(h.exportReason ? { disabledReason: h.exportReason } : {}),
        run: h.exportPack,
      },
      {
        id: 'browse-pack',
        label: 'shell.strap.packs-browse',
        icon: 'library',
        kind: 'icon',
        disabled: true,
        disabledReason: 'shell.strap.packs-browse-none',
        run: () => undefined,
      },
    ],
  };
}
