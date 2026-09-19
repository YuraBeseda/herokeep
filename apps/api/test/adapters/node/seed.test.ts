/**
 * Real-boot smoke test for `apps/api/scripts/seed-api.ts` (task-11-brief: "Verify it runs: seed
 * into a temp dir, boot the Node server on that dir, login via fetch with the derived verifier,
 * assert 200"). No fakes: `seed()` runs against a real on-disk `--data-dir` (the exact code path
 * `pnpm --filter api seed` uses), then a real `startNodeServer` boots against that SAME data dir
 * and a real `fetch` proves the seeded account can actually log in — the whole point of seeding a
 * "documented test credentials" account is that those credentials work against the real login
 * flow, not just that some rows landed in a database.
 *
 * `SESSION_PEPPER`/`SALT_HMAC_KEY`/`APP_ORIGIN` are fixed TEST-ONLY values set directly on
 * `process.env`, mirroring `server.test.ts`'s own pattern (the one other file in this suite that
 * exercises real `EnvConfig`/`startNodeServer` boot rather than `fake-ports.ts`'s in-memory
 * double) — both files point their `seed`/`startNodeServer` calls at a non-existent `--env-file`
 * so `loadEnvFile` is a no-op and these `process.env` values are what `EnvConfig` actually reads.
 */
process.env['SESSION_PEPPER'] = 'test-only-seed-script-session-pepper';
process.env['SALT_HMAC_KEY'] = 'test-only-seed-script-salt-hmac-key';
process.env['APP_ORIGIN'] = 'http://placeholder.invalid'; // overwritten once the ephemeral port is known.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startNodeServer, type NodeServerHandle } from '../../../src/adapters/node/server.ts';
import { DEFAULT_PASSWORD, DEFAULT_USERNAME, deriveVerifierHex, seed } from '../../../scripts/seed-api.ts';

const XRW = { 'X-Requested-With': 'herokeep', 'Content-Type': 'application/json' };

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

let dir: string;
let dataDir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hk-seed-script-'));
  dataDir = join(dir, 'data');
  envFile = join(dir, 'no-such.env');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scripts/seed-api.ts — creates a test user + sample character on the Node adapter', () => {
  it('seeds a user + character on disk, then a real Node adapter boot lets that user actually log in', async () => {
    const result = await seed({ dataDir, envFile, username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD });
    expect(result.userCreated).toBe(true);
    expect(result.userId).toBeTruthy();
    expect(result.characterId).toBeTruthy();
    expect(result.username).toBe(DEFAULT_USERNAME);

    let handle: NodeServerHandle | undefined;
    try {
      handle = await startNodeServer({
        port: 0,
        host: '127.0.0.1',
        dataDir,
        webDistDir: join(dir, 'web-dist'), // doesn't need to exist — a miss just answers 404.
        envFile,
      });
      const baseUrl = `http://127.0.0.1:${handle.port}`;
      process.env['APP_ORIGIN'] = baseUrl;

      // Real client flow: fetch the (real, not fake) salt, derive the verifier the SAME way the
      // seed script did, and log in with it — proving the account the script created is a
      // genuinely usable account, not just rows that happen to exist.
      const saltRes = await fetch(`${baseUrl}/api/auth/salt?username=${encodeURIComponent(DEFAULT_USERNAME)}`);
      expect(saltRes.status).toBe(200);
      const { salt } = (await saltRes.json()) as { salt: string };
      const verifier = await deriveVerifierHex(DEFAULT_PASSWORD, hexToBytes(salt));

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: XRW,
        body: JSON.stringify({ username: DEFAULT_USERNAME, verifier, deviceLabel: 'seed-smoke-test' }),
      });
      expect(loginRes.status).toBe(200);
      const loginBody = (await loginRes.json()) as { userId: string };
      expect(loginBody.userId).toBe(result.userId);

      // The seeded sample character shows up in the logged-in user's own character list.
      const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0]!;
      const listRes = await fetch(`${baseUrl}/api/characters`, { headers: { cookie } });
      expect(listRes.status).toBe(200);
      const characters = (await listRes.json()) as { id: string; name: string; eventCount: number }[];
      const seeded = characters.find((c) => c.id === result.characterId);
      expect(seeded).toBeDefined();
      expect(seeded?.name).toBe('Seed Hero');
    } finally {
      await handle?.close();
    }
  });

  it('is idempotent: re-running against the same --data-dir reuses the account and adds another character', async () => {
    const first = await seed({ dataDir, envFile, username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD });
    const second = await seed({ dataDir, envFile, username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD });

    expect(first.userCreated).toBe(true);
    expect(second.userCreated).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(second.characterId).not.toBe(first.characterId);
  });
});
