import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { UpdateService, WINDOW_RELOAD } from './update.service';

describe('UpdateService', () => {
  let versionUpdates: Subject<VersionEvent>;
  let activateUpdate: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let reload: ReturnType<typeof vi.fn>;

  function setup(isEnabled: boolean): UpdateService {
    versionUpdates = new Subject<VersionEvent>();
    activateUpdate = vi.fn(() => Promise.resolve(true));
    reload = vi.fn();

    const swUpdateStub: Partial<SwUpdate> = {
      isEnabled,
      versionUpdates: versionUpdates.asObservable(),
      activateUpdate,
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: swUpdateStub },
        { provide: WINDOW_RELOAD, useValue: reload },
      ],
    });
    return TestBed.inject(UpdateService);
  }

  it('starts with no update available', () => {
    const service = setup(true);
    expect(service.updateAvailable()).toBe(false);
  });

  it('surfaces updateAvailable when SwUpdate emits VERSION_READY', () => {
    const service = setup(true);

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'a' },
      latestVersion: { hash: 'b' },
    });

    expect(service.updateAvailable()).toBe(true);
  });

  it('ignores non-VERSION_READY events', () => {
    const service = setup(true);

    versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });

    expect(service.updateAvailable()).toBe(false);
  });

  it('never subscribes when the service worker is disabled', () => {
    const service = setup(false);

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'a' },
      latestVersion: { hash: 'b' },
    });

    expect(service.updateAvailable()).toBe(false);
  });

  it('activate() calls SwUpdate.activateUpdate() then reloads via the injected function', async () => {
    const service = setup(true);
    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'a' },
      latestVersion: { hash: 'b' },
    });

    await service.activate();

    expect(activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('activate() reloads only after activateUpdate resolves, never before', async () => {
    const service = setup(true);
    const order: string[] = [];
    activateUpdate.mockImplementation(() => {
      order.push('activateUpdate');
      return Promise.resolve(true);
    });
    reload.mockImplementation(() => order.push('reload'));

    await service.activate();

    expect(order).toEqual(['activateUpdate', 'reload']);
  });
});
