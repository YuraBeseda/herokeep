import { DestroyRef, inject, Injectable, signal, type Signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import type { UiIconName } from '../icons/vocabulary';

export interface StrapAction {
  readonly id: string;
  /** i18n key of the label (full key, e.g. `shell.icon.roll`). Icon-only actions use it as the hint. */
  readonly label: string;
  readonly icon: UiIconName;
  readonly kind: 'primary' | 'parchment' | 'ghost' | 'ember' | 'icon';
  readonly disabled?: boolean;
  /** i18n key explaining why the action is unavailable; shown as its hint while `disabled`. */
  readonly disabledReason?: string;
  readonly run: () => void;
}

export interface StrapConfig {
  /** Zone 1: Cancel, Back. Always leftmost. */
  readonly exit?: readonly StrapAction[];
  /** Zone 2: the screen's main actions, in a fixed order. */
  readonly primary: readonly StrapAction[];
  /** Zone 3: icon-only secondary actions; one "More" button on phones. */
  readonly secondary?: readonly StrapAction[];
  /** Already-translated right-hand note (e.g. the concentration spell). */
  readonly status?: string;
}

const pathOf = (url: string): string => url.split(/[?#]/, 1)[0];

/**
 * The one action strap every screen shares (spec §3). A screen calls `set` when it opens and
 * `clear` when it closes; the strap re-renders by action id, so a slot never moves between steps.
 *
 * Safety net: the service also clears on a `NavigationStart` to a different path, so a stale strap
 * never leaks to the next screen (the next screen sets its own while it activates, after this).
 * If that navigation is then cancelled or fails (a guard, a redirect elsewhere), the screen the
 * user is still on gets its strap back.
 */
@Injectable({ providedIn: 'root' })
export class ActionStrapService {
  private readonly router = inject(Router);

  private readonly state = signal<StrapConfig | null>(null);
  readonly config: Signal<StrapConfig | null> = this.state.asReadonly();

  private committedPath = pathOf(this.router.url);
  private stash: StrapConfig | null = null;

  constructor() {
    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (pathOf(event.url) !== this.committedPath && this.state() !== null) {
          this.stash = this.state();
          this.state.set(null);
        }
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        if (this.stash !== null && this.state() === null) this.state.set(this.stash);
        this.stash = null;
      } else if (event instanceof NavigationEnd) {
        this.committedPath = pathOf(this.router.url);
        this.stash = null;
      }
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  set(config: StrapConfig): void {
    this.state.set(config);
    this.stash = null;
  }

  clear(): void {
    this.state.set(null);
    this.stash = null;
  }
}
