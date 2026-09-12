import { LeaderService } from '@shared/services/storage/leader.service';

/**
 * `navigator.locks` is absent in jsdom (see `apps/web/src/test-setup.ts`'s sibling note on
 * fake-indexeddb for the same class of gap). This stub models just enough of the real
 * single-holder exclusive-lock queue for `LeaderService`'s own usage (`request(name, options,
 * callback)`, callback returns a promise that is only settled by the holder releasing) so two
 * `LeaderService` instances sharing one stub behave like two browser tabs.
 */
class StubLockManager {
  private held = false;
  private readonly queue: (() => void)[] = [];

  request(
    _name: string,
    _options: { mode?: string },
    callback: () => Promise<void>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const attempt = (): void => {
        if (this.held) {
          this.queue.push(attempt);
          return;
        }
        this.held = true;
        callback().then(
          () => {
            this.held = false;
            resolve();
            this.queue.shift()?.();
          },
          (err: unknown) => {
            this.held = false;
            reject(err instanceof Error ? err : new Error(String(err)));
            this.queue.shift()?.();
          },
        );
      };
      attempt();
    });
  }
}

function installStubLocks(): StubLockManager {
  const stub = new StubLockManager();
  (navigator as unknown as { locks?: StubLockManager }).locks = stub;
  return stub;
}

function removeLocks(): void {
  delete (navigator as unknown as { locks?: StubLockManager }).locks;
}

describe('LeaderService', () => {
  afterEach(() => {
    removeLocks();
  });

  it('the first acquire() becomes leader; a second instance stays a follower until the first releases', async () => {
    installStubLocks();
    const tab1 = new LeaderService();
    const tab2 = new LeaderService();

    await tab1.acquire();
    expect(tab1.isLeader()).toBe(true);
    expect(tab2.isLeader()).toBe(false);

    let tab2Settled = false;
    const tab2Acquire = tab2.acquire().then(() => {
      tab2Settled = true;
    });
    // Let every already-queued microtask run; tab2 must still be queued behind tab1's hold.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(tab2.isLeader()).toBe(false);
    expect(tab2Settled).toBe(false);

    tab1.release();
    await tab2Acquire;

    expect(tab1.isLeader()).toBe(false);
    expect(tab2.isLeader()).toBe(true);
  });

  it('acquire() resolves once granted and keeps holding — isLeader stays true without a release', async () => {
    installStubLocks();
    const service = new LeaderService();

    await service.acquire();

    expect(service.isLeader()).toBe(true);
  });

  it('falls back to leader = true with a console warning when the Web Locks API is unavailable', async () => {
    removeLocks();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new LeaderService();

    await service.acquire();

    expect(service.isLeader()).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
