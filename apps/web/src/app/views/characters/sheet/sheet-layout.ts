import { inject, Injectable, signal } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { phoneLayout } from '../../../ui/shell/viewport';

/** The phone's play tabs: child routes at every width, shown as tabs only below 768 px. */
export const PHONE_TAB_IDS = ['combat', 'spells', 'bag', 'hero', 'more'] as const;
export type PhoneTabId = (typeof PHONE_TAB_IDS)[number];

const isPhoneTab = (segment: string): segment is PhoneTabId =>
  (PHONE_TAB_IDS as readonly string[]).includes(segment);

/**
 * The ONE source of the breakpoint for the sheet routes: the shared `phoneLayout()` signal (below
 * 768 px), read by the route guard (before a tab activates) and by the shell (live resizes), plus
 * the phone tab the player was last on, so a trip across the breakpoint keeps their place.
 */
@Injectable({ providedIn: 'root' })
export class SheetLayoutService {
  readonly phone = phoneLayout();
  private readonly lastPhoneTab = signal<PhoneTabId>('combat');

  /** Remembers the phone tab being viewed (call with every sheet child segment). */
  note(segment: string): void {
    if (isPhoneTab(segment)) this.lastPhoneTab.set(segment);
  }

  /**
   * Where `segment` belongs at the current width, or `segment` itself when it is already right.
   * Phone: `play` -> the last phone tab (`combat` by default). Tablet/desktop: every phone tab ->
   * `play` (the Play tab shows every leaf; `more` too, its links live on the folio and strap).
   */
  resolve(segment: string): string {
    if (this.phone()) return segment === 'play' ? this.lastPhoneTab() : segment;
    return isPhoneTab(segment) ? 'play' : segment;
  }
}

/** Resolves a sheet tab route before it activates, so the wrong layout's tab never mounts. */
export const sheetLayoutGuard: CanActivateFn = (route, state) => {
  const layout = inject(SheetLayoutService);
  const segment = route.routeConfig?.path ?? '';
  layout.note(segment);
  const target = layout.resolve(segment);
  if (target === segment) return true;
  const [path, rest = ''] = state.url.split(/(?=[?#])/);
  const parts = path.split('/');
  parts[parts.length - 1] = target;
  return inject(Router).parseUrl(parts.join('/') + rest);
};
