import { Injectable, type Signal } from '@angular/core';
import { routeScopedState } from '../nav/route-scoped-state';
import type { UiIconName } from '../icons/vocabulary';

export interface StrapAction {
  readonly id: string;
  /** i18n key of the label (full key, e.g. `shell.icon.roll`). Icon-only actions use it as the hint. */
  readonly label: string;
  readonly icon: UiIconName;
  readonly kind: 'primary' | 'parchment' | 'ghost' | 'ember' | 'icon';
  readonly disabled?: boolean;
  /** Toggle actions (icon kind): the pressed state, shown as `aria-pressed`. */
  readonly pressed?: boolean;
  /** i18n key explaining why the action is unavailable; shown as its hint while `disabled`. */
  readonly disabledReason?: string;
  /** Interpolation params for `disabledReason` (e.g. the campaign name of a house-rule reason). */
  readonly disabledReasonParams?: Readonly<Record<string, unknown>>;
  readonly run: () => void;
}

export interface StrapConfig {
  /** Zone 1: Cancel, Back. Always leftmost. */
  readonly exit?: readonly StrapAction[];
  /** Zone 2: the screen's main actions, in a fixed order. */
  readonly primary: readonly StrapAction[];
  /** Zone 3: icon-only secondary actions; one "More" button on phones. */
  readonly secondary?: readonly StrapAction[];
  /**
   * Path prefix (segments, e.g. `["/c", "1"]`) the strap stays valid under: navigation inside it
   * (sheet tabs that are child routes of one live component) keeps the strap; outside clears it.
   * Without a scope any change of path clears it.
   */
  readonly scope?: readonly string[];
  /** Already-translated right-hand note (e.g. the concentration spell). */
  readonly status?: string;
}

/**
 * The one action strap every screen shares (spec §3). A screen calls `set` when it opens and
 * `clear` when it closes; the strap re-renders by action id, so a slot never moves between steps.
 *
 * Safety net (`routeScopedState`): the service also clears on a `NavigationStart` that leaves the
 * config's `scope` (or, without one, changes the path), so a stale strap never leaks to the next
 * screen. A cancelled or failed navigation puts the strap back.
 */
@Injectable({ providedIn: 'root' })
export class ActionStrapService {
  private readonly scoped = routeScopedState<StrapConfig>();

  readonly config: Signal<StrapConfig | null> = this.scoped.value;

  set(config: StrapConfig): void {
    this.scoped.set(config);
  }

  clear(): void {
    this.scoped.clear();
  }
}
