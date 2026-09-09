import { inject, Injectable, InjectionToken, signal, type Signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Reloads the current page. Injected as a token (rather than called as a bare
 * `window.location.reload()`) so `UpdateService.activate()` is testable without touching the
 * real `window.location` from a spec — a test overrides this token with a spy instead.
 */
export const WINDOW_RELOAD = new InjectionToken<() => void>('hk.WINDOW_RELOAD', {
  factory: () => () => window.location.reload(),
});

/**
 * Wraps `SwUpdate.versionUpdates`: surfaces `updateAvailable` once a new version has finished
 * downloading and is ready to activate (`VERSION_READY`). This service NEVER reloads on its own —
 * `activate()` is the only path that calls `SwUpdate.activateUpdate()` and then reloads, and it
 * only runs when the user explicitly acts on the shell's update banner. Silently swapping cached
 * assets under an open tab risks a broken in-flight session (stale in-memory chunks referencing
 * hashes the new service worker no longer serves), so this app always prompts instead of
 * auto-reloading.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly reload = inject(WINDOW_RELOAD);

  private readonly updateAvailableState = signal(false);
  readonly updateAvailable: Signal<boolean> = this.updateAvailableState.asReadonly();

  constructor() {
    // `SwUpdate.isEnabled` is false when the service worker is unsupported/disabled (e.g. dev
    // mode, or a browser without SW support) — subscribing anyway is harmless (the observable
    // simply never emits) but skipping it keeps intent obvious.
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((event) => {
        if (event.type === 'VERSION_READY') {
          this.updateAvailableState.set(true);
        }
      });
    }
  }

  /** Activates the downloaded version, then reloads. Only ever called from a user click. */
  async activate(): Promise<void> {
    await this.swUpdate.activateUpdate();
    this.reload();
  }
}
