import type { StrapConfig } from '../../ui/action-strap/action-strap.service';

export interface AuthStrapHandlers {
  readonly back: () => void;
  readonly help: () => void;
  /** Already-translated note on the strap's right. */
  readonly note: string;
}

/**
 * The page strap on the four auth leaves (board AU01): Back and Help. The primary slot stays
 * empty on purpose, because each form's own strap carries its primary action with its fields.
 */
export function buildAuthStrap(h: AuthStrapHandlers): StrapConfig {
  return {
    exit: [
      {
        id: 'back',
        label: 'shell.strap.back',
        icon: 'leave',
        kind: 'parchment',
        run: h.back,
      },
    ],
    primary: [],
    secondary: [
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
