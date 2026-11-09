import type { CanDeactivateFn } from '@angular/router';

/** A campaign screen that holds unsaved input and answers whether it may be left. */
export interface LeaveAware {
  canLeave(): boolean | Promise<boolean>;
}

/**
 * Join and the campaign settings leave through their own `canLeave()`: any route change (a tab,
 * the phone tab bar, the rail, browser Back) asks once while the form holds unsaved input and stays
 * silent when it is clean. A type-only dependency, so the lazy routes keep their components out of
 * the initial bundle.
 */
export const campaignLeaveGuard: CanDeactivateFn<LeaveAware> = (component) => component.canLeave();
