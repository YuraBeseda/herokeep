import { Backoff } from './backoff';

/** Fixed-sequence rng: returns each value in `values` in order, then repeats the last one. Lets a
 * spec pin the exact jitter factor `next()` will apply instead of depending on `Math.random()`. */
function fixedRng(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('Backoff', () => {
  it('the first call returns the base delay (500ms) with no jitter when rng is at the midpoint', () => {
    // rng() === 0.5 -> jitter = (0.5*2 - 1) * 0.2 = 0 -> jitterFactor = 1
    const backoff = new Backoff(fixedRng(0.5));

    expect(backoff.next()).toBe(500);
  });

  it('doubles the base delay on each successive call: 500, 1000, 2000, 4000 (rng at midpoint)', () => {
    const backoff = new Backoff(fixedRng(0.5));

    expect(backoff.next()).toBe(500);
    expect(backoff.next()).toBe(1000);
    expect(backoff.next()).toBe(2000);
    expect(backoff.next()).toBe(4000);
  });

  it('applies +20% jitter when rng() returns 1 (maximum)', () => {
    // jitter = (1*2 - 1) * 0.2 = 0.2 -> jitterFactor = 1.2
    const backoff = new Backoff(fixedRng(1));

    expect(backoff.next()).toBe(600); // 500 * 1.2
  });

  it('applies -20% jitter when rng() returns 0 (minimum)', () => {
    // jitter = (0*2 - 1) * 0.2 = -0.2 -> jitterFactor = 0.8
    const backoff = new Backoff(fixedRng(0));

    expect(backoff.next()).toBe(400); // 500 * 0.8
  });

  it('caps the delay at 30_000ms once the exponential growth exceeds the cap, even at the low end of the jitter range', () => {
    const backoff = new Backoff(fixedRng(0));
    // n=0..6: raw = 500 * 2^n = 500..32000; at n=6, raw=32000, *0.8=25600 (not yet capped).
    // At n=7, raw=64000, *0.8=51200 > 30000 -> capped.
    for (let i = 0; i < 7; i++) backoff.next();

    expect(backoff.next()).toBe(30_000);
  });

  it('stays capped at 30_000ms for many further attempts', () => {
    const backoff = new Backoff(fixedRng(1));
    for (let i = 0; i < 20; i++) backoff.next();

    expect(backoff.next()).toBe(30_000);
  });

  it('reset() restarts the sequence from the base delay', () => {
    const backoff = new Backoff(fixedRng(0.5));
    backoff.next();
    backoff.next();
    backoff.next();

    backoff.reset();

    expect(backoff.next()).toBe(500);
  });

  it('defaults to Math.random when no rng is injected, producing a delay within the jittered first-attempt range', () => {
    const backoff = new Backoff();
    const delay = backoff.next();

    expect(delay).toBeGreaterThanOrEqual(400);
    expect(delay).toBeLessThanOrEqual(600);
  });
});
