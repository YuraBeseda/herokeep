/**
 * [plan-16 Task 1] Campaign pack BODY relay — ADR-008: "a campaign's DO stores the JSON of every
 * non-core pack it has enabled (≤ 5 MB each) so joiners can fetch them without the DM online".
 *
 * - `PUT /api/campaigns/:campaignId/packs/:packId/:version` — the DM only. The body is the pack's
 *   canonical JSON (≤ `CAMPAIGN_PACK_BYTES_MAX`): it must pass the STRICT `parsePack`, name the
 *   URL's id/version, and equal `canonicalJson(parsed)` byte for byte (sorted keys, no whitespace,
 *   every schema default spelled out — the form `pack-tools build` and the web client store) and
 *   be `kind: content` (the only kind a member installs). 409 `quota_exceeded` when the campaign
 *   already has the maximum of distinct enabled packs and this is a new `packId`, or when the
 *   body would push the campaign's stored total past its cap (`CampaignActor.putPackBody`). The
 *   answer is `{ sha256 }`, bare hex over the exact received bytes: the value a later
 *   `pack.enabled@1` must carry (`CampaignActor.refusePackEnabled` checks it against this body).
 * - `GET` on the same path — any member. `ETag: "<sha256>"`; a matching `If-None-Match` is a 304.
 *
 * The body goes to the campaign stream's OWN `StreamStore` through `StreamHandle.putPack/getPack`
 * (the same store instance the actor verifies against — a DO RPC on Cloudflare, a direct call on
 * Node). One version per `packId`: a new version replaces the old body. Pack ASSETS are never
 * stored here (they travel over the blob relay).
 *
 * ## Why a separate sub-app, mounted BEFORE `createCampaignRoutes`
 * `createCampaignRoutes` applies a 64 KB `bodyLimit` to every `/api/campaigns/*` request. Hono runs
 * matching handlers in registration order and stops at the first one that answers, so this
 * sub-app — registered first, with its own 5 MiB limit on the PUT — answers pack requests before
 * the campaigns sub-app's middleware ever runs (`core/app.ts`).
 *
 * ## Order inside the PUT: nothing is buffered before auth and the DM check (fix round 1)
 * XRW gate → `requireAuth` → DM check + path validation → `bodyLimit` → handler. `bodyLimit` reads
 * a chunked body (no Content-Length) in full, up to the limit, before calling `next()`; running
 * it last means only the authenticated DM can make the server hold up to 5 MiB.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { PackIdSchema, SemverSchema, parsePack } from '@hk/protocol';
import { requireAuth, type AuthEnv } from '../auth/middleware.ts';
import { requireXRequestedWith } from '../http/xrw-gate.ts';
import { installErrorHandler } from '../http/error-handler.ts';
import { badRequest, forbidden, notFound, quotaExceeded } from '../errors.ts';
import { sha256Hex } from '../crypto.ts';
import { CAMPAIGN_PACK_BYTES_MAX } from '../quotas.ts';
import { findCampaignById, findMembership } from '../db/queries.ts';
import type { CampaignsDeps } from './campaigns.ts';

/** Sorted-key `JSON.stringify` — a twin of `@hk/pack-tools`'s `canonicalJson` (and the web
 * client's `canonical-json.ts`): `core` may import only ports and `@hk/protocol`. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const record = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, sortKeys(record[k])]),
    );
  }
  return v;
}

/** RFC 9110 §13.1.2 `If-None-Match` (weak comparison): `*`, or any listed tag — `W/` or not —
 * equal to `etag`. */
function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((raw) => {
    const tag = raw.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  });
}

function streamIdFor(campaignId: string): string {
  return `camp:${campaignId}`;
}

function assertPackPath(packId: string, version: string): void {
  if (!PackIdSchema.safeParse(packId).success) throw badRequest('Malformed pack id');
  if (!SemverSchema.safeParse(version).success) throw badRequest('Malformed pack version');
}

