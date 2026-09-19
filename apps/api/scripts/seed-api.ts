#!/usr/bin/env node
/**
 * `pnpm --filter api seed` -- creates a test user (documented dev/test credentials, printed on
 * every run) and a sample character with a few history events, directly against the Node
 * adapter's on-disk storage under `--data-dir` (default `./data`, matching
 * `src/adapters/node/server.ts`'s own default; run with cwd = `apps/api`, the same convention
 * `src/cli/admin.ts` uses for ITS `--data-dir` default).
 *
 * doc-10 §Local development: "Seed script creates a test user and a sample campaign on either
 * adapter." Phase 2 has no campaigns yet (Phase 3 scope, Global Constraints) -- this seeds a
 * sample CHARACTER instead, which is what actually exists this phase, and is what task-11-brief
 * asks for ("test user + sample character with a few events").
 *
 * The password verifier is derived EXACTLY the way the real browser client will (ADR-012
 * §Passwords: "Key derivation in the browser: PBKDF2-HMAC-SHA-256 via WebCrypto, 600,000
 * iterations ... 16-byte per-user salt. The browser sends the 32-byte derived verifier"). The
 * client half of Phase 2 (the actual browser derivation code) has not been built yet (plan 7's
 * own scope note: "client half of Phase 2 = plan 8, to be written later"), so `deriveVerifierHex`
 * below is a small, self-contained, spec-faithful stand-in this task's brief explicitly asks for
 * ("compute verifier via WebCrypto in the script") -- not a shortcut, and not imported from
 * anywhere else in this repo. Once plan 8 ships a real client derivation, this script should be
 * pointed at it instead of keeping its own copy (noted here for that future task).
 *
 * `registerUser` (the REAL `/api/auth/register` handler, `core/auth/register.ts`) is called with
 * the resulting salt/verifier exactly as a genuine registration request would carry them, so this
 * script exercises the actual server-side registration code path end to end, not a shortcut that
 * pokes rows into the database directly.
 *
 * Idempotent: re-running against a `--data-dir` that already has this test user does not fail --
 * it reuses the existing account (same fixed default credentials every run) and seeds a fresh
 * sample character alongside whatever that account already owns.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Event } from '@hk/protocol';
import { openAccountsDb, type AccountsDbHandle } from '../src/adapters/node/db.sqlite.ts';
import { openStreamsDb } from '../src/adapters/node/store.sqlite-file.ts';
import { NodeStreamHost } from '../src/adapters/node/stream-host.ts';
import { assertConfigured, EnvConfig, loadEnvFile } from '../src/adapters/node/config.env.ts';
import { registerUser } from '../src/core/auth/register.ts';
import { uuidv7 } from '../src/core/ids.ts';
import { findUserByFoldedName, upsertCharacterIndexRow } from '../src/core/db/queries.ts';
import { foldUsername } from '../src/core/auth/username.ts';

const apiRoot = fileURLToPath(new URL('..', import.meta.url)); // apps/api/

/** Documented dev/test credentials (printed on every run) -- NOT a real account, NEVER used
 * against a deployed target; `--username`/`--password` override these for a custom seed. */
export const DEFAULT_USERNAME = 'seed-hero';
export const DEFAULT_PASSWORD = 'correct-horse-battery-staple-9';
/** ADR-012 exact value -- the CLIENT-side PBKDF2 iteration count this script reproduces. */
const PBKDF2_ITERATIONS = 600_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Derives a 32-byte PBKDF2-HMAC-SHA-256 verifier from `password`/`saltBytes` via WebCrypto,
 * hex-encoded -- ADR-012's exact browser-client algorithm (600,000 iterations, SHA-256, 16-byte
 * salt in, 32-byte verifier out). See this file's header comment for why this is a standalone
 * reference implementation rather than an import from real client code. */
