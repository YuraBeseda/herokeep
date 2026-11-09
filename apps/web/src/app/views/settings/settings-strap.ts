import type { StrapConfig } from '../../ui/action-strap/action-strap.service';

/** What the settings strap's buttons do; the settings view supplies the callbacks. */
export interface SettingsStrapHandlers {
  readonly managePacks: () => void;
  readonly exportAll: () => void;
  readonly help: () => void;
  /** Shell i18n key saying why Export all is unavailable; `null` when it is available. */
  readonly exportReason: string | null;
  /** Already-translated note on the strap's right (e.g. "Changes apply immediately"). */
  readonly note: string;
}

/**
 * The strap on `/settings` (board ST01): Manage packs in zone 2 (it opens the packs screen), and
 * Export all heroes and Help in zone 3. Export is drawn disabled, with its reason, while there is
 * no hero to export or a run is saving, so the slot never moves.
 */
export function buildSettingsStrap(h: SettingsStrapHandlers): StrapConfig {
  return {
    primary: [
      {
        id: 'manage-packs',
        label: 'shell.strap.settings-manage-packs',
        icon: 'packs',
        kind: 'primary',
        run: h.managePacks,
      },
    ],
    secondary: [
      {
        id: 'export-all',
        label: 'shell.strap.settings-export-all',
        icon: 'export',
        kind: 'icon',
        run: h.exportAll,
        ...(h.exportReason ? { disabled: true, disabledReason: h.exportReason } : {}),
      },
      {
        id: 'help',
        label: 'shell.strap.help',
        icon: 'help',
        kind: 'icon',
        run: h.help,
      },
    ],
    status: h.note,
  };
}
