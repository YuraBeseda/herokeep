import { TestBed } from '@angular/core/testing';
import { WakeLockService } from './wake-lock.service';

/** Real `EventTarget` subclass (task-11-brief.md's own "fake sentinel with release() +
 * addEventListener('release')") — `WakeLockService` reads `sentinel.released`/calls
 * `sentinel.release()`/listens via `addEventListener('release', ...)`, all of which a plain
 * `EventTarget` subclass gives for free without hand-rolling a pub/sub stub. `release()` mirrors
 * the REAL Wake Lock API's own behavior (resolving `released = true` and firing `'release'`); a
 * UA-initiated auto-release (tab hidden) is simulated by dispatching the SAME event directly,
 * bypassing this mock — see the visibilitychange spec below. */
class FakeSentinel extends EventTarget {
  released = false;
  readonly release = vi.fn(() => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
    return Promise.resolve();
  });
}

/** A promise plus its externally-callable resolve/reject — used below to hold `wakeLock.request()`
 * open mid-flight (fix-round 1's three races all hinge on "another call happens WHILE the first
 * `request()` is still pending"), something `stubWakeLock()`'s immediately-resolving mock can't
 * represent. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('WakeLockService', () => {
  let originalWakeLock: PropertyDescriptor | undefined;
  let originalVisibilityState: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalWakeLock = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
    originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  });

  afterEach(() => {
    // jsdom has no `navigator.wakeLock` at all by default (no own-property descriptor to restore)
    // — deleting the stub's own property falls back to that absence, same "restore by delete when
    // there was nothing to restore" reasoning for `document.visibilityState` below (jsdom defines
    // that one as a PROTOTYPE getter, so `document` itself also has no own-property descriptor).
    if (originalWakeLock) {
      Object.defineProperty(navigator, 'wakeLock', originalWakeLock);
    } else {
      delete (navigator as { wakeLock?: unknown }).wakeLock;
    }
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    } else {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });

  function stubWakeLock(): {
    request: ReturnType<typeof vi.fn>;
    sentinels: FakeSentinel[];
  } {
    const sentinels: FakeSentinel[] = [];
    const request = vi.fn(() => {
      const sentinel = new FakeSentinel();
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    });
    return { request, sentinels };
  }

  function stubVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
  }

  it('supported is false when navigator.wakeLock is absent, and enable() is a harmless no-op', async () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
    const service = TestBed.inject(WakeLockService);

    expect(service.supported).toBe(false);

    await service.enable();

    expect(service.active()).toBe(false);
  });

  it('enable() requests a screen wake lock and active becomes true', async () => {
    const { request } = stubWakeLock();
    const service = TestBed.inject(WakeLockService);

    await service.enable();

    expect(request).toHaveBeenCalledWith('screen');
    expect(service.active()).toBe(true);
  });

  it('disable() releases the held sentinel and active becomes false', async () => {
    const { sentinels } = stubWakeLock();
    const service = TestBed.inject(WakeLockService);
    await service.enable();

    await service.disable();

    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(service.active()).toBe(false);
  });

  it("the sentinel's own release event keeps active truthful even without disable() (UA auto-release)", async () => {
    const { sentinels } = stubWakeLock();
    const service = TestBed.inject(WakeLockService);
    await service.enable();
    expect(service.active()).toBe(true);

    // Simulates the UA auto-releasing the lock (e.g. the tab going hidden) — dispatched directly,
    // never through the mocked `release()`, matching how a real sentinel fires this on its own.
    sentinels[0].dispatchEvent(new Event('release'));

    expect(service.active()).toBe(false);
  });

  it('re-acquires on visibilitychange hidden -> visible while enabled (a second request call)', async () => {
    const { request, sentinels } = stubWakeLock();
    const service = TestBed.inject(WakeLockService);
    await service.enable();
    expect(request).toHaveBeenCalledTimes(1);

    // The tab hides: the UA auto-releases the currently-held sentinel...
    stubVisibility('hidden');
    sentinels[0].dispatchEvent(new Event('release'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(1); // no re-request while still hidden

    // ...then the tab becomes visible again: the service re-acquires a fresh sentinel.
    stubVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
    expect(service.active()).toBe(true);
  });

  it('disable() stops re-acquiring on a later visibilitychange', async () => {
    const { request, sentinels } = stubWakeLock();
    const service = TestBed.inject(WakeLockService);
    await service.enable();
    stubVisibility('hidden');
    sentinels[0].dispatchEvent(new Event('release'));
    await service.disable();
    expect(request).toHaveBeenCalledTimes(1);

    stubVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(1);
    expect(service.active()).toBe(false);
  });

  it('releases the held sentinel when the service is destroyed', async () => {
    const { sentinels } = stubWakeLock();
    const service = TestBed.inject(WakeLockService);
    await service.enable();
    expect(service.active()).toBe(true);

    TestBed.resetTestingModule();
    await Promise.resolve();

    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  // --- Fix round 1: concurrent enable()/disable() races -------------------------------------

  it('two enable() calls before the first request() resolves issue only ONE request (no leaked/orphaned sentinel)', async () => {
    const gate = deferred<FakeSentinel>();
    const request = vi.fn(() => gate.promise);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const service = TestBed.inject(WakeLockService);

    const first = service.enable();
    const second = service.enable();
    // Still pending — asserted BEFORE resolving the gate, so this can only pass if the second
    // enable() actually joined the first's still-in-flight request instead of issuing its own.
    expect(request).toHaveBeenCalledTimes(1);

    const sentinel = new FakeSentinel();
    gate.resolve(sentinel);
    await first;
    await second;

    expect(request).toHaveBeenCalledTimes(1);
    expect(service.active()).toBe(true);
    // No leaked/orphaned sentinel: the only sentinel ever created is the one actually held — never
    // silently released behind the scenes by a second, redundant acquisition.
    expect(sentinel.release).not.toHaveBeenCalled();
  });

  it('disable() while a request is still in flight releases the just-acquired sentinel and never commits it', async () => {
    const gate = deferred<FakeSentinel>();
    const request = vi.fn(() => gate.promise);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const service = TestBed.inject(WakeLockService);

    const enabling = service.enable();
    // `disable()` runs while `request()` is still pending — no sentinel is held yet, so this is a
    // harmless no-op release UNTIL the gated request resolves below.
    await service.disable();

    const sentinel = new FakeSentinel();
    gate.resolve(sentinel);
    await enabling;

    // The fix: `acquire()` re-checks `wanted` after the await and finds it false (disable() already
    // ran), so it releases the just-resolved sentinel immediately instead of committing it.
    expect(service.active()).toBe(false);
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('a rejected request() (permission denied / battery saver) leaves active() false without throwing, and a later enable() can retry', async () => {
    const sentinels: FakeSentinel[] = [];
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockImplementationOnce(() => {
        const sentinel = new FakeSentinel();
        sentinels.push(sentinel);
        return Promise.resolve(sentinel);
      });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const service = TestBed.inject(WakeLockService);

    await expect(service.enable()).resolves.toBeUndefined();
    expect(service.active()).toBe(false);

    // The in-flight guard must have cleared on rejection — otherwise this second call would join a
    // "stuck" in-flight promise instead of issuing a real retry.
    await service.enable();

    expect(request).toHaveBeenCalledTimes(2);
    expect(service.active()).toBe(true);
  });
});
