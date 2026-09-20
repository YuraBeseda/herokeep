/** `/api/campaigns/*` (task-4-brief; plan-9's Global Constraints ROUTES bullet + design rulings
 * 1-3). Every route requires a valid session (`requireAuth`, same as `characters.ts`/`me.ts`);
 * campaign/membership rows in D1 are this file's OWN ownership/membership authority (mirrors
 * `characters.ts`'s header-comment stance: D1 is the index this file writes and reads, not a
 * stream-meta read-through) — routes emit events through the REAL `CampaignActor` (via
 * `StreamHost`) so the campaign stream's own event-sourced truth (`dmId`, `settings`,
 * `meta.members`, ...) is established the same way a live WS `append` would establish it,
 * per design ruling 3.
 *
 * ## corePack source (task-4-brief: "decide + document")
 *
 * `campaign.created`'s payload requires `corePack: {id, version}` (doc-02's catalog row). The
 * core boundary rule (`apps/api/src/core/**` imports only ports + `@hk/protocol`) rules out
 * importing `@hk/content`'s `PACK_ID`/`PACK_VERSION` directly — and even if that boundary didn't
 * exist, hardcoding a literal here would be exactly the invented-constant failure mode the brief
 * warns against: `apps/api/scripts/seed-api.ts`'s OWN hardcoded `{id: 'srd-5e-2024', version:
 * '1.0.0'}` already disagrees with `@hk/content`'s real `PACK_VERSION` (`'0.1.0'`) as of this
 * writing — a live example of a hand-copied version drifting from the truth. doc-02's
 * `character.created` row (`{name, system, corePack: {id, version}, ...}`, "first event; pins the
 * core pack") establishes the ONLY precedent this catalog has for where a `corePack` value comes
 * from: the CREATING DEVICE names it, because campaigns (like characters) are meant to support
 * more than one system/pack version over time (ADR-004: "5e-2024; 5e-2014 later") and only the
 * client (which imports `@hk/content` directly, `apps/web`) actually knows which pack id/version
 * it's building against for a given system choice. This route therefore accepts `corePack` in the
 * POST body, validated by SHAPE against the exact same `CampaignCreatedV1` schema
 * `CampaignActor.append`'s own pipeline will re-validate — the server is not the authority on
 * which pack versions exist, matching `character.created`'s own precedent exactly.
 *
 * ## displayName default (task-4-brief: "decide from ADR-004/doc-02")
 *
 * `memberships.display_name` (D1, `schema.ts`) and `member.joined`'s payload both require a
 * display name. Neither ADR-004 nor doc-02 states a default; this route accepts an optional
 * `displayName` field in the create/join request bodies and falls back to the account's
 * `users.username` (via `findUserById`) — the only per-user display label the accounts DB
 * already has — falling back further to the raw `userId` only in the defensive case a session
 * names a user row that has since vanished (should be unreachable in practice, mirrors
 * `me.ts`'s own "defensive only" stance on that same case).
 *
 * ## StreamHandle.append's AppendResult limitation (a finding worth flagging up front)
 *
 * `ports/stream.ts`'s `StreamHandle.append` returns only `{firstSeq, lastSeq}` (`AppendResult`) —
 * not `StreamActor`'s own richer `AppendOutcome` (`{acked, rejected}`), which is adapter-internal
 * (`NodeStreamHost.getRuntime`, used by `scripts/seed-api.ts`'s own fail-loud append). Since every
 * append this file makes is either ONE event or a SINGLE-`txId` all-or-nothing batch (see the next
 * section), and a genuinely committed event is always assigned `seq >= 1` (`ports/stream.ts`'s
 * `StreamStore.head` doc comment: "0 if empty"; every store starts numbering at 1), `lastSeq === 0`
 * is an unambiguous "nothing in this call was acked" signal without needing a `ports/stream.ts`
 * change — see `appendEvents` below. Every event this file constructs is pre-validated by a
 * `@hk/protocol` schema before ever reaching `append`, so a clean REJECTION is expected to be
 * defense-in-depth, not the normal case.
 *
 * ## Atomic campaign bootstrap (fix round 1, [Important] 1 — a real, fixed brick)
 *
 * `POST /` originally appended `campaign.created` and the DM's own bootstrap `member.joined` as
 * TWO separate `append()` calls, because the static per-type actor table
 * (`CAMPAIGN_EVENT_ACTORS`) required a DIFFERENT `actor.role` for each ('dm' vs 'member') and one
 * `append()` call takes exactly one `actor` for its whole batch. That shape had a real, fixed
 * brick: if `campaign.created` committed but the second call then threw/rejected, the CAMPAIGN
 * STREAM was left with `meta.dmId` permanently set (from the first, successfully committed event)
 * while D1's rows were rolled back — and `campaign-actor.ts`'s `refineAppendPermission` rejects
 * EVERY subsequent `campaign.created` once `meta.dmId` is set (Task 5's fix-round-1 "no
 * re-creation" guard), so a retry of the SAME id could never succeed again. The id was permanently
 * unrecoverable.
 *
 * Fix: the controller sanctioned widening `CAMPAIGN_EVENT_ACTORS['member.joined']` to
 * `['member', 'dm']` (`packages/protocol/src/events/campaign.ts`) — the DM's client may now author
 * `member.joined` about THEMSELVES directly (the actor-level self-binding guard,
 * `campaign-actor.ts`'s `refineAppendPermission`: `payload.userId === actor.userId`, no role
 * exemption, is what still prevents anyone admitting someone ELSE this way). This lets both events
 * be appended in ONE `append()` call, stamped `{role: 'dm'}` throughout, sharing one freshly
 * generated `txId` — `StreamActor.append`'s own txId-group semantics (doc-03 §Ordering: "txId
 * groups commit contiguously or reject ALL", `stream-actor.ts`'s `resolveTxGroups`) make the pair
 * atomic: either BOTH commit in the store's own single transaction, or NEITHER does. There is no
 * longer a window where one half can commit without the other, so the brick above cannot recur;
 * the best-effort D1 rollback below is now a genuine "undo the D1-only half" step, never a
 * "half-bootstrapped stream" cleanup.
 *
 * ## Thrown appends (fix round 1, [Important] 2)
 *
 * `appendEvents` does not itself catch a THROWN store fault (a real adapter's `append` can reject
 * its underlying transaction and throw, not just return an outcome with nothing acked) — every
 * call site below wraps its own append+rollback in a `try/catch` so a THROW gets the exact same
 * best-effort D1 rollback a clean "nothing acked" rejection gets, then rethrows (mapped to a 500
 * by `installErrorHandler`, since it is never a client-caused `ApiError`).
 *
 * ## Join-code retry loop: id-collision vs join-code collision (fix round 1, [Important] 3)
 *
 * `POST /`'s create-row retry loop generates a fresh join code on every `createCampaign` failure,
 * assuming the failure is always a `join_code` UNIQUE collision (`join-code.ts`'s documented
 * caller contract). But `campaigns.id` is ALSO a unique/primary key — a genuine race (two
 * concurrent creates for the SAME id, after this route's own top-of-handler `existing` check
 * already missed each other) throws for a completely different reason a fresh join code can never
 * fix, and blindly retrying would exhaust `MAX_JOIN_CODE_ATTEMPTS` and surface a misleading 500
 * ("exhausted join code generation attempts") instead of the honest 409/200 the top-of-handler
 * check would have given if it had run a moment later. Rather than parsing the underlying driver's
 * constraint-error text (better-sqlite3 vs D1 phrase it differently, and doing so would couple this
 * route to a specific driver's error shape), the catch block RE-CHECKS `findCampaignById` on every
 * failure: if the row now exists, this is the id-collision case — handled with the exact same
 * idempotent-200/conflict-409 logic the top-of-handler `existing` check already uses. Only when
 * `findCampaignById` still finds nothing is the failure assumed to be a `join_code` collision and
 * the loop retries with a freshly generated code.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CampaignCreatedV1, MemberDisplayNameSchema, type Actor, type Event } from '@hk/protocol';
import type { AuthDeps } from '../auth/types.ts';
import { requireAuth, type AuthEnv } from '../auth/middleware.ts';
import type { StreamHost } from '../../ports/stream.ts';
import type { WsUpgrade } from '../../ports/infra.ts';
import { requireXRequestedWith } from '../http/xrw-gate.ts';
import { installErrorHandler } from '../http/error-handler.ts';
import { badRequest, conflict, forbidden, limitExceeded, notFound } from '../errors.ts';
import { CAMPAIGN_MEMBER_MAX } from '../quotas.ts';
import { uuidv7 } from '../ids.ts';
import { generateJoinCode } from '../db/join-code.ts';
import {
  type Campaign,
  createCampaign,
  deleteCampaignIndexRow,
  findCampaignById,
  findCampaignByJoinCode,
  findMembership,
  findUserById,
  countMembers,
  insertMembership,
  listCampaignsForUser,
  removeMembership,
  rotateJoinCode,
} from '../db/queries.ts';

/** [plan-9 Task 9] `StreamHandle.closeConnectionsForUser`'s `reason` for a DM-initiated removal —
 * localizer-key style, matching `notice.key`'s existing convention (`quota.warning`,
 * `blob.resend-have`). `ByeMsgSchema.reason` (`@hk/protocol`) is a free-form
 * `z.string().min(1)`, not an enum, so this is a plain exported string constant rather than a
 * schema addition — `stream-actor.ts`'s `byeCloseUser` doc comment has the full session-expiry-
 * trigger survey this is the one real (member-removal) trigger for. */
