/**
 * `Config` over `.env` (ADR-014's Node `Secrets`/`Config` row). Two pieces: `loadEnvFile` (populates
 * `process.env` before anything reads it) and `EnvConfig` (the port implementation `createApp`
 * receives, reading `process.env` — never a file — at call time).
 *
 * ## `.env` loading choice
 *
 * The task brief names two options: Node 24's built-in `process.loadEnvFile()` (stable since
 * Node 20.6, matured through 22/24) or a hand-rolled ~5-line parser. This file uses the hand-rolled
 * parser, for one concrete reason: `process.loadEnvFile(path?)` with NO argument resolves `.env`
 * relative to the process's CURRENT WORKING DIRECTORY, which is whatever directory the process was
 * LAUNCHED from — fine for `pnpm --filter api dev:node` (cwd = `apps/api`), but the self-host
 * recipe (ADR-014 §Adapter B, Task 12) runs this server as an NSSM Windows service, which does NOT
 * guarantee cwd = the install directory unless every service-install step gets that exactly right.
 * `loadEnvFile` below is instead called by `server.ts` with an EXPLICIT path resolved from
 * `import.meta.url` (this module's own location on disk), so `.env` loading is correct regardless
 * of the process's cwd. The parser itself only needs to handle this repo's actual `.env.example`
 * shape (`KEY=value` lines, `#` comments, optional quotes) — not the full dotenv spec (multiline
 * values, `export` prefixes, `$VAR` interpolation), none of which this file's three secrets need.
 *
 * Values already present in `process.env` are NEVER overwritten (real deployment environment
 * variables — e.g. set directly in the NSSM service config — always win over `.env`, matching
 * dotenv's own convention).
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Config, ConfigName } from '../../ports/infra.ts';

export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) value = value.slice(1, -1);
    if (key.length > 0 && process.env[key] === undefined) process.env[key] = value;
  }
}

/** The `Config` port over `process.env` (`ports/infra.ts`'s `ConfigName` union: `SESSION_PEPPER`,
 * `SALT_HMAC_KEY`, `APP_ORIGIN` — the only three names core ever asks for). Throws loudly on a
 * missing value at the point of use rather than returning `undefined`/`''`, since every one of
 * these three is required for the server to behave correctly (a missing pepper/HMAC key would
 * silently break every password hash/salt derivation, which must fail fast at startup-adjacent
 * code, not produce a wrong-but-successful auth flow). See `assertConfigured` below for why
 * `server.ts` doesn't rely on THIS throw alone to catch a missing value. */
export class EnvConfig implements Config {
  get(name: ConfigName): string {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
      throw new Error(
        `Missing required config value: ${name}. Set it in apps/api/.env (see apps/api/.env.example` +
          ' for the expected keys) or in the process/service environment.',
      );
    }
    return value;
  }
}

/** Every `ConfigName` the backend core ever reads (`ports/infra.ts`) — kept here as a runtime
 * array (the type itself, `ConfigName`, erases at compile time) purely so `assertConfigured`
 * below has something to iterate. */
const REQUIRED_CONFIG_NAMES: readonly ConfigName[] = ['SESSION_PEPPER', 'SALT_HMAC_KEY', 'APP_ORIGIN'];

/**
 * Fix round 1 finding: `EnvConfig.get`'s throw only ever fires the first time SOMETHING calls
 * `config.get(name)` — with no eager check, a `.env`/environment missing a secret lets
 * `startNodeServer` boot "successfully" (HTTP listening, health check green) and only fails on
 * the FIRST real auth request (register/login/salt — the first code path that touches
 * `Config.get('SESSION_PEPPER'|'SALT_HMAC_KEY')`), or worse, on the first WS upgrade for
 * `APP_ORIGIN`. For an NSSM service operator with no request-level logs to correlate against,
 * that is a confusing, delayed failure discovered by a USER, not by the boot log.
 *
 * `server.ts` calls this immediately after constructing `EnvConfig` — before `mkdirSync`, before
 * either SQLite file is opened, before `httpServer.listen` — so a missing secret is instead an
 * immediate, loud boot failure (the process never opens a socket or a data file at all) with a
 * message naming the exact missing variable and pointing at `.env.example`, reusing
 * `EnvConfig.get`'s own error text rather than duplicating it.
 */
export function assertConfigured(config: Config): void {
  for (const name of REQUIRED_CONFIG_NAMES) config.get(name);
}