export async function deriveVerifierHex(password: string, saltBytes: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export interface SeedOptions {
  readonly dataDir: string;
  readonly envFile: string;
  readonly username: string;
  readonly password: string;
}

export interface SeedResult {
  readonly userId: string;
  readonly username: string;
  readonly password: string;
  readonly characterId: string;
  /** `false` when the user account already existed (idempotent re-run) -- a fresh sample
   * character is still created either way. */
  readonly userCreated: boolean;
}

/** `character.created` (doc-02 "first event", `packages/protocol/src/events/character.ts`'s
 * `CharacterCreatedV1`) plus two small owner-allowed follow-ups -- exactly "a sample character
 * with a few events" (task-11-brief), enough for a developer to see catch-up paging and a
 * non-trivial event stream without approaching any quota. Payload shapes mirror
 * `test/conformance/scenarios.ts`'s own fixtures (`characterCreatedEvent`/`noteEvent`) --
 * schema-valid data this codebase already exercises. */
function sampleCharacterEvents(streamId: string, userId: string): Event[] {
  const now = new Date().toISOString();
  const actor = { userId, deviceId: 'seed-script', role: 'owner' as const };
  return [
    {
      id: uuidv7(),
      stream: streamId,
      ts: now,
      actor,
      type: 'character.created',
      v: 1,
      payload: {
        name: 'Seed Hero',
        system: 'srd-5e-2024',
        corePack: { id: 'srd-5e-2024', version: '1.0.0' },
        engineVersion: '1.0.0',
        grammaticalGender: 'feminine',
      },
    },
    {
      id: uuidv7(),
      stream: streamId,
      ts: now,
      actor,
      type: 'note.added',
      v: 1,
      payload: { id: uuidv7(), title: 'Origin', body: 'Seeded by apps/api/scripts/seed-api.ts for local dev.' },
    },
    {
      id: uuidv7(),
      stream: streamId,
      ts: now,
      actor,
      type: 'currency.changed',
      v: 1,
      payload: { gp: 50 },
    },
  ];
}

/** The seed itself -- callable directly from a test (this task's red-first smoke) as well as the
 * CLI entrypoint below, so the same code path is what's actually verified. */
export async function seed(options: SeedOptions): Promise<SeedResult> {
  loadEnvFile(options.envFile);
  const config = new EnvConfig();
  assertConfigured(config); // fail fast on a missing SESSION_PEPPER/SALT_HMAC_KEY/APP_ORIGIN.

  mkdirSync(options.dataDir, { recursive: true });
  const accounts: AccountsDbHandle = openAccountsDb(join(options.dataDir, 'accounts.sqlite'));
  const streamsSqlite = openStreamsDb(join(options.dataDir, 'streams.sqlite'));
  try {
    const existing = await findUserByFoldedName(accounts.db, foldUsername(options.username));
    let userId: string;
    let userCreated = false;

    if (existing) {
      userId = existing.id;
    } else {
      const saltBytes = randomBytes(16);
      const verifierHex = await deriveVerifierHex(options.password, saltBytes);
      const result = await registerUser(accounts.db, config, {
        username: options.username,
        verifier: verifierHex,
        salt: bytesToHex(saltBytes),
      });
      userId = result.userId;
      userCreated = true;
    }

    const streamHost = new NodeStreamHost(streamsSqlite);
    const characterId = uuidv7();
    const streamId = `char:${characterId}`;
    const now = Date.now();

    await upsertCharacterIndexRow(accounts.db, {
      id: characterId,
      ownerId: userId,
      name: 'Seed Hero',
      system: 'srd-5e-2024',
      campaignId: null,
      archivedAt: null,
      bytesUsed: 0,
      eventCount: 0,
      updatedAt: now,
    });

    // `StreamHost.get(id).append(...)` (the port `core/routes/characters.ts` uses over HTTP) only
    // ever returns `{firstSeq, lastSeq}` (`ports/stream.ts`'s `AppendResult`) -- it deliberately
    // does not surface per-event rejections. This script wants to fail loudly if any sample event
    // was rejected (a bug in this file, not something a real caller should ever swallow), so it
    // reaches `NodeStreamHost`'s adapter-internal `getRuntime` (the same one `server.ts`'s WS
    // upgrade handling uses) to call the actor's own `append`, which returns the full
    // `AppendOutcome` (`{acked, rejected}`) -- still routed through the SAME per-actor mutex
    // (`withLock`) every other write to this stream goes through.
    const runtime = streamHost.getRuntime(streamId);
    const outcome = await runtime.withLock(() =>
      runtime.actor.append(sampleCharacterEvents(streamId, userId), { userId, role: 'owner' }),
    );
    if (outcome.rejected.length > 0) {
      throw new Error(`seed-api: sample character events were rejected: ${JSON.stringify(outcome.rejected)}`);
    }

    return { userId, username: options.username, password: options.password, characterId, userCreated };
  } finally {
    accounts.sqlite.close();
    streamsSqlite.close();
  }
}

function parseCliArgs(argv: string[]): SeedOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      'data-dir': { type: 'string' },
      'env-file': { type: 'string' },
      username: { type: 'string' },
      password: { type: 'string' },
    },
  });
  return {
    dataDir: resolve(values['data-dir'] ?? './data'),
    envFile: resolve(values['env-file'] ?? join(apiRoot, '.env')),
    username: values.username ?? DEFAULT_USERNAME,
    password: values.password ?? DEFAULT_PASSWORD,
  };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const options = parseCliArgs(process.argv.slice(2));
  seed(options)
    .then((result) => {
      console.log('herokeep seed complete');
      console.log(`  data dir     : ${options.dataDir}`);
      console.log(`  user id      : ${result.userId}`);
      console.log(`  username     : ${result.username}`);
      console.log(`  password     : ${result.password}  (dev/test credentials only -- do not reuse)`);
      console.log(`  character id : ${result.characterId}`);
      console.log(`  account      : ${result.userCreated ? 'created' : 'already existed (idempotent re-run)'}`);
    })
    .catch((err: unknown) => {
      console.error('herokeep seed failed', err);
      process.exitCode = 1;
    });
}
