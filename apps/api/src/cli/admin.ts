#!/usr/bin/env node
/**
 * `herokeep-admin` — the export/import/recovery CLI (doc-10 §Layout: "`admin.ts` herokeep-admin
 * export/import (NDJSON), user tools (reset recovery codes)"; ADR-014 §Switching between
 * targets). NOT under `src/core/**`, so — unlike `core/maintenance.ts` — it may (and does) talk
 * to the Node adapter's concrete storage directly: `better-sqlite3` files under `--data-dir`
 * (default `./data`, matching `adapters/node/server.ts`'s own default).
 *
 * Three commands:
 *   - `export --out <dir>`: dumps `--data-dir`'s accounts (users, characters, recovery-code
 *     HASHES — never sessions, never a raw code) plus every character's stream, each as
 *     newline-delimited JSON (`users.ndjson`, `characters.ndjson`, `recovery-codes.ndjson`,
 *     `streams/<file>.ndjson` — see `streamIdToFileName`'s doc comment for the filename shape).
 *   - `import --in <dir>`: loads an export produced above into `--data-dir`. **Collision
 *     semantics ("merge-empty-only"):** refuses outright, before writing anything, unless the
 *     target is COMPLETELY empty (zero users, zero characters, zero stream events) — this CLI
 *     never merges into a populated store; the accepted way to move data is always "export from
 *     the old target, import into a brand-new `--data-dir`" (ADR-014's own "switching targets"
 *     scenario), never a partial/incremental sync. Streams are append-only and the target is
 *     always empty for a stream it writes to, so a plain `StreamStore.append` in original seq
 *     order reproduces IDENTICAL seqs — `append` assigns seq from `MAX(seq)+1` over the target's
 *     OWN rows, never reading the source event's `seq` field at all (`store.sqlite-file.ts`).
 *   - `reset-recovery --username <u>`: deletes ("burns") every existing recovery-code row for
 *     that user and inserts 6 freshly generated ones, printed ONCE (never persisted in cleartext
 *     — only their hashes are stored, exactly like `auth/register.ts`'s own registration flow).
 *
 * **Cloudflare**: this CLI only ever touches the Node adapter's on-disk sqlite files — it never
 * shells out to `wrangler` itself (task-10-brief: "NO wrangler invocation from the CLI itself").
 * Moving to/from a Cloudflare target is a two-step, human-driven process (ADR-014 §Switching
 * between targets; doc-10 sanctions this path): (1) produce a LOCAL copy of the Cloudflare data
 * shaped like a Node data dir — `wrangler d1 export` for the accounts half, and a Durable Object
 * storage backup/replay for the stream half (Cloudflare has no bulk "dump every DO" primitive;
 * this is inherently a per-DO, manual step); (2) run this CLI (`export`/`import`) against that
 * local copy exactly as it would against a real Node adapter's `--data-dir`. See `USAGE` below,
 * printed by `--help` and on any usage error.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Event } from '@hk/protocol';
import { openAccountsDb, type AccountsDbHandle } from '../adapters/node/db.sqlite.ts';
import { openStreamsDb, SqliteFileStreamStore } from '../adapters/node/store.sqlite-file.ts';
import { foldUsername } from '../core/auth/username.ts';
import { formatRecoveryCode, normalizeRecoveryCode, randomRecoveryCode } from '../core/auth/recovery-codes.ts';
import { sha256Hex } from '../core/crypto.ts';
import {
  type NewCharacter,
  type NewRecoveryCode,
  type NewUser,
  findUserByFoldedName,
  insertRecoveryCodes,
  insertUser,
  listAllCharacters,
  listAllRecoveryCodes,
  listAllUsers,
  deleteRecoveryCodesForUser,
  upsertCharacterIndexRow,
} from '../core/db/queries.ts';

const RECOVERY_CODE_COUNT = 6; // matches auth/register.ts's own registration-time count (ADR-012).
const STREAM_READ_PAGE_SIZE = 500;

export interface CliResult {
  readonly exitCode: number;
  readonly lines: string[];
}

const USAGE = [
  'herokeep-admin <command> [options]',
  '',
  '  export --out <dir> [--data-dir <dir>]',
  "      Dump --data-dir's accounts (users, characters, recovery-code HASHES -- never",
  '      sessions, never a raw code) and every character stream as NDJSON into <dir>.',
  '',
  '  import --in <dir> [--data-dir <dir>]',
  '      Load an export (produced by `export` above) into --data-dir. Refuses, before writing',
  '      anything, unless --data-dir is COMPLETELY EMPTY ("merge-empty-only" -- see admin.ts\'s',
  '      header comment). Use a fresh --data-dir for every import.',
  '',
  '  reset-recovery --username <u> [--data-dir <dir>]',
  '      Burn every existing recovery code for <u> and print 6 fresh ones ONCE.',
  '',
  "  --data-dir defaults to ./data (the Node adapter's own default, adapters/node/server.ts).",
  '',
  "Cloudflare targets: this CLI only ever reads/writes the NODE adapter's on-disk sqlite files",
  'and never invokes wrangler itself. To move to/from Cloudflare: (1) produce a LOCAL copy of the',
  'Cloudflare data shaped like a Node data dir -- `wrangler d1 export` for the accounts half, a',
  'Durable Object storage backup/replay for the stream half -- then (2) run `export`/`import`',
  'above against that local copy exactly as against a real Node --data-dir.',
].join('\n');

function resolveDataDir(values: { 'data-dir'?: string }): string {
  return resolve(values['data-dir'] ?? './data');
}

function toNdjson(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
}

function readNdjson<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

/**
 * `char:<uuid>` -> `char_<uuid>.ndjson` (and back). Windows filenames reject `:`, so the
 * streamId's own separator can't be used verbatim; `_` is safe to split back on unambiguously
 * because Phase 2 has exactly one stream-id prefix (`char:`, `@hk/protocol`'s `StreamIdSchema` —
 * campaign streams are Phase 3) and a uuidv7 never contains `_` (`core/ids.ts`'s hex+hyphen
 * alphabet). `String.prototype.replace` with a STRING pattern (not a RegExp) replaces only the
 * FIRST occurrence in both directions, which is exactly what's needed here.
 */
