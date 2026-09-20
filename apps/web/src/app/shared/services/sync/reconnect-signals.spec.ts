import { ReconnectSignals } from './reconnect-signals';

type Listener = (event?: unknown) => void;

/** Minimal `EventTarget`-shaped fake, constructor-injectable in place of real `window`/`document`
 * so a spec can fire `online`/`pageshow`/`visibilitychange` synchronously without touching jsdom's
 * real globals (which other specs share). */
class FakeTarget {
  private readonly listeners = new Map<string, Set<Listener>>();
  visibilityState: 'visible' | 'hidden' = 'visible';

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe('ReconnectSignals', () => {
  it('fires onTrigger callbacks when the injected window dispatches "online"', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const signals = new ReconnectSignals({ window: win, document: doc });
    const cb = vi.fn();
    signals.onTrigger(cb);

    win.dispatch('online');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires onTrigger callbacks when the injected window dispatches "pageshow"', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const signals = new ReconnectSignals({ window: win, document: doc });
    const cb = vi.fn();
    signals.onTrigger(cb);

    win.dispatch('pageshow');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires onTrigger callbacks on "visibilitychange" when the document becomes visible', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    doc.visibilityState = 'visible';
    const signals = new ReconnectSignals({ window: win, document: doc });
    const cb = vi.fn();
    signals.onTrigger(cb);

    doc.dispatch('visibilitychange');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire on "visibilitychange" when the document becomes hidden', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    doc.visibilityState = 'hidden';
    const signals = new ReconnectSignals({ window: win, document: doc });
    const cb = vi.fn();
    signals.onTrigger(cb);

    doc.dispatch('visibilitychange');

    expect(cb).not.toHaveBeenCalled();
  });

  it('supports multiple onTrigger subscribers', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const signals = new ReconnectSignals({ window: win, document: doc });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    signals.onTrigger(cb1);
    signals.onTrigger(cb2);

    win.dispatch('online');

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('destroy() removes all listeners from the injected targets', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const signals = new ReconnectSignals({ window: win, document: doc });

    signals.destroy();

    expect(win.listenerCount('online')).toBe(0);
    expect(win.listenerCount('pageshow')).toBe(0);
    expect(doc.listenerCount('visibilitychange')).toBe(0);
  });

  it('no callback fires after destroy(), even if the target still dispatches', () => {
    const win = new FakeTarget();
    const doc = new FakeTarget();
    const signals = new ReconnectSignals({ window: win, document: doc });
    const cb = vi.fn();
    signals.onTrigger(cb);

    signals.destroy();
    win.dispatch('online');
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');

    expect(cb).not.toHaveBeenCalled();
  });
});
