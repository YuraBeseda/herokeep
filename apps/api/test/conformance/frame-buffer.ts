/**
 * Tiny stop-condition-based frame accumulator shared by both conformance runners' `StreamDriver`
 * implementations (`node.conformance.test.ts`, `cloudflare.conformance.test.ts`) — NOT used by
 * `scenarios.ts` itself, which only ever sees the `StreamDriver.collect` surface this backs (task-
 * 9-brief: "runners contain ZERO assertions [...] only driver wiring" — this file is exactly that:
 * driver-side plumbing, no assertions of its own).
 *
 * `push` records one frame and wakes any pending `collect` whose `stop` predicate now passes over
 * the updated buffer. `collect(stop, timeoutMs)` resolves immediately if `stop` already passes the
 * CURRENT buffer (this covers the Cloudflare runner's case: a `send` there runs the whole
 * request/response cycle synchronously inside one awaited `runInDurableObject` call, so by the time
 * `collect` is ever invoked every frame that call produced is already buffered — no real waiting
 * needed). Otherwise it waits for a LATER `push` to satisfy `stop`, or for `timeoutMs` to elapse,
 * whichever comes first (this covers the Node runner's real, asynchronous `ws` socket). A timeout
 * resolves with whatever was collected so far rather than rejecting, so a scenario's own assertion
 * against the (possibly incomplete) result is what surfaces a failure — not a hung test.
 */
export class FrameBuffer<T> {
  private readonly buffer: T[] = [];
  private waiters: { stop: (frames: readonly T[]) => boolean; settle: (frames: readonly T[]) => void }[] = [];

  push(frame: T): void {
    this.buffer.push(frame);
    const stillWaiting: typeof this.waiters = [];
    for (const waiter of this.waiters) {
      if (waiter.stop(this.buffer)) waiter.settle([...this.buffer]);
      else stillWaiting.push(waiter);
    }
    this.waiters = stillWaiting;
  }

  /** Every frame collected so far, oldest first. */
  snapshot(): readonly T[] {
    return [...this.buffer];
  }

  collect(stop: (frames: readonly T[]) => boolean, timeoutMs = 5000): Promise<readonly T[]> {
    if (stop(this.buffer)) return Promise.resolve([...this.buffer]);
    return new Promise((resolve) => {
      const settle = (frames: readonly T[]): void => {
        clearTimeout(timer);
        resolve(frames);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.settle !== settle);
        resolve([...this.buffer]);
      }, timeoutMs);
      this.waiters.push({ stop, settle });
    });
  }
}
