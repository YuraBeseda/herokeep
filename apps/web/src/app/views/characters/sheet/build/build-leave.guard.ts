import type { CanDeactivateFn } from '@angular/router';
import type { BuildTabComponent } from './build-tab.component';

/**
 * The sheet's `build` child route leaves through the tab's own `canLeave()`: any route change (a
 * sheet tab, the phone tab bar, the More list, the rail, browser Back) asks once while the identity
 * form holds unsaved edits, and stays silent when it is clean. A type-only import, so the lazy
 * route keeps the component out of the initial bundle.
 */
export const buildLeaveGuard: CanDeactivateFn<BuildTabComponent> = (component) =>
  component.canLeave();
