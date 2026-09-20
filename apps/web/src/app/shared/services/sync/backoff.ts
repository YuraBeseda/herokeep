/**
 * Reconnect backoff (docs/02-architecture/03-sync-protocol.md §Connection lifecycle,
 * docs/superpowers/plans/2026-09-19-phase-2-client-sync.md §Global Constraints, doc-03 EXACT
 * numbers): `0.5 s × 2ⁿ` with `±20 %` jitter, capped at `30 s`. `n` is this instance's own
 * attempt counter (0 on construction and after every `reset()`), incremented on each `next()`.
 *
 * Jitter is applied as a multiplicative factor in `[0.8, 1.2]` derived from the injected `rng()`
 * (`rng() * 2 - 1` maps `[0,1)` to `[-1,1)`, scaled by the `0.2` jitter ratio), and the cap is
 * applied AFTER jitter — so once the raw exponential value is large enough that even the low end
 * of the jitter range (`× 0.8`) exceeds `30_000`, `next()` deterministically returns exactly
 * `30_000` regardless of the rng's actual output (true from `n = 7` on: `raw(7) = 64_000`,
 * `64_000 × 0.8 = 51_200 > 30_000`).
 *
 * This is UI/client code, not `packages/engine` — CLAUDE.md's determinism rule (no `Math.random`)
 * doesn't apply here. `rng` still defaults to `Math.random` but is constructor-injectable so
 * specs can pin exact delays with a fake sequence.
 */

const BASE_DELAY_MS = 500;
const CAP_DELAY_MS = 30_000;
const JITTER_RATIO = 0.2;

export class Backoff {
  private attempt = 0;

  constructor(private readonly rng: () => number = Math.random) {}

  /** Returns the delay (ms) for the current attempt, then advances the attempt counter. */
  next(): number {
    const raw = BASE_DELAY_MS * 2 ** this.attempt;
    this.attempt++;

    const jitterFactor = 1 + (this.rng() * 2 - 1) * JITTER_RATIO;
    return Math.min(Math.round(raw * jitterFactor), CAP_DELAY_MS);
  }

  /** Restarts the sequence at attempt 0 (called on a successful connection). */
  reset(): void {
    this.attempt = 0;
  }
}
