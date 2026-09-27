/** `/api/characters/*` (task-6-brief). Every route here requires a valid session (`requireAuth`,
 * same as `core/routes/me.ts`); ownership beyond "is logged in" is then checked per-route against
 * the D1 index row (`findCharacterById`) — doc-10 §Request routing: "verify session + ownership
 * ... (Db)". D1 is the ownership authority for every route here, including the WS handoff.
 *
 * [plan-10 Task 12 round 2 — CORRECTS this file's own earlier stance] D1's `owner_id` column no
 * longer has "exactly one writer" — this was true through Phase 2 (only the create route ever
 * wrote it) but is no longer accurate now that claiming/handing over a character is a real,
 * supported flow (doc-02 L178-179: "a claimed pregen behaves like any player character" — ruling
 * 6). `POST /:id/transfer` below is the SECOND writer, moving `owner_id` to a new user and
 * appending the matching `character.owner_transferred` event on the SAME stream `character-
 * actor.ts`'s meta hook (commit ca50db0) already reacts to — this file still never READS the
 * stream's own `CharacterActor` meta to decide ownership (D1 stays the read-side authority for
 * every route), it just now has two write paths instead of one.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Actor, Event } from '@hk/protocol';
import type { AuthDeps } from '../auth/types.ts';
import { requireAuth, type AuthEnv } from '../auth/middleware.ts';
import type { StreamHost } from '../../ports/stream.ts';
import type { WsUpgrade } from '../../ports/infra.ts';
import { requireXRequestedWith } from '../http/xrw-gate.ts';
import { installErrorHandler } from '../http/error-handler.ts';
import { badRequest, conflict, forbidden, limitExceeded, notFound, quotaExceeded } from '../errors.ts';
import { USER_CHARACTER_COUNT_MAX, USER_QUOTA_BYTES_MAX } from '../quotas.ts';
import { uuidv7 } from '../ids.ts';
import {
  adjustUserQuotaBytes,
  countCharactersForOwner,
  deleteCharacterIndexRow,
  findCharacterById,
  findUserById,
  getUserQuotaBytes,
  listCharactersForOwner,
  updateCharacterOwner,
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

  interface TransferBody {
    readonly toUserId?: string;
  }

  /**
   * `POST /:id/transfer` (plan-10 Task 12 round 2, doc-02 L178-179's binding claim/hand-over
   * ruling) — mirrors `core/routes/campaigns.ts`'s own dual-write pattern EXACTLY (D1 first, one
   * atomic event append second, best-effort D1 rollback on append failure; see that file's
   * header comment, "Atomic campaign bootstrap" + "Thrown appends"):
   *
   *   1. Authorization: the session user must be `existing.ownerId` (same 404-not-403 "don't
   *      leak existence" stance every other route here already takes).
   *   2. Target validation: `toUserId` must name a real user (D1 lookup) — `characters.owner_id`
   *      has a NOT NULL FK to `users.id` (`db/schema.ts`), so an unknown target would otherwise
   *      surface as an ugly constraint-violation 500 instead of an honest 404.
   *   3. Quota admission for the RECEIVING owner — the create route's OWN two gates
   *      (`USER_CHARACTER_COUNT_MAX`/`USER_QUOTA_BYTES_MAX`), just checked against the target's
   *      totals instead of the acting user's own. Skipped entirely for a (degenerate,
   *      self-)transfer to the CURRENT owner — their own totals already include this character,
   *      so re-checking would wrongly double-count it against their own cap.
   *   4. D1 first: `updateCharacterOwner` (the row's OWN `updatedAt`, not touched by anything
   *      else here), then a best-effort BIDIRECTIONAL `adjustUserQuotaBytes` re-attribution of
   *      the row's cached `bytesUsed` — mirrors `DELETE /:id`'s own "best-effort immediate
   *      decrement so freed space is usable without waiting a day" rationale (that route's own
   *      comment), just in both directions here since a transfer, unlike a delete, has a second
   *      party who GAINS the freed space. `core/maintenance.ts`'s own quota chain recomputes
   *      every owner's total FROM SCRATCH each run, keyed off D1's `owner_id` (now already
   *      updated) — this step only closes the ≤24h staleness window early, it is not what makes
   *      re-attribution eventually-correct (that already falls out of the maintenance job's own
   *      from-scratch recompute, unconditionally).
   *   5. Event append second: `character.owner_transferred {toUserId}`, actor stamped from the
   *      SESSION-verified CURRENT owner (`EVENT_ACTORS['character.owner_transferred'] =
   *      ['dm', 'owner']`, `packages/protocol/src/events/character.ts` — 'owner' is genuinely
   *      granted here, not just 'dm'). `character-actor.ts`'s meta hook (commit ca50db0) applies
   *      the ownership change at the stream-meta level the moment this commits, and the owner
   *      backstop there is what then refuses the OLD owner's own further direct writes.
   */
  app.post('/:id/transfer', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await parseJsonBody<TransferBody>(c.req.raw);
    if (!body.toUserId) throw badRequest('toUserId is required');
    const toUserId = body.toUserId;

    const existing = await findCharacterById(deps.db, id);
    if (existing?.ownerId !== user.userId) throw notFound('Character not found');

    const targetUser = await findUserById(deps.db, toUserId);
    if (!targetUser) throw notFound('Unknown target user');

    if (toUserId !== existing.ownerId) {
      const targetCount = await countCharactersForOwner(deps.db, toUserId);
      if (targetCount >= USER_CHARACTER_COUNT_MAX) {
        throw limitExceeded(
          `Character limit reached: the recipient already has ${USER_CHARACTER_COUNT_MAX} characters`,
        );
      }
      const targetQuotaBytesUsed = await getUserQuotaBytes(deps.db, toUserId);
      if (targetQuotaBytesUsed >= USER_QUOTA_BYTES_MAX) {
        throw quotaExceeded(`Storage quota reached: the recipient is already at ${USER_QUOTA_BYTES_MAX} bytes`);
      }
    }

    const now = Date.now();
    const fromOwnerId = existing.ownerId;
    const transferredBytes = existing.bytesUsed;

    await updateCharacterOwner(deps.db, id, toUserId, now);
    await adjustUserQuotaBytes(deps.db, fromOwnerId, -transferredBytes);
    await adjustUserQuotaBytes(deps.db, toUserId, transferredBytes);

    const actor: Actor = { userId: fromOwnerId, role: 'owner' };
    const event: Event = {
      id: uuidv7(),
      stream: `char:${id}`,
      ts: new Date().toISOString(),
      actor: { userId: actor.userId, deviceId: 'api-route', role: actor.role },
      type: 'character.owner_transferred',
      v: 1,
      payload: { toUserId },
    };

    try {
      const result = await deps.streamHost.get(`char:${id}`).append([event], actor);
      if (result.lastSeq === 0) throw new Error('character transfer: owner_transferred was rejected');
    } catch (err) {
      // Best-effort D1 rollback — same posture as campaigns.ts's POST / (covers BOTH a clean
      // rejection and a thrown store fault).
      await updateCharacterOwner(deps.db, id, fromOwnerId, existing.updatedAt).catch(() => undefined);
      await adjustUserQuotaBytes(deps.db, toUserId, -transferredBytes).catch(() => undefined);
      await adjustUserQuotaBytes(deps.db, fromOwnerId, transferredBytes).catch(() => undefined);
      throw err instanceof Error ? err : new Error('character transfer: event append failed');
    }

    return c.body(null, 204);
  });

  return app;
}
