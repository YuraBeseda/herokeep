import { Injectable, type Signal } from '@angular/core';
import { routeScopedState } from '../nav/route-scoped-state';
import type { UiIconName } from '../icons/vocabulary';

export interface TopBarAction {
  readonly id: string;
  /** i18n key of the hint (a `shell.*` key: the action is an `hk-icon-button`). */
  readonly label: string;
  readonly icon: UiIconName;
  readonly disabled?: boolean;
  readonly run: () => void;
}

export interface TopBarConfig {
  /** Already-translated title; without it the top bar shows the section name. */
  readonly title?: string;
  readonly action?: TopBarAction;
  /** Path prefix (segments) the config stays valid under; see `StrapConfig.scope`. */
  readonly scope?: readonly string[];
}

/**
 * The phone top bar's screen title and its one context action (spec §2.2). A screen sets them
 * while it is open (title = the hero name, action = e.g. Edit); with no title the top bar shows the
 * section name. Same clearing rules as the strap (`routeScopedState`, optional `scope`).
 */
@Injectable({ providedIn: 'root' })
export class TopBarService {
  private readonly scoped = routeScopedState<TopBarConfig>();

  readonly config: Signal<TopBarConfig | null> = this.scoped.value;

  set(config: TopBarConfig): void {
    this.scoped.set(config);
  }

  clear(): void {
    this.scoped.clear();
  }
}
