/**
 * `Config` over Worker secrets/bindings (ADR-014's Cloudflare `Secrets`/`Config` row). `env` is
 * handed to the Worker per-request by the runtime (Workers has no `process.env`-style global —
 * every binding, including secrets set via `wrangler secret put`/`.dev.vars`, arrives as a field
 * on the `Env` object `fetch(request, env, ctx)` receives), so this class is constructed fresh
 * per request in `worker.ts` rather than once at a module-level "boot" the way Node's `EnvConfig`
 * is — there is no persistent Worker "process" to construct it once for.
 */
import type { Config, ConfigName } from '../../ports/infra.ts';
import type { Env } from './env.ts';

export class BindingsConfig implements Config {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  get(name: ConfigName): string {
    const value = this.env[name];
    if (value === undefined || value.length === 0) {
      throw new Error(
        `Missing required config value: ${name}. Set it with 'wrangler secret put ${name}' (production) ` +
          `or in apps/api/.dev.vars (local dev — see apps/api/.dev.vars.example for the expected keys).`,
      );
    }
    return value;
  }
}

/** Every `ConfigName` the backend core ever reads (`ports/infra.ts`) — same list Node's
 * `assertConfigured` (`adapters/node/config.env.ts`) iterates, kept here as a runtime array for
 * the same reason: the `ConfigName` type itself erases at compile time. */
const REQUIRED_CONFIG_NAMES: readonly ConfigName[] = ['SESSION_PEPPER', 'SALT_HMAC_KEY', 'APP_ORIGIN'];

/**
 * Fail-fast-at-the-top-of-`fetch` mirror of Node's `assertConfigured` (`adapters/node/
 * config.env.ts` — "fix round 1: fail fast at boot on missing secrets", `bbb9683`). A Worker has
 * no separate "boot" step distinct from handling a request, so `worker.ts`'s `fetch()` calls this
 * FIRST, before constructing any other port or routing — a misconfigured deploy/staging
 * environment then answers every request with a loud, immediate, correctly-diagnosed failure
 * (naming the exact missing binding) instead of core throwing a confusing error deep inside the
 * first auth/WS handler that happens to call `config.get(...)`.
 */
export function assertConfigured(config: Config): void {
  for (const name of REQUIRED_CONFIG_NAMES) config.get(name);
}
