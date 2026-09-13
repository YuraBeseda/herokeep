import { DestroyRef, inject, Injectable, signal, type Signal } from '@angular/core';

/**
 * Minimal shape of the Screen Wake Lock API this service needs (`navigator.wakeLock`) — not yet
 * present in every supported `lib.dom.d.ts` combination, so declared locally, same convention as
 * `InstallPromptService`'s own `BeforeInstallPromptEvent`. `WakeLockSentinelLike` is deliberately
 * typed as a plain `EventTarget` (rather than the real `WakeLockSentinel` interface) so specs can
 * stub it with a real `EventTarget` subclass and get working `addEventListener`/`dispatchEvent`
 * for free — task-11-brief.md's own "fake sentinel with release() + addEventListener('release')".
 */
interface WakeLockSentinelLike extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}

interface NavigatorWakeLock {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function getWakeLock(): NavigatorWakeLock | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { wakeLock?: NavigatorWakeLock }).wakeLock;
}

/**
 * Screen Wake Lock wrapper (task-11-brief.md) behind the play tab's toggle: `enable()` requests a
 * `'screen'` lock via `navigator.wakeLock.request`, `disable()` releases it. `supported` is a
 * plain boolean (the API's presence never changes over a session, unlike `active`) — the play-tab
 * toggle is HIDDEN entirely when it's `false` (Global Constraints: "absent API -> toggle hidden").
 *
 * Re-acquisition: the UA auto-releases the sentinel whenever the document goes hidden (the Wake
 * Lock spec's own behavior, never something this service triggers itself) — this service listens
 * for `document.visibilitychange` and re-requests a fresh sentinel once the document is visible
 * again, but ONLY while `wanted` (set by `enable()`, cleared by `disable()`) — a `disable()`'d lock
 * never comes back just because the tab was switched away and back.
 *
 * The sentinel's own `'release'` event (fired by the UA on auto-release, and also by a real
 * browser after `sentinel.release()` resolves) is the single source of truth for `active` — never
 * set optimistically anywhere else — so `active` stays truthful even when the release happens for
 * a reason this service didn't initiate (task-11-brief.md: "the released event on the sentinel
 * should keep active truthful").
 *
 * Root-provided: `DestroyRef.onDestroy` releases any held sentinel and removes the
 * `visibilitychange` listener when the service itself is destroyed (app teardown — a root service
 * is never destroyed mid-session in the real app, but IS destroyed between specs via
 * `TestBed.resetTestingModule`/environment injector teardown).
 *
 * Fix round 1 (concurrent enable()/disable() races) — `acquire()` guards against two failure
 * modes a bare "await `request()`, then commit" is exposed to:
 * 1. Two `enable()` calls before the first `request()` resolves must issue exactly ONE request —
 *    `acquiring` (the in-flight promise) and an already-held `sentinel` both short-circuit a
 *    redundant `request()` call, so a second overlapping call joins the first instead of
 *    orphaning it (the first sentinel would otherwise be silently overwritten — never released,
 *    its `'release'` listener never firing).
 * 2. `disable()` racing an in-flight `request()` must not let the resolved sentinel "win" — after
 *    the `await`, `acquire()` re-checks `wanted`; if `disable()` already ran while the request was
 *    pending, the just-acquired sentinel is released immediately instead of being committed to
 *    `this.sentinel`/`active`.
 */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
  private readonly destroyRef = inject(DestroyRef);

  readonly supported: boolean = getWakeLock() !== undefined;

  private readonly activeState = signal(false);
  readonly active: Signal<boolean> = this.activeState.asReadonly();

  /** Whether the caller currently wants the lock held — distinct from `active` (which reflects
   * whether a sentinel is held RIGHT NOW). Drives re-acquisition on visibilitychange. */
  private wanted = false;
  private sentinel: WakeLockSentinelLike | undefined;
  /** The in-flight `acquire()` promise, if any — lets a second overlapping `enable()`/
   * `onVisibilityChange` call join the SAME request instead of issuing its own (fix round 1,
   * finding 1). Cleared unconditionally (success, rejection, or short-circuit) once that
   * acquisition settles. */
  private acquiring: Promise<void> | undefined;

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && this.wanted && !this.sentinel) {
      void this.acquire();
    }
  };

  constructor() {
    if (!this.supported) return;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      void this.releaseSentinel();
    });
  }

  async enable(): Promise<void> {
    if (!this.supported) return;
    this.wanted = true;
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    await this.releaseSentinel();
  }

  // Idempotent: a sentinel already held, or a request already in flight, both short-circuit to
  // that SAME outcome rather than issuing a redundant `request()` call (fix round 1, finding 1).
  private acquire(): Promise<void> {
    if (this.sentinel) return Promise.resolve();
    if (this.acquiring) return this.acquiring;
    const wakeLock = getWakeLock();
    if (!wakeLock) return Promise.resolve();

    const promise = this.doAcquire(wakeLock).finally(() => {
      this.acquiring = undefined;
    });
    this.acquiring = promise;
    return promise;
  }

  private async doAcquire(wakeLock: NavigatorWakeLock): Promise<void> {
    try {
      const sentinel = await wakeLock.request('screen');

      // Fix round 1, finding 2: `disable()` may have run WHILE this request was in flight — commit
      // nothing in that case, release the just-acquired sentinel immediately instead of leaving it
      // held (and `active` truthy) against the caller's own most recent wishes.
      if (!this.wanted) {
        try {
          await sentinel.release();
        } catch {
          /* already released, or the platform rejects a redundant release — nothing to do */
        }
        return;
      }

      this.sentinel = sentinel;
      this.activeState.set(true);
      sentinel.addEventListener('release', () => {
        this.activeState.set(false);
        // Only clear `this.sentinel` if it's still THIS sentinel — a fresh `acquire()` could have
        // already replaced it by the time this fires (defensive; not expected in practice since a
        // sentinel is only ever re-requested after its predecessor is already gone).
        if (this.sentinel === sentinel) this.sentinel = undefined;
      });
    } catch {
      // Rejected (no user activation, battery saver, etc.) — `active` stays false; `wanted` stays
      // true so a later visibilitychange can retry. `acquiring` is cleared by `acquire()`'s own
      // `finally` regardless of this catch, so a subsequent `enable()` issues a real retry rather
      // than joining a permanently-stuck in-flight promise (fix round 1, finding 3).
    }
  }

  private async releaseSentinel(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    this.activeState.set(false);
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        /* already released, or the platform rejects a redundant release — nothing to do */
      }
    }
  }
}
