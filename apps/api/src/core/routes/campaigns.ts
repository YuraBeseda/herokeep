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
 * append this file makes is EXACTLY ONE event, and a genuinely committed event is always assigned
 * `seq >= 1` (`ports/stream.ts`'s `StreamStore.head` doc comment: "0 if empty"; every store starts
 * numbering at 1), `lastSeq === 0` is an unambiguous "this one event was rejected" signal without
 * needing a `ports/stream.ts` change — see `appendOne` below. Every event this file constructs is
 * pre-validated by a `@hk/protocol` schema before ever reaching `append`, so this path is expected
 * to be defense-in-depth, not the normal case.
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

function buildEvent(streamId: string, actor: Actor, type: string, v: number, payload: unknown): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: actor.userId, deviceId: 'api-route', role: actor.role },
    type,
    v,
    payload,
  };
}

/** Appends exactly one event and reports whether it was acked — see this file's header comment
 * ("StreamHandle.append's AppendResult limitation") for why `lastSeq !== 0` is the signal used. */
async function appendOne(streamHost: StreamHost, streamId: string, event: Event, actor: Actor): Promise<boolean> {
  const result = await streamHost.get(streamId).append([event], actor);
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
    // join code on a UNIQUE collision (`join-code.ts`'s documented caller contract).
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
        // join_code UNIQUE collision — retry with a freshly generated code.
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

    // Event append second (design ruling 3). `campaign.created` requires actor.role 'dm'
    // (CAMPAIGN_EVENT_ACTORS); `member.joined` requires actor.role 'member' — the STATIC
    // per-type actor table (`campaign-permissions.ts`) is checked per `append()` CALL against one
    // shared `actor`, so these cannot be combined into a single append() batch with one actor.
    // The DM bootstraps their OWN membership row on the campaign stream by authoring
    // `member.joined` in the 'member' CAPACITY (self-binding: payload.userId === actor.userId,
    // `campaign-actor.ts`'s `refineAppendPermission`) — the same self-service action any other
    // joining user takes, just for the campaign's creator. This is what makes the DM show up in
    // `CampaignActor`'s own `meta.members` (task-5-report.md's carried finding: without this,
    // presence's DM entry has no real displayName source).
    const streamId = `camp:${body.id}`;
    const dmActor: Actor = { userId: user.userId, role: 'dm' };
    const memberActor: Actor = { userId: user.userId, role: 'member' };
    const createdEvent = buildEvent(streamId, dmActor, 'campaign.created', 1, payloadCheck.data);
    const createdAcked = await appendOne(deps.streamHost, streamId, createdEvent, dmActor);
    const joinedEvent = buildEvent(streamId, memberActor, 'member.joined', 1, {
      userId: user.userId,
      displayName,
      role: 'dm',
    });
    const joinedAcked = createdAcked ? await appendOne(deps.streamHost, streamId, joinedEvent, memberActor) : false;

    if (!createdAcked || !joinedAcked) {
      // Best-effort D1 rollback (design ruling 3: "D1 first, event append second, best-effort D1
      // rollback on append failure"): the D1 rows describe a campaign whose own stream never
      // actually recorded it — undo them rather than leave a D1-only "ghost" campaign.
      await removeMembership(deps.db, body.id, user.userId).catch(() => undefined);
      await deleteCampaignIndexRow(deps.db, body.id).catch(() => undefined);
      throw new Error('campaign create: campaign.created/member.joined event(s) were rejected');
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
    const acked = await appendOne(deps.streamHost, streamId, event, actor);
    if (!acked) {
      await removeMembership(deps.db, campaign.id, user.userId).catch(() => undefined);
      throw new Error('campaign join: member.joined event was rejected');
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
    const acked = await appendOne(deps.streamHost, streamId, event, actor);
    if (!acked) {
      // Best-effort D1 rollback: restore the OLD code so D1 and the stream stay consistent.
      await rotateJoinCode(deps.db, id, campaign.joinCode).catch(() => undefined);
      throw new Error('rotate-code: campaign.join_code_rotated event was rejected');
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
    const acked = await appendOne(deps.streamHost, streamId, event, actor);
    if (!acked) {
      await insertMembership(deps.db, membership).catch(() => undefined);
      throw new Error('member removal: member.removed event was rejected');
    }

    // T9 hook (bye emission, plan-9 Task 9): the removed member's LIVE campaign sockets should be
    // closed with a `bye` frame here — the actor-side close/socket surface
    // (`CampaignActor.onConnectionClosed`) exists, but the "find this user's live connections on
    // THIS campaign stream and bye-close them" wiring is Task 9's job (plan-9's Global
    // Constraints: "removed from campaign closes that member's sockets with bye"), not built yet.

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
