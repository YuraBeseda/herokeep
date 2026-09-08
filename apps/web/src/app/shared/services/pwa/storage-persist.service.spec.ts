import { TestBed } from '@angular/core/testing';
import { StoragePersistService } from './storage-persist.service';

// jsdom (this project's test environment) has no `navigator.storage` at all — not even an
// inherited getter returning `undefined` (verified empirically; see task-13-report.md) — so
// `afterEach` restores that exact absent state by deleting whatever a test defined directly on
// the `navigator` instance, rather than restoring a saved property descriptor.
describe('StoragePersistService', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage');
  });

  it('stays unsupported/undefined when the Storage Manager API is absent (the real jsdom default)', async () => {
    const service = TestBed.inject(StoragePersistService);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.supported()).toBe(false);
    expect(service.estimate()).toBeUndefined();
    expect(service.persisted()).toBeUndefined();
    await expect(service.requestPersist()).resolves.toBe(false);
  });

  it('refreshes estimate + persisted on init, and again after a granted requestPersist()', async () => {
    const estimate = vi.fn().mockResolvedValue({ usage: 1024, quota: 2048 });
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(false);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate, persist, persisted },
    });

    const service = TestBed.inject(StoragePersistService);
    await Promise.resolve();
    await Promise.resolve();

    expect(service.supported()).toBe(true);
    expect(service.estimate()).toEqual({ usage: 1024, quota: 2048 });
    expect(service.persisted()).toBe(false);

    await expect(service.requestPersist()).resolves.toBe(true);

    expect(service.persisted()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledTimes(2); // once on init, once after the grant
  });
});
