/** `/api/characters/*` (task-6-brief). Every route here requires a valid session (`requireAuth`,
 * same as `core/routes/me.ts`); ownership beyond "is logged in" is then checked per-route against
 * the D1 index row (`findCharacterById`) — doc-10 §Request routing: "verify session + ownership
 * ... (Db)". D1 is the ownership authority for every route here, including the WS handoff: this
 * file never reads a stream's own `CharacterActor` meta to decide who owns a character (see
 * `character-actor.ts`'s header comment for why each store's `ownerId` copy has exactly one
 * writer, and D1's is this file).
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AuthDeps } from '../auth/types.ts';
import { requireAuth, type AuthEnv } from '../auth/middleware.ts';
import type { StreamHost } from '../../ports/stream.ts';
import type { WsUpgrade } from '../../ports/infra.ts';
import { requireXRequestedWith } from '../http/xrw-gate.ts';
import { installErrorHandler } from '../http/error-handler.ts';
import { badRequest, conflict, forbidden, limitExceeded, notFound, quotaExceeded } from '../errors.ts';
import { USER_CHARACTER_COUNT_MAX, USER_QUOTA_BYTES_MAX } from '../quotas.ts';
import {
  adjustUserQuotaBytes,
  countCharactersForOwner,
  deleteCharacterIndexRow,
  findCharacterById,
  getUserQuotaBytes,
  listCharactersForOwner,
  upsertCharacterIndexRow,
} from '../db/queries.ts';

const BODY_LIMIT_BYTES = 64 * 1024; // ADR-012 exact value (same cap every route in this app uses)

export interface CharactersDeps extends AuthDeps {
  readonly streamHost: StreamHost;
  readonly wsUpgrade: WsUpgrade;
}

/** The HTTP-facing shape of a character index row — same fields as the D1 `characters` table
 * (doc-02 §Entities), loosely typed here (rather than importing Drizzle's `Character`/
 * `NewCharacter` select/insert types) so this function accepts both a freshly-built row (the
 * create route, before any DB round-trip) and a row read back from `Db` without a cast. */
interface CharacterDto {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly campaignId: string | null;
  readonly archivedAt: number | null;
  readonly bytesUsed: number;
  readonly eventCount: number;
  readonly updatedAt: number;
}

function toCharacterDto(row: CharacterDto): CharacterDto {
  return {
    id: row.id,
    name: row.name,
    system: row.system,
    campaignId: row.campaignId,
    archivedAt: row.archivedAt,
    bytesUsed: row.bytesUsed,
    eventCount: row.eventCount,
    updatedAt: row.updatedAt,
  };
}

interface CreateBody {
  readonly id?: string;
  readonly name?: string;
  readonly system?: string;
}

async function parseJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest('Invalid JSON body');
  }
}

