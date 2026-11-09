import { Injectable, signal, type Signal } from '@angular/core';
import type { UiIconName } from '../icons/vocabulary';

export interface TabItem {
  readonly id: string;
  /** i18n key of the label (full key, e.g. `shell.icon.play`). */
  readonly label: string;
  readonly icon: UiIconName;
  readonly route: readonly string[];
  /** Other routes this tab also stands for (a hub tab such as More covers the screens it lists). */
  readonly alsoActive?: readonly (readonly string[])[];
}

/**
 * The phone's bottom tab bar (design-system Tabs, `hk-tabbar`). A screen with tabs (sheet,
 * campaign) sets them while it is open and passes `null` when it goes; with none the bar is not
 * rendered and the page reserves no height for it. Desktop ignores this service: its tabs live
 * on the folio.
 */
@Injectable({ providedIn: 'root' })
export class TabBarService {
  private readonly state = signal<readonly TabItem[] | null>(null);
  readonly tabs: Signal<readonly TabItem[] | null> = this.state.asReadonly();

  set(tabs: readonly TabItem[] | null): void {
    this.state.set(tabs);
  }
}
