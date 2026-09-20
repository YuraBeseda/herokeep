import {
  broadcastChannelName,
  SyncBroadcast,
  type BroadcastChannelFactory,
  type BroadcastChannelLike,
} from './broadcast';

/** In-memory stand-in for the platform `BroadcastChannel`: `postMessage` on one instance delivers
 * to every OTHER same-named live instance (never itself — mirrors the real API), letting a spec
 * simulate a leader tab's publisher and a follower tab's subscriber as two separate instances of
 * the SAME logical channel. */
class FakeBroadcastChannel implements BroadcastChannelLike {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  private closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(message: unknown): void {
    for (const instance of FakeBroadcastChannel.instances) {
      if (instance === this || instance.name !== this.name || instance.closed) continue;
      instance.onmessage?.({ data: message });
    }
  }

  close(): void {
    this.closed = true;
    const index = FakeBroadcastChannel.instances.indexOf(this);
    if (index !== -1) FakeBroadcastChannel.instances.splice(index, 1);
  }
}

function factory(): BroadcastChannelFactory {
  FakeBroadcastChannel.instances = [];
  return FakeBroadcastChannel;
}

class ThrowingChannel implements BroadcastChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor() {
    throw new Error('BroadcastChannel unavailable');
  }
  // Never reached — the constructor above always throws first — but must still satisfy the
  // interface; a real body (not an empty one, which `@typescript-eslint/no-empty-function` flags)
  // documents that explicitly.
  postMessage(): void {
    throw new Error('unreachable');
  }
  close(): void {
    throw new Error('unreachable');
  }
}

describe('broadcastChannelName', () => {
  it('namespaces under hk:events:', () => {
    expect(broadcastChannelName('char:abc')).toBe('hk:events:char:abc');
  });
});

describe('SyncBroadcast', () => {
  it('delivers a publish() from one instance to a subscriber on another same-stream instance', () => {
    const Factory = factory();
    const publisher = new SyncBroadcast('char:1', Factory);
    const follower = new SyncBroadcast('char:1', Factory);
    const onWake = vi.fn();

    follower.subscribe(onWake);
    publisher.publish();

    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('never delivers a publish() back to the publisher itself', () => {
    const Factory = factory();
    const publisher = new SyncBroadcast('char:1', Factory);
    const onWake = vi.fn();
    publisher.subscribe(onWake);

    publisher.publish();

    expect(onWake).not.toHaveBeenCalled();
  });

  it('never delivers across different streamIds', () => {
    const Factory = factory();
    const publisher = new SyncBroadcast('char:1', Factory);
    const follower = new SyncBroadcast('char:2', Factory);
    const onWake = vi.fn();
    follower.subscribe(onWake);

    publisher.publish();

    expect(onWake).not.toHaveBeenCalled();
  });

  it('the poke carries no payload data a follower could read instead of re-reading storage', () => {
    const Factory = factory();
    const publisher = new SyncBroadcast('char:1', Factory);
    const follower = new SyncBroadcast('char:1', Factory);
    let capturedData: unknown = 'unset';
    // Deliberately bypass `subscribe`'s `() => onWake()` signature (which already discards the
    // event) to prove the raw message itself carries nothing meaningful.
    (follower as unknown as { channel: BroadcastChannelLike }).channel.onmessage = (event) => {
      capturedData = event.data;
    };

    publisher.publish();

    expect(capturedData).not.toBe('unset');
    expect(
      typeof capturedData === 'object' ? JSON.stringify(capturedData) : capturedData,
    ).not.toMatch(/char:|seq|event/i);
  });

  it('unsubscribe stops further delivery and closes the channel', () => {
    const Factory = factory();
    const publisher = new SyncBroadcast('char:1', Factory);
    const follower = new SyncBroadcast('char:1', Factory);
    const onWake = vi.fn();
    const unsubscribe = follower.subscribe(onWake);

    unsubscribe();
    publisher.publish();

    expect(onWake).not.toHaveBeenCalled();
  });

  it('degrades to a silent no-op when the BroadcastChannel global is unavailable', () => {
    const broadcast = new SyncBroadcast('char:1', undefined);
    const onWake = vi.fn();

    expect(() => broadcast.subscribe(onWake)).not.toThrow();
    expect(() => broadcast.publish()).not.toThrow();
    expect(onWake).not.toHaveBeenCalled();
  });

  it('degrades to a silent no-op when the factory throws (constrained embedded WebView)', () => {
    const broadcast = new SyncBroadcast('char:1', ThrowingChannel);

    expect(() => broadcast.publish()).not.toThrow();
    expect(() => broadcast.subscribe(() => undefined)).not.toThrow();
  });
});