export function createCharacterRoutes(deps: CharactersDeps) {
  const app = new Hono<AuthEnv>();
  installErrorHandler(app);

  app.use('*', requireXRequestedWith());
  app.use(
    '*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large', message: 'Request body too large' }, 413),
    }),
  );
  app.use('*', requireAuth(deps));

  app.get('/', async (c) => {
    const user = c.get('user');
    const rows = await listCharactersForOwner(deps.db, user.userId);
    return c.json(rows.map(toCharacterDto));
  });

  app.post('/', async (c) => {
    const user = c.get('user');
    const body = await parseJsonBody<CreateBody>(c.req.raw);
    if (!body.id || !body.name || !body.system) throw badRequest('id, name and system are required');

    // Idempotent-create: a row with this id already registered to THIS user is a harmless retry
    // (matches the codebase's general idempotent-retry philosophy — doc-03's dedupe-by-id rule
    // for events, applied here at the D1-row level); one already registered to a DIFFERENT user
    // is a real id collision (client bug or an attempted ownership hijack via
    // `upsertCharacterIndexRow`'s `onConflictDoUpdate`, which this check exists to block) and is
    // refused before that upsert ever runs.
    const existing = await findCharacterById(deps.db, body.id);
    if (existing) {
      if (existing.ownerId !== user.userId) throw conflict('Character id already in use');
      return c.json(toCharacterDto(existing), 200);
    }

    // Per-USER quota, BOTH halves of doc-08's "User total" row, each checked here on CREATE
    // (never on append — StreamActor has no user id and no `Db`, quotas.ts's header comment):
    //   - character COUNT (see quotas.ts's `USER_CHARACTER_COUNT_MAX` doc comment for the
    //     archived-counts-too finding).
    const count = await countCharactersForOwner(deps.db, user.userId);
    if (count >= USER_CHARACTER_COUNT_MAX) {
      throw limitExceeded(`Character limit reached: ${USER_CHARACTER_COUNT_MAX} characters per account`);
    }
    //   - total BYTES across characters (`users.quota_bytes_used`). Fix round 1, controller
    //     ruling recorded in full in quotas.ts's `USER_QUOTA_BYTES_MAX` doc comment: this reads
    //     a value the daily maintenance job (Task 10) keeps in sync, accepted stale by up to 24h
    //     as an anti-abuse gate because the realtime per-stream 2 MB cap bounds any burst.
    const quotaBytesUsed = await getUserQuotaBytes(deps.db, user.userId);
    if (quotaBytesUsed >= USER_QUOTA_BYTES_MAX) {
      throw quotaExceeded(`Storage quota reached: ${USER_QUOTA_BYTES_MAX} bytes across all characters`);
    }

    const now = Date.now();
    const row: CharacterDto = {
      id: body.id,
      name: body.name,
      system: body.system,
      campaignId: null,
      archivedAt: null,
      bytesUsed: 0,
      eventCount: 0,
      updatedAt: now,
    };
    // The character's own domain data (the `character.created` event that actually establishes
    // its facts, per doc-02 "first event") is appended by the CLIENT over the WS connection this
    // row's existence unlocks (the WS handoff's ownership check reads this exact row) — this
    // route's job is registering ownership in D1 ONLY, not driving the stream. See
    // `character-actor.ts`'s header comment for the corresponding stream-side write (owned by
    // `CharacterActor` itself, hooked off that same `character.created` commit).
    await upsertCharacterIndexRow(deps.db, { ...row, ownerId: user.userId });
    return c.json(row, 201);
  });

  app.post('/:id/archive', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await findCharacterById(deps.db, id);
    if (existing?.ownerId !== user.userId) throw notFound('Character not found');

    // Soft delete (doc-02: `character.archived`/`character.restored` are OWNER-authored domain
    // events; ADR-003: "Delete is soft: `character.archived` event + 30-day 'Trash' list").
    // Task 6's finding (doc-08 read together with ADR-003 — see quotas.ts's
    // `USER_CHARACTER_COUNT_MAX` doc comment for the full quote): archiving is a step ON THE WAY
    // to freeing space, not freeing it itself — only hard delete does. Nothing in doc-03's
    // append pipeline (doc-10 §StreamActor, `stream-actor.ts`) or doc-08's authorization matrix
    // conditions permission/appendability on an `archived` flag, so archiving here is COSMETIC:
    // it flips this D1 index row's `archivedAt` (hides the character from an "active" list,
    // still counts toward the 50-cap, still fully readable/writable) and nothing else. This
    // route deliberately does NOT touch the stream at all (no `StreamHost.get(id)` call): unlike
    // `ownerId` (set by `CharacterActor` off `character.created`, this file's create route
    // writing only the D1 half), `archived`'s stream-side mirror
    // (`CharacterActor.applyMetaHooks`) is driven by the CLIENT appending `character.archived`/
    // `character.restored` over WS, exactly like every other in-play event — this HTTP endpoint
    // is a convenience for a UI action that doesn't require a live socket, not a second writer
    // racing the stream's own event-sourced truth.
    await upsertCharacterIndexRow(deps.db, { ...existing, archivedAt: Date.now(), updatedAt: Date.now() });
    return c.body(null, 204);
  });

  app.delete('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await findCharacterById(deps.db, id);
    if (existing?.ownerId !== user.userId) throw notFound('Character not found');

    // Hard delete: wipe the stream's OWN storage first (via `StreamHost.get(id)`, so the
    // single-writer guarantee covers it — see `ports/stream.ts`'s `StreamHandle.deleteAll` doc
    // comment), then drop the D1 index row. This order means a crash between the two steps
    // leaves an orphaned D1 row (recoverable/inspectable) rather than an orphaned stream with no
    // owning index row (silently unreachable, worse) — the D1 row is the RECORD that a delete
    // was requested, so it should be the last thing removed, not the first.
    const handle = deps.streamHost.get(`char:${id}`);
    await handle.deleteAll();
    await deleteCharacterIndexRow(deps.db, id);

    // Best-effort IMMEDIATE decrement of the per-user byte quota (fix round 1, controller
    // ruling — quotas.ts's `USER_QUOTA_BYTES_MAX` doc comment, quoted there in full: "hard
    // delete additionally does a best-effort immediate decrement so freed space is usable
    // without waiting a day"). "Best-effort"/approximate because `existing.bytesUsed` is itself
    // only as fresh as the last daily sync (this file's create-route comment; `queries.ts`'s
    // `upsertCharacterIndexRow` doc comment) — the daily maintenance job (Task 10) trues the
    // real number up regardless, this just avoids a user having to wait up to 24h to reuse space
    // they just freed. Floored at 0 by `adjustUserQuotaBytes` itself (never a negative quota).
    await adjustUserQuotaBytes(deps.db, user.userId, -existing.bytesUsed);
    return c.body(null, 204);
  });

  app.get('/:id/ws', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await findCharacterById(deps.db, id);
    if (existing?.ownerId !== user.userId) {
      throw forbidden('Not the owner of this character');
    }

    const origin = c.req.header('Origin');
    if (origin !== deps.config.get('APP_ORIGIN')) {
      throw forbidden('Origin does not match the app origin');
    }

    return deps.wsUpgrade.upgrade(c.req.raw, { streamId: `char:${id}`, userId: user.userId, role: 'owner' });
  });

  return app;
}