function streamIdToFileName(streamId: string): string {
  return `${streamId.replace(':', '_')}.ndjson`;
}

function fileNameToStreamId(fileName: string): string {
  return fileName.replace(/\.ndjson$/, '').replace('_', ':');
}

async function runExport(dataDir: string, outDir: string): Promise<CliResult> {
  const accountsPath = join(dataDir, 'accounts.sqlite');
  if (!existsSync(accountsPath)) {
    return { exitCode: 1, lines: [`No accounts.sqlite found under ${dataDir} -- nothing to export.`] };
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'streams'), { recursive: true });

  const accounts: AccountsDbHandle = openAccountsDb(accountsPath);
  const streamsSqlite = openStreamsDb(join(dataDir, 'streams.sqlite'));
  try {
    const users = await listAllUsers(accounts.db);
    const characters = await listAllCharacters(accounts.db);
    const recoveryCodes = await listAllRecoveryCodes(accounts.db);

    writeFileSync(join(outDir, 'users.ndjson'), toNdjson(users));
    writeFileSync(join(outDir, 'characters.ndjson'), toNdjson(characters));
    writeFileSync(join(outDir, 'recovery-codes.ndjson'), toNdjson(recoveryCodes));

    let totalEvents = 0;
    for (const character of characters) {
      const streamId = `char:${character.id}`;
      const store = new SqliteFileStreamStore(streamsSqlite, streamId);
      const head = await store.head();
      const events: unknown[] = [];
      let from = 1;
      while (from <= head) {
        const page = await store.read(from, STREAM_READ_PAGE_SIZE);
        if (page.length === 0) break; // defensive: store/head disagreement should not spin forever
        events.push(...page);
        from += page.length;
      }
      totalEvents += events.length;
      writeFileSync(join(outDir, 'streams', streamIdToFileName(streamId)), toNdjson(events));
    }

    return {
      exitCode: 0,
      lines: [
        `Exported ${users.length} user(s), ${characters.length} character(s), ` +
          `${recoveryCodes.length} recovery code(s), ${totalEvents} event(s) across ` +
          `${characters.length} stream(s) to ${outDir}`,
      ],
    };
  } finally {
    accounts.sqlite.close();
    streamsSqlite.close();
  }
}