export const BYE_REASON_MEMBER_REMOVED = 'campaign.member_removed';

const BODY_LIMIT_BYTES = 64 * 1024; // ADR-012 exact value (same cap every route in this app uses)
/** Astronomically generous relative to the 30^8 (~6.6e11) join-code space (`join-code.ts`'s own
 * doc comment) — a real collision run this long would indicate a bug, not bad luck. */
const MAX_JOIN_CODE_ATTEMPTS = 5;
/** `MemberDisplayNameSchema`'s own bound (`packages/protocol/src/events/campaign.ts`). */
const MAX_DISPLAY_NAME_LENGTH = 128;

export interface CampaignsDeps extends AuthDeps {
  readonly streamHost: StreamHost;
  readonly wsUpgrade: WsUpgrade;
}

interface CampaignDto {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly role: 'dm' | 'player';
  /** DM-only (task-4-brief: "never leak joinCode to members; document") — omitted entirely
   * (not `null`/empty-string) for a member's own view of a campaign they don't DM. */
  readonly joinCode?: string;
}

/** GET /'s minimal DTO (task-4-brief: "keep minimal: id, name, system, role, joinCode only for
 * the DM"). `role` is derived from `campaigns.dmId` rather than a second `memberships` read —
 * design ruling 1 keeps the DM's own `memberships.role` row in sync with `campaigns.dmId` as
 * `'dm'` (this file's create route inserts it that way), so the two never disagree in practice. */
