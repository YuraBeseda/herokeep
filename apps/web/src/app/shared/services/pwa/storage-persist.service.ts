import { Injectable, signal, type Signal } from '@angular/core';

/** The two `navigator.storage.estimate()` fields the settings screen cares about, in bytes. */
export interface StorageUsageEstimate {
  readonly usage?: number;
  readonly quota?: number;
}

// `navigator.storage` is typed as always-present in lib.dom, but is absent in jsdom (this
// project's test environment) and in some real browsers — read it defensively rather than
// trusting the type.
function storageManager(): StorageManager | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.storage;
}

/**
 * Feature-detected wrapper around the browser Storage Manager API (`navigator.storage`). Every
 * method below guards on the API's presence so callers never see a thrown error — unsupported
 * environments simply keep `estimate`/`persisted` at `undefined` and `requestPersist()` resolves
 * `false`.
 */
@Injectable({ providedIn: 'root' })
export class StoragePersistService {
  // Whether the API exists at all never changes over a page's lifetime, so this is captured once
  // rather than re-detected on every read.
  readonly supported: Signal<boolean> = signal(storageManager() !== undefined).asReadonly();

  private readonly estimateState = signal<StorageUsageEstimate | undefined>(undefined);
  private readonly persistedState = signal<boolean | undefined>(undefined);

  readonly estimate: Signal<StorageUsageEstimate | undefined> = this.estimateState.asReadonly();
  readonly persisted: Signal<boolean | undefined> = this.persistedState.asReadonly();

  constructor() {
    void this.refreshEstimate();
    void this.refreshPersisted();
  }

  // I/O boundary: asks the browser to grant persistent storage, then refreshes both signals so
  // the UI reflects the (possibly-unchanged) grant and any quota change together. Resolves
  // `false` without throwing when the API is unsupported.
  async requestPersist(): Promise<boolean> {
    const storage = storageManager();
    if (!storage) return false;
    const granted = await storage.persist();
    this.persistedState.set(granted);
    await this.refreshEstimate();
    return granted;
  }

  private async refreshEstimate(): Promise<void> {
    const storage = storageManager();
    if (!storage) return;
    const { usage, quota } = await storage.estimate();
    this.estimateState.set({ usage, quota });
  }

  private async refreshPersisted(): Promise<void> {
    const storage = storageManager();
    if (!storage) return;
    this.persistedState.set(await storage.persisted());
  }
}
