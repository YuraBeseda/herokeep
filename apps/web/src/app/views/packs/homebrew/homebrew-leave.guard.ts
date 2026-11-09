import type { CanDeactivateFn } from '@angular/router';
import type { HomebrewEditorComponent } from './homebrew-editor.component';

/**
 * The homebrew editor routes leave through the editor's own `canLeave()`: any route change (the
 * strap's Cancel, Back to homebrew, a tab, the rail, browser Back) asks once while the form holds
 * unsaved edits, and stays silent when it is clean or just saved. A type-only import, so the lazy
 * route keeps the component out of the initial bundle.
 */
export const homebrewLeaveGuard: CanDeactivateFn<HomebrewEditorComponent> = (component) =>
  component.canLeave();
