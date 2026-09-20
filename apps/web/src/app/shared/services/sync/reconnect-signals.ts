/**
 * Reconnect trigger wiring (docs/02-architecture/03-sync-protocol.md §Connection lifecycle):
 * "Reconnect triggers: socket close, `online`, `visibilitychange` → visible, `pageshow`, `resume`
 * (Chromium)." Socket close is the sync session's own responsibility (it already knows when its
 * socket closed); this class covers the three DOM-level signals that mean "the network or tab
 * state may have changed, worth trying now" — `resume` (Chromium's Page Lifecycle API) isn't
 * listened for here because it isn't a standard `EventTarget` event with a stable cross-browser
 * shape (a future enhancement could add it as a fourth optional target).
 *
 * Constructor-injectable `window`/`document` targets (a narrow `EventListenable` shape, not the
 * full DOM types) so specs can fire events synchronously with fakes instead of touching jsdom's
 * shared globals.
 */

export type ReconnectListener = (event?: unknown) => void;

export interface EventListenable {
  addEventListener(type: string, listener: ReconnectListener): void;
  removeEventListener(type: string, listener: ReconnectListener): void;
}

export interface VisibilityDocument extends EventListenable {
  readonly visibilityState: DocumentVisibilityState;
}

export interface ReconnectSignalsOptions {
  window?: EventListenable;
  document?: VisibilityDocument;
}

interface Subscription {
  target: EventListenable;
  type: string;
  listener: ReconnectListener;
}

export class ReconnectSignals {
  private readonly callbacks = new Set<() => void>();
  private readonly subscriptions: Subscription[] = [];

  constructor(options: ReconnectSignalsOptions = {}) {
    const windowTarget = options.window ?? window;
    const documentTarget = options.document ?? document;

    this.listen(windowTarget, 'online', () => this.fire());
    this.listen(windowTarget, 'pageshow', () => this.fire());
    this.listen(documentTarget, 'visibilitychange', () => {
      if (documentTarget.visibilityState === 'visible') this.fire();
    });
  }

  /** Registers a callback for every reconnect trigger; returns an unsubscribe function. */
  onTrigger(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /** Removes all DOM listeners and subscribers. No callback fires after this, even if the
   * injected target still dispatches events (the listeners are gone, not merely no-ops). */
  destroy(): void {
    for (const { target, type, listener } of this.subscriptions) {
      target.removeEventListener(type, listener);
    }
    this.subscriptions.length = 0;
    this.callbacks.clear();
  }

  private listen(target: EventListenable, type: string, listener: ReconnectListener): void {
    target.addEventListener(type, listener);
    this.subscriptions.push({ target, type, listener });
  }

  private fire(): void {
    for (const callback of this.callbacks) callback();
  }
}
