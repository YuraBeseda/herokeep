/**
 * `Scheduler` over `setInterval` (ADR-014's Node `Scheduler` row: "`setInterval` /
 * `node-cron`"). `setInterval` (not a cron-string library) because this port has exactly one
 * caller shape — "once a day" — and Node's own timer is sufficient; a cron dependency would add a
 * parser for expressiveness nothing here needs. Deliberately NOT wired to a real maintenance
 * function by this task: `core/maintenance.ts` (usage counters, expired-session purge, orphan
 * check) is Task 10's scope (doc-10 §Daily maintenance); this class only implements the PORT so
 * Task 10 has something to call `.daily(runMaintenance)` against without also owning an adapter
 * change.
 */
import type { Scheduler } from '../../ports/infra.ts';

const DAY_MS = 24 * 60 * 60_000;

export class IntervalScheduler implements Scheduler {
  private readonly timers: NodeJS.Timeout[] = [];

  daily(fn: () => Promise<void> | void): void {
    const timer = setInterval(() => {
      void fn();
    }, DAY_MS);
    // Don't keep the process alive on this timer alone (a bare `node server.ts` should still
    // exit cleanly if everything else has shut down) — mirrors the convention Node's own docs
    // recommend for long-lived background timers that aren't the reason the process is running.
    timer.unref();
    this.timers.push(timer);
  }

  /** Test/shutdown hook — not part of the `Scheduler` port (which has no `stop`, since neither
   * Cloudflare's Cron Trigger nor a running Node process ever needs to cancel a daily job mid-
   * life in production); exposed here so `close()` in `server.ts`/tests can avoid leaking timers
   * across test runs. */
  stopAll(): void {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
  }
}
