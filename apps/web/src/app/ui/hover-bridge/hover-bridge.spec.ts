import { hoverBridge } from './hover-bridge';

describe('hoverBridge', () => {
  let host: HTMLElement;
  let panel: HTMLElement;
  let close: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    panel = document.createElement('div');
    close = vi.fn<() => void>();
  });
  afterEach(() => vi.useRealTimers());

  const fire = (el: HTMLElement, type: string): void => {
    el.dispatchEvent(new Event(type));
  };

  it('closes after the grace period once the pointer leaves the host', () => {
    hoverBridge(host, () => panel, close);
    fire(host, 'mouseleave');
    vi.advanceTimersByTime(149);
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open when the pointer reaches the panel within the grace period', () => {
    hoverBridge(host, () => panel, close);
    fire(host, 'mouseleave');
    vi.advanceTimersByTime(100);
    fire(panel, 'mouseenter');
    vi.advanceTimersByTime(500);
    expect(close).not.toHaveBeenCalled();
  });

  it('re-arms when the pointer leaves the panel', () => {
    hoverBridge(host, () => panel, close);
    fire(host, 'mouseleave');
    fire(panel, 'mouseenter');
    fire(panel, 'mouseleave');
    vi.advanceTimersByTime(150);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open when the pointer comes back to the host', () => {
    hoverBridge(host, () => panel, close);
    fire(host, 'mouseleave');
    fire(host, 'mouseenter');
    vi.advanceTimersByTime(500);
    expect(close).not.toHaveBeenCalled();
  });

  it('works without a panel and honours a custom grace', () => {
    hoverBridge(host, () => null, close, 40);
    fire(host, 'mouseleave');
    vi.advanceTimersByTime(40);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cleanup cancels the timer and removes the listeners', () => {
    const stop = hoverBridge(host, () => panel, close);
    fire(host, 'mouseleave');
    stop();
    vi.advanceTimersByTime(500);
    fire(host, 'mouseleave');
    fire(panel, 'mouseleave');
    vi.advanceTimersByTime(500);
    expect(close).not.toHaveBeenCalled();
  });
});