function toCampaignDto(row: Campaign, userId: string): CampaignDto {
  const role: 'dm' | 'player' = row.dmId === userId ? 'dm' : 'player';
  return role === 'dm'
    ? { id: row.id, name: row.name, system: row.system, role, joinCode: row.joinCode }
    : { id: row.id, name: row.name, system: row.system, role };
}

async function parseJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest('Invalid JSON body');
  }
}

/** This file's header-comment displayName decision: `requested` (the optional client-supplied
 * field) wins if non-empty after trimming; otherwise the account's `username`; otherwise (should
 * be unreachable) the raw `userId`. Always returns a `MemberDisplayNameSchema`-valid string
 * (1..128 chars) — truncating an unusually long fallback rather than failing the whole request
 * over a display label, since `userId`/`username` are never empty for an authenticated session. */
function normalizeDisplayName(requested: unknown, fallbackUsername: string | undefined, userId: string): string {
  const trimmed = typeof requested === 'string' ? requested.trim() : '';
  const candidate = trimmed.length > 0 ? trimmed : (fallbackUsername ?? userId);
  const parsed = MemberDisplayNameSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const truncated = candidate.slice(0, MAX_DISPLAY_NAME_LENGTH);
  return truncated.length > 0 ? truncated : userId.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function buildEvent(streamId: string, actor: Actor, type: string, v: number, payload: unknown, txId?: string): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: actor.userId, deviceId: 'api-route', role: actor.role },
    type,
    v,
    payload,
    ...(txId !== undefined ? { txId } : {}),
  };
}

/** Appends one or more events (share ONE `txId` across `events` for an atomic all-or-nothing
 * commit — see this file's header comment, "Atomic campaign bootstrap") and reports whether
 * EVERY event in the call was acked. Does NOT catch a thrown store fault — see the header
 * comment's "Thrown appends" section; every call site wraps its own append in a `try/catch`. */
async function appendEvents(streamHost: StreamHost, streamId: string, events: Event[], actor: Actor): Promise<boolean> {
  const result = await streamHost.get(streamId).append(events, actor);
  return result.lastSeq !== 0;
}