export function createCampaignPackRoutes(deps: CampaignsDeps) {
  const app = new Hono<AuthEnv>();
  installErrorHandler(app);

  // Header-only gates first: neither reads the body.
  app.use('/:campaignId/packs/*', requireXRequestedWith());
  app.use('/:campaignId/packs/*', requireAuth(deps));

  /** [fix round 1] The PUT's DM check and path validation, as middleware that runs BEFORE the body
   * limit below. Hono's `bodyLimit` reads a body that has no Content-Length (a chunked upload) in
   * full, up to `maxSize`, before it calls `next()` — so it must come after these checks, or any
   * caller (even unauthenticated) could make the server buffer up to 5 MiB per request. */
  const requireDmUpload: MiddlewareHandler<AuthEnv> = async (c, next) => {
    // The D1 index row's `dmId` — the authority every DM-only campaign route uses (written with
    // the same `campaign.created` the stream's `meta.dmId` comes from). An unknown campaign gets
    // the same 403 as a non-DM, never revealing whether the id exists.
    const campaign = await findCampaignById(deps.db, c.req.param('campaignId') ?? '');
    if (campaign?.dmId !== c.get('user').userId) throw forbidden('Only the campaign DM may upload pack bodies');
    assertPackPath(c.req.param('packId') ?? '', c.req.param('version') ?? '');
    await next();
  };

  const packBodyLimit = bodyLimit({
    maxSize: CAMPAIGN_PACK_BYTES_MAX,
    onError: (c) => c.json({ error: 'payload_too_large', message: 'Pack body too large' }, 413),
  });

  app.put('/:campaignId/packs/:packId/:version', requireDmUpload, packBodyLimit, async (c) => {
    const campaignId = c.req.param('campaignId');
    const packId = c.req.param('packId');
    const version = c.req.param('version');

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    let text: string;
    try {
      // `fatal` refuses invalid UTF-8; `ignoreBOM` KEEPS a BOM (so `JSON.parse` refuses it) —
      // either way, the stored text re-encodes to exactly the bytes hashed below.
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw badRequest('Pack body is not valid UTF-8');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest('Pack body is not valid JSON');
    }
    const parsed = parsePack(raw);
    if (!parsed.ok) {
      const first = parsed.issues[0];
      throw badRequest(`Pack body fails the pack schema${first ? ` at ${first.path}: ${first.message}` : ''}`);
    }
    if (parsed.pack.id !== packId || parsed.pack.version !== version) {
      throw badRequest('Pack body id/version does not match the URL');
    }
    // [final fix wave, F3] The member-side rule (`parseExternalPack` in the web client): only a
    // `content` pack can be installed from a campaign, so no other kind is stored.
    if (parsed.pack.kind !== 'content') throw badRequest('Only content packs can be enabled for a campaign');
    if (canonicalJson(parsed.pack) !== text) {
      throw badRequest('Pack body must be canonical JSON (sorted keys, no whitespace, defaults spelled out)');
    }

    const sha256 = await sha256Hex(bytes);
    const outcome = await deps.streamHost.get(streamIdFor(campaignId)).putPack(packId, version, text);
    if (outcome === 'quota_exceeded')
      throw quotaExceeded('Campaign pack limit reached (distinct packs or total storage)');
    return c.json({ sha256 }, 200);
  });

  app.get('/:campaignId/packs/:packId/:version', async (c) => {
    const user = c.get('user');
    const campaignId = c.req.param('campaignId');
    const packId = c.req.param('packId');
    const version = c.req.param('version');

    const membership = await findMembership(deps.db, campaignId, user.userId);
    if (!membership) throw forbidden('Not a member of this campaign');
    assertPackPath(packId, version);

    const stored = await deps.streamHost.get(streamIdFor(campaignId)).getPack(packId);
    if (stored?.version !== version) throw notFound('Pack body not found');

    const etag = `"${await sha256Hex(stored.json)}"`;
    if (ifNoneMatchHits(c.req.header('If-None-Match'), etag)) return c.body(null, 304, { ETag: etag });
    return c.body(stored.json, 200, { 'Content-Type': 'application/json; charset=utf-8', ETag: etag });
  });

  return app;
}
