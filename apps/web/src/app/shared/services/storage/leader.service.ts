import { Injectable, signal } from '@angular/core';

const LOCK_NAME = 'hk-writer';

/**
 * Elects this tab as the app's sole writer via the Web Locks API. `acquire()` requests
 * `hk-writer` exclusively and never releases it on its own — the granted callback returns a
 * promise that only `release()` resolves — so a second tab's `acquire()` stays queued (and its
 * `isLeader` stays `false`) until the first tab calls `release()` or its whole browsing context
 * closes (the browser force-releases locks held by a destroyed context). Where the Web Locks API
 * itself is unavailable (e.g. Firefox private browsing), this device assumes it is the only tab
 * and becomes leader immediately.
 */
@Injectable({ providedIn: 'root' })
export class LeaderService {
  private readonly leader = signal(false);
  readonly isLeader = this.leader.asReadonly();

  private acquiring: Promise<void> | undefined;
  private holdRelease: (() => void) | undefined;

  /** Resolves once this instance is granted `hk-writer`; keeps holding it until `release()`. Safe to call more than once — later calls return the same in-flight/settled acquisition. */
  acquire(): Promise<void> {
    this.acquiring ??= this.requestLock();
    return this.acquiring;
  }

  /** Releases a held lock, if any, letting the next queued tab (or a future `acquire()` on this instance) become leader. */
  release(): void {
    this.holdRelease?.();
    this.holdRelease = undefined;
    this.acquiring = undefined;
    this.leader.set(false);
  }

  private async requestLock(): Promise<void> {
    const locks: LockManager | undefined = navigator.locks;
    if (!locks) {
      console.warn('Web Locks API unavailable; assuming single-tab leadership.');
      this.leader.set(true);
      return;
    }
    await new Promise<void>((resolveAcquire) => {
      void locks.request(
        LOCK_NAME,
        { mode: 'exclusive' },
        () =>
          new Promise<void>((resolveHold) => {
            this.holdRelease = resolveHold;
            this.leader.set(true);
            resolveAcquire();
          }),
      );
    });
  }
}