export function createCampaignRoutes(deps: CampaignsDeps) {
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

  interface CreateBody {
    readonly id?: string;
    readonly name?: string;
    readonly system?: string;
    readonly corePack?: { readonly id?: string; readonly version?: string };
    readonly displayName?: string;
  }

  app.post('/', async (c) => {
    const user = c.get('user');
    const body = await parseJsonBody<CreateBody>(c.req.raw);
    if (!body.id || !body.name || !body.system) throw badRequest('id, name and system are required');

    // Idempotent-create, mirrors `characters.ts`'s own create route exactly (same id already
    // registered to THIS user is a harmless retry; a different owner is a real collision).
    const existing = await findCampaignById(deps.db, body.id);
    if (existing) {
      if (existing.dmId !== user.userId) throw conflict('Campaign id already in use');
      return c.json(toCampaignDto(existing, user.userId), 200);
    }

    // Full `campaign.created` payload shape check (name/system/corePack), via the SAME protocol
    // schema `CampaignActor.append`'s pipeline re-validates — see this file's header comment for
    // why `corePack` is client-supplied rather than invented/imported here.
    const payloadCheck = CampaignCreatedV1.safeParse({ name: body.name, system: body.system, corePack: body.corePack });
    if (!payloadCheck.success) {
      throw badRequest(`Invalid campaign shape: ${payloadCheck.error.issues.map((i) => i.message).join('; ')}`);
    }

    const userRow = await findUserById(deps.db, user.userId);
    const displayName = normalizeDisplayName(body.displayName, userRow?.username, user.userId);
    const now = Date.now();

    // D1 first (design ruling 3): the campaign row + the DM's own membership row, retrying the
    // join code on a UNIQUE collision — but see this file's header comment ("Join-code retry
    // loop: id-collision vs join-code collision") for why a failure here is RE-CHECKED against
    // `findCampaignById` before assuming it's a join-code collision worth retrying.
    let created: Campaign | undefined;
    let joinCode: string | undefined;
    for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS && !created; attempt += 1) {
      const candidate = generateJoinCode();
      try {
        created = await createCampaign(deps.db, {
          id: body.id,
          dmId: user.userId,
          name: payloadCheck.data.name,
          system: payloadCheck.data.system,
          joinCode: candidate,
          joinOpen: true,
          bytesUsed: 0,
          updatedAt: now,
        });
        joinCode = candidate;
      } catch {
        const raced = await findCampaignById(deps.db, body.id);
        if (raced) {
          // A concurrent request won the race for this exact id between this handler's own
          // top-of-route `existing` check and this insert — resolve it with the SAME
          // idempotent-200/conflict-409 logic that check already applies, rather than burning
          // through every remaining attempt on an error no join code can fix.
          if (raced.dmId !== user.userId) throw conflict('Campaign id already in use');
          return c.json(toCampaignDto(raced, user.userId), 200);
        }
        // No row exists for this id yet — the failure was a join_code UNIQUE collision instead;
        // retry with a freshly generated code.
      }
    }
    if (!created || !joinCode) {
      throw new Error('campaign create: exhausted join code generation attempts');
    }
    await insertMembership(deps.db, {
      campaignId: body.id,
      userId: user.userId,
      role: 'dm',
      displayName,
      joinedAt: now,
    });

    // Event append second (design ruling 3), as ONE atomic txId batch — see this file's header
    // comment ("Atomic campaign bootstrap") for why `campaign.created` and the DM's own bootstrap
    // `member.joined` are appended together, both stamped `{role: 'dm'}`, rather than as two
    // separate append() calls. This is what makes the DM show up in `CampaignActor`'s own
    // `meta.members` (task-5-report.md's carried finding: without it, presence's DM entry has no
    // real displayName source).
    const streamId = `camp:${body.id}`;
    const dmActor: Actor = { userId: user.userId, role: 'dm' };
    const bootstrapTxId = uuidv7();
    const createdEvent = buildEvent(streamId, dmActor, 'campaign.created', 1, payloadCheck.data, bootstrapTxId);
    const joinedEvent = buildEvent(
      streamId,
      dmActor,
      'member.joined',
      1,
      { userId: user.userId, displayName, role: 'dm' },
      bootstrapTxId,
    );

    try {
      const acked = await appendEvents(deps.streamHost, streamId, [createdEvent, joinedEvent], dmActor);
      if (!acked) throw new Error('campaign create: campaign.created/member.joined batch was rejected');
    } catch (err) {
      // Best-effort D1 rollback (design ruling 3: "D1 first, event append second, best-effort D1
      // rollback on append failure"), covering BOTH a clean rejection and a thrown store fault
      // (fix round 1, [Important] 2) — the D1 rows describe a campaign whose own stream never
      // actually recorded it (the txId batch is atomic, so this is always "neither committed",
      // never a half-bootstrapped stream) — undo them rather than leave a D1-only "ghost" campaign.
      await removeMembership(deps.db, body.id, user.userId).catch(() => undefined);
      await deleteCampaignIndexRow(deps.db, body.id).catch(() => undefined);
      throw err instanceof Error ? err : new Error('campaign create: event batch append failed');
    }

    return c.json(toCampaignDto(created, user.userId), 201);
  });

  app.get('/', async (c) => {
    const user = c.get('user');
    const rows = await listCampaignsForUser(deps.db, user.userId);
    return c.json(rows.map((row) => toCampaignDto(row, user.userId)));
  });

  interface JoinBody {
    readonly code?: string;
    readonly displayName?: string;
  }

  app.post('/join', async (c) => {
    const user = c.get('user');
    const body = await parseJsonBody<JoinBody>(c.req.raw);
    if (!body.code) throw badRequest('code is required');

    // Normalize the display (possibly dash-grouped) form back to the bare stored form
    // (`join-code.ts`'s doc comment: "stored RAW with no separator").
    const normalizedCode = body.code
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');
    const campaign = await findCampaignByJoinCode(deps.db, normalizedCode);
    if (!campaign) throw notFound('Invalid join code');

    // Duplicate-membership idempotency (task-4-brief: "rejoin -> 200 with existing") — checked
    // BEFORE the join.open/quota gates, so an already-established member can always re-fetch
    // their own campaignId even if the DM later closed the campaign or it's since filled up.
    const existingMembership = await findMembership(deps.db, campaign.id, user.userId);
    if (existingMembership) return c.json({ campaignId: campaign.id }, 200);

    // join.open gate (ADR-004/doc-08's join gate: "code + open + quota" — ADR-004 read together
    // with doc-08's "Join by code" row; the client-side pack/system COMPATIBILITY report is
    // explicitly NOT a server-side gate here).
    if (!campaign.joinOpen) throw forbidden('This campaign is not open for joining');

    // 12-member quota — THIS route is the PRIMARY gate (plan-9's Global Constraints; the actor's
    // own member-count check, `campaign-actor.ts`, is defense-in-depth behind this one).
    const memberCount = await countMembers(deps.db, campaign.id);
    if (memberCount >= CAMPAIGN_MEMBER_MAX) {
      throw limitExceeded(`Campaign is full: ${CAMPAIGN_MEMBER_MAX} members max`);
    }

    const userRow = await findUserById(deps.db, user.userId);
    const displayName = normalizeDisplayName(body.displayName, userRow?.username, user.userId);
    const now = Date.now();

    await insertMembership(deps.db, {
      campaignId: campaign.id,
      userId: user.userId,
      role: 'player',
      displayName,
      joinedAt: now,
    });

    const streamId = `camp:${campaign.id}`;
    const actor: Actor = { userId: user.userId, role: 'member' };
    const event = buildEvent(streamId, actor, 'member.joined', 1, { userId: user.userId, displayName, role: 'player' });
    try {
      const acked = await appendEvents(deps.streamHost, streamId, [event], actor);
      if (!acked) throw new Error('campaign join: member.joined event was rejected');
    } catch (err) {
      // Fix round 1, [Important] 2: a THROWN append (not just a clean rejection) gets the same
      // best-effort D1 rollback.
      await removeMembership(deps.db, campaign.id, user.userId).catch(() => undefined);
      throw err instanceof Error ? err : new Error('campaign join: member.joined append failed');
    }

    return c.json({ campaignId: campaign.id }, 200);
  });

  app.post('/:id/rotate-code', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const campaign = await findCampaignById(deps.db, id);
    if (!campaign) throw notFound('Campaign not found');
    if (campaign.dmId !== user.userId) throw forbidden('Only the DM may rotate the join code');

    let newCode: string | undefined;
    for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS && !newCode; attempt += 1) {
      const candidate = generateJoinCode();
      try {
        await rotateJoinCode(deps.db, id, candidate);
        newCode = candidate;
      } catch {
        // join_code UNIQUE collision — retry with a freshly generated code.
      }
    }
    if (!newCode) throw new Error('rotate-code: exhausted join code generation attempts');

    const streamId = `camp:${id}`;
    const actor: Actor = { userId: user.userId, role: 'dm' };
    const event = buildEvent(streamId, actor, 'campaign.join_code_rotated', 1, { joinCode: newCode });
    try {
      const acked = await appendEvents(deps.streamHost, streamId, [event], actor);
      if (!acked) throw new Error('rotate-code: campaign.join_code_rotated event was rejected');
    } catch (err) {
      // Fix round 1, [Important] 2: a THROWN append also restores the OLD code, same as a clean
      // rejection, so D1 and the stream stay consistent.
      await rotateJoinCode(deps.db, id, campaign.joinCode).catch(() => undefined);
      throw err instanceof Error ? err : new Error('rotate-code: campaign.join_code_rotated append failed');
    }

    return c.json({ joinCode: newCode }, 200);
  });

  app.delete('/:id/members/:userId', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const targetUserId = c.req.param('userId');
    const campaign = await findCampaignById(deps.db, id);
    if (!campaign) throw notFound('Campaign not found');
    if (campaign.dmId !== user.userId) throw forbidden('Only the DM may remove a member');
    // Task-4-brief: "the DM removing themselves — reject with a clear error". A DM leaving their
    // own campaign is not "removal" (there is no `campaign.archived`/DM-handoff flow in this
    // plan's scope) — reject outright rather than silently orphaning the campaign's own dmId.
    if (targetUserId === user.userId) throw badRequest('The DM cannot remove themselves from their own campaign');

    const membership = await findMembership(deps.db, id, targetUserId);
    if (!membership) throw notFound('Member not found');
    const removed = await removeMembership(deps.db, id, targetUserId);
    if (!removed) throw notFound('Member not found');

    const streamId = `camp:${id}`;
    const actor: Actor = { userId: user.userId, role: 'dm' };
    const event = buildEvent(streamId, actor, 'member.removed', 1, {
      userId: targetUserId,
      displayName: membership.displayName,
      role: membership.role,
    });
    try {
      const acked = await appendEvents(deps.streamHost, streamId, [event], actor);
      if (!acked) throw new Error('member removal: member.removed event was rejected');
    } catch (err) {
      // Fix round 1, [Important] 2: a THROWN append also re-inserts the membership row, same as
      // a clean rejection.
      await insertMembership(deps.db, membership).catch(() => undefined);
      throw err instanceof Error ? err : new Error('member removal: member.removed append failed');
    }

    // [plan-9 Task 9] bye-close the removed member's LIVE campaign sockets (doc-03/Global
    // Constraints: "removed from campaign closes that member's sockets with bye"). Best-effort,
    // same stance as this route's other post-append cleanup calls above (`.catch(() => undefined)`
    // — the removal itself already fully committed: D1 row gone, `member.removed` acked; a
    // transport-level hiccup closing an ALREADY-logically-removed socket must not turn a
    // successful removal into a 500). `closeConnectionsForUser` is a no-op if the removed user
    // has no live connection on this stream right now (the ordinary case).
    await deps.streamHost
      .get(streamId)
      .closeConnectionsForUser(targetUserId, BYE_REASON_MEMBER_REMOVED)
      .catch(() => undefined);

    return c.body(null, 204);
  });

  app.get('/:id/ws', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    // Membership is this route's ownership authority (mirrors `characters.ts`'s D1-is-authority
    // stance) — a non-member (including a stranger to an unknown/nonexistent campaign id) gets
    // the SAME 403, never leaking whether the campaign id itself exists.
    const membership = await findMembership(deps.db, id, user.userId);
    if (!membership) throw forbidden('Not a member of this campaign');

    const origin = c.req.header('Origin');
    if (origin !== deps.config.get('APP_ORIGIN')) {
      throw forbidden('Origin does not match the app origin');
    }

    // Design ruling 1: campaign-socket role = 'dm' if memberships.role === 'dm', else 'member'.
    const role: 'dm' | 'member' = membership.role === 'dm' ? 'dm' : 'member';
    return deps.wsUpgrade.upgrade(c.req.raw, {
      streamId: `camp:${id}`,
      userId: user.userId,
      role,
      displayName: membership.displayName,
    });
  });

  return app;
}
