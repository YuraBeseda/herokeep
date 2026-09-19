import type { Db } from '../db/index.ts';
import type { Config, RateLimit } from '../../ports/index.ts';

/** The three runtime ports every auth flow needs (Task 2's `Config`/`RateLimit`, Task 3's `Db`).
 * Routes (`core/routes/{auth,me}.ts`) accept this once and thread it through every handler and
 * middleware factory, so adapters wire it up in exactly one place per createApp call (Task 6). */
export interface AuthDeps {
  readonly db: Db;
  readonly config: Config;
  readonly rateLimit: RateLimit;
}
