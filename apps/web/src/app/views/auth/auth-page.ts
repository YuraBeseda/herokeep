import { DestroyRef, effect, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';
import { NavHistoryService } from '../../ui/nav/nav-history.service';
import { openHelpDialog } from '../help-dialog/help-dialog.component';
import { translated } from '../translated';
import { buildAuthStrap } from './auth-strap';

/** Where Back goes when the auth screen was opened directly (a deep link or a reload). */
const BACK_FALLBACK = ['/settings'] as const;

/**
 * Wires the page chrome every auth step shares (board AU01): the page strap with Back and Help,
 * and its note. Call it once from the step's constructor (an injection context); the step must
 * provide the `auth` translation scope. The strap clears itself when the step goes away.
 */
export function useAuthPage(): void {
  const strap = inject(ActionStrapService);
  const nav = inject(NavHistoryService);
  const dialogs = inject(DialogService);
  const transloco = inject(TranslocoService);
  const note = translated(transloco, 'auth.strap.note');

  effect(() =>
    strap.set(
      buildAuthStrap({
        back: () => nav.back(BACK_FALLBACK),
        help: () => openHelpDialog(dialogs, transloco, 'auth', ['accounts', 'recovery', 'devices']),
        note: note(),
      }),
    ),
  );
  inject(DestroyRef).onDestroy(() => strap.clear());
}