async function runImport(dataDir: string, inDir: string): Promise<CliResult> {
  mkdirSync(dataDir, { recursive: true });
  const accounts: AccountsDbHandle = openAccountsDb(join(dataDir, 'accounts.sqlite'));
  const streamsSqlite = openStreamsDb(join(dataDir, 'streams.sqlite'));
  try {
    // "merge-empty-only" collision check (this file's header comment) -- refuse BEFORE writing
    // anything if the target already holds any of this data.
    const existingUsers = await listAllUsers(accounts.db);
    const existingCharacters = await listAllCharacters(accounts.db);
    const existingEventRow = streamsSqlite.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number };
    if (existingUsers.length > 0 || existingCharacters.length > 0 || existingEventRow.c > 0) {
      return {
        exitCode: 3,
        lines: [
          `Import target ${dataDir} is not empty: ${existingUsers.length} user(s), ` +
            `${existingCharacters.length} character(s), ${existingEventRow.c} event row(s) already present.`,
          'herokeep-admin import only supports an EMPTY target ("merge-empty-only" -- it never ' +
            'merges into a populated store). Use a fresh --data-dir.',
        ],
      };
    }

    const users = readNdjson<NewUser>(join(inDir, 'users.ndjson'));
    const characters = readNdjson<NewCharacter>(join(inDir, 'characters.ndjson'));
    const recoveryCodes = readNdjson<NewRecoveryCode>(join(inDir, 'recovery-codes.ndjson'));

    // Insertion order matters: `recovery_codes.user_id`/`characters.owner_id` both reference
    // `users.id` under `PRAGMA foreign_keys = ON` (`db.sqlite.ts`'s `openAccountsDb`).
    for (const user of users) await insertUser(accounts.db, user);
    if (recoveryCodes.length > 0) await insertRecoveryCodes(accounts.db, recoveryCodes);
    for (const character of characters) await upsertCharacterIndexRow(accounts.db, character);

    let streamCount = 0;
    let eventCount = 0;
    const streamsDir = join(inDir, 'streams');
    if (existsSync(streamsDir)) {
      for (const fileName of readdirSync(streamsDir)) {
        if (!fileName.endsWith('.ndjson')) continue;
        const streamId = fileNameToStreamId(fileName);
        const events = readNdjson<Event>(join(streamsDir, fileName));
        const store = new SqliteFileStreamStore(streamsSqlite, streamId);
        // One event per `append` call, strictly in file (== original seq) order: the target
        // stream is guaranteed empty (the collision check above), so each call's freshly
        // computed `MAX(seq)+1` reproduces the ORIGINAL seq exactly -- see this file's header
        // comment. A single `append(events)` batch call would reproduce the same seqs too; this
        // just keeps a mid-import crash's partial state easy to reason about (whichever prefix
        // of events already committed keeps its correct, final seqs).
        for (const event of events) {
          await store.append([event]);
          eventCount += 1;
        }
        streamCount += 1;
      }
    }

    return {
      exitCode: 0,
      lines: [
        `Imported ${users.length} user(s), ${characters.length} character(s), ` +
          `${recoveryCodes.length} recovery code(s), ${eventCount} event(s) across ` +
          `${streamCount} stream(s) into ${dataDir}`,
      ],
    };
  } finally {
    accounts.sqlite.close();
    streamsSqlite.close();
  }
}

async function runResetRecovery(dataDir: string, username: string): Promise<CliResult> {
  const accountsPath = join(dataDir, 'accounts.sqlite');
  if (!existsSync(accountsPath)) {
    return { exitCode: 1, lines: [`No accounts.sqlite found under ${dataDir}.`] };
  }
  const accounts: AccountsDbHandle = openAccountsDb(accountsPath);
  try {
    const usernameFolded = foldUsername(username);
    const user = await findUserByFoldedName(accounts.db, usernameFolded);
    if (!user) return { exitCode: 4, lines: [`No such user: ${username}`] };

    // "Burns" the old codes (task-10-brief) -- deleted outright, not merely marked used, so a
    // stale exported/leaked hash can never be replayed against this account again either.
    await deleteRecoveryCodesForUser(accounts.db, user.id);

    const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());
    const hashedCodes = await Promise.all(
      rawCodes.map(async (code) => ({
        userId: user.id,
        codeHash: await sha256Hex(normalizeRecoveryCode(code)),
        usedAt: null,
      })),
    );
    await insertRecoveryCodes(accounts.db, hashedCodes);

    return {
      exitCode: 0,
      lines: [
        `New recovery codes for ${user.username} -- old codes burned. Shown ONCE, store them safely:`,
        ...rawCodes.map(formatRecoveryCode),
      ],
    };
  } finally {
    accounts.sqlite.close();
  }
}

export async function main(argv: string[]): Promise<CliResult> {
  try {
    const [command, ...rest] = argv;
    if (command === '--help' || command === '-h' || command === undefined) {
      return { exitCode: command === undefined ? 2 : 0, lines: [USAGE] };
    }
    if (command === 'export') {
      const { values } = parseArgs({
        args: rest,
        options: { out: { type: 'string' }, 'data-dir': { type: 'string' } },
      });
      if (!values.out) return { exitCode: 2, lines: ['export requires --out <dir>', USAGE] };
      return await runExport(resolveDataDir(values), resolve(values.out));
    }
    if (command === 'import') {
      const { values } = parseArgs({
        args: rest,
        options: { in: { type: 'string' }, 'data-dir': { type: 'string' } },
      });
      if (!values.in) return { exitCode: 2, lines: ['import requires --in <dir>', USAGE] };
      return await runImport(resolveDataDir(values), resolve(values.in));
    }
    if (command === 'reset-recovery') {
      const { values } = parseArgs({
        args: rest,
        options: { username: { type: 'string' }, 'data-dir': { type: 'string' } },
      });
      if (!values.username) return { exitCode: 2, lines: ['reset-recovery requires --username <u>', USAGE] };
      return await runResetRecovery(resolveDataDir(values), values.username);
    }
    return { exitCode: 2, lines: [`Unknown command: ${command}`, USAGE] };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code && String(err.code).startsWith('ERR_PARSE_ARGS')) {
      return { exitCode: 2, lines: [String(err.message), USAGE] };
    }
    throw e;
  }
}

if (process.argv[1] && /admin\.(js|ts)$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((r) => {
      for (const line of r.lines) (r.exitCode === 0 ? console.log : console.error)(line);
      process.exit(r.exitCode);
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
