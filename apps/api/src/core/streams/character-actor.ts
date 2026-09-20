/**
 * `CharacterActor` — wraps `StreamActor` with the character-specific `meta` doc-10 §CharacterActor
 * names (`ownerId`, `campaignId?`, `pins`, `archived`) and Phase 2's owner-only entry rule
 * (doc-03 §Permission enforcement: "Direct solo sockets only allow the owner role").
 *
 * Meta is `getMeta`/`setMeta`-backed (task-6-brief) via the SAME `StreamStore.getMeta`/`setMeta`
 * `StreamActor` already uses for `bytes_used`/`event_count` — a second small key/value namespace
 * on the one store already scoped to this stream, not a new port surface. Values are written by
 * this actor itself, driven by the DOMAIN EVENTS that establish them (doc-02's event catalog),
 * rather than by an external caller reaching in and setting fields directly:
 *
 *   - `ownerId` is set from the SESSION-VERIFIED `actor.userId` (never the client-sent event's
 *     own `actor` field — see `StreamActor.stampActor`'s doc comment on why) the moment a
 *     `character.created` event commits — doc-02: "first event". No separate "register
 *     ownership on the stream" call is needed from `core/routes/characters.ts`'s create route:
 *     that route's OWN job is the D1 index row (`characters.owner_id`, used for every ownership
 *     check doc-10 names as "Db" — the WS handoff, archive, delete routes all check D1, never
 *     this meta), so each store's `ownerId` copy has exactly one writer: D1's is `POST
 *     /api/characters` (`core/routes/characters.ts`), the stream's own is this hook.
 *   - `archived` is set from `character.archived`/`character.restored` committing, mirroring
 *     `ownerId`'s pattern. `POST /api/characters/:id/archive` (Task 6) is, symmetrically, a pure
 *     D1-index write (`characters.archived_at`) — see that route's doc comment for the full
 *     archived-is-cosmetic finding this mirrors structurally. This meta field exists because
 *     doc-10 names it as part of `CharacterActor`'s shape and a future phase may want the actor
 *     itself to know its own archived state without a D1 round-trip (e.g. Cloudflare's DO acting
 *     on a stale/unsynced D1 read); nothing in Phase 2 branches on it.
 *   - `campaignId`/`pins` are structurally present (doc-10's meta shape) but unhooked in Phase 2:
 *     no campaign-join flow exists yet (Phase 3's `CampaignActor`), and no pack-pinning event
 *     handling was in this task's scope. Wiring them is a Phase-3/pack-pinning-task change to
 *     `applyMetaHooks` below, not a shape change.
 */
import type { Actor, CharacterCampaignJoined, Event } from '@hk/protocol';
import type { Conn } from '../../ports/connections.ts';
import { type AppendOutcome, StreamActor } from './stream-actor.ts';

const META_KEY_OWNER_ID = 'owner_id';
const META_KEY_CAMPAIGN_ID = 'campaign_id';
const META_KEY_PINS = 'pins';
const META_KEY_ARCHIVED = 'archived';

/** doc-10 §CharacterActor's meta shape. `ownerId`/`campaignId` are `undefined` until the events
 * that establish them commit (a brand-new stream with no `character.created` yet — not reachable
 * in practice once `hello`'s pending flush runs, but not assumed away here). */
export interface CharacterMeta {
  readonly ownerId: string | undefined;
  readonly campaignId: string | undefined;
  readonly pins: Readonly<Record<string, string>>;
  readonly archived: boolean;
}

export class CharacterActor extends StreamActor {
  /**
   * Entry rule (doc-03 §Permission enforcement: "Direct solo sockets only allow the owner role";
   * §Permission enforcement point: "for character-stream events [the CampaignStream] calls
   * `CharacterStream.append(events, actor)` by RPC, which re-checks (owner/DM) against its own
   * `meta`"). `'member'` is refused OUTRIGHT here, before `permissions.ts` even runs: no
   * CHARACTER-stream `EVENT_ACTORS` row ever grants `'member'` (`core/permissions.ts`'s own
   * doc comment), and `CampaignActor`'s gateway-forward role mapping (design ruling 1) NEVER
   * forwards a raw `'member'` actor — a member acting through the gateway is always remapped to
   * `'owner'` (on their own character) before `CharacterActor.append` is ever called, so a
   * `'member'` actually reaching here can only be a bug upstream, never a legitimate call.
   *
   * [plan-9 Task 6 — REVISION of the Phase-2-only version of this comment] `'dm'` is now let
   * THROUGH (Phase 2 rejected it too, back when no `CampaignActor`/`Rpc` existed to ever produce
   * one): `StreamActor.append`'s own per-event `permissions.allowed(type, role)` check already
   * decides, per `EVENT_ACTORS`, exactly which event TYPES a `'dm'` actor may append (the `dm.*`
   * class — `hp.changed`, `condition.*`, etc., doc-08's matrix) — this method doesn't need to
   * duplicate that table, only to stop blocking the role entirely. A direct character SOCKET can
   * never itself stamp `role: 'dm'` (the WS handoff in `core/routes/characters.ts` always stamps
   * `'owner'`), so a `'dm'` actor reaching this method can only ever have arrived via
   * `CampaignActor`'s gateway forward (`Rpc.forwardAppend`) — exactly the doc-03 permission-
   * enforcement-point call this method's own doc comment names, now real. The target stream's own
   * pipeline re-checking `permissions.allowed` regardless (rather than trusting the gateway's own
   * decision) is the "defense in depth" doc-03 promises.
   *
   * [fix round 1, Important — character-side defense-in-depth OWNER backstop] Before this fix,
   * `mapGatewayActor` (`campaign-actor.ts`) was the SOLE gate deciding whether a gateway-forwarded
   * `owner`-role actor is genuinely THIS character's own owner — and that method has already had
   * three Criticals fixed in it across this plan's own review history (character-scoping gaps,
   * cross-tenant forgery). doc-03 §Permission enforcement point explicitly promises the TARGET
   * stream re-checks independently ("so a compromised campaign object can't forge owner events" —
   * `docs/02-architecture/03-sync-protocol.md`, one-line clarification added alongside this fix),
   * not merely re-validate schema/permission-table membership the way the pre-fix comment above
   * already described for the `dm` half. The guard inline in `append` below closes this: when
   * `actor.role === 'owner'` and this stream's OWN `meta.ownerId` is already established,
   * `actor.userId` must equal it — refused `forbidden` otherwise, REGARDLESS of whether the actor arrived via a direct
   * socket (which should never disagree with its own session-verified identity anyway — this is a
   * true belt-and-suspenders case there) or a gateway forward (where it closes the exact hole a
   * buggy/compromised `mapGatewayActor` could otherwise open).
   *
   * SCOPING (controller ruling, fix round 1): owner-role actors ONLY. A `dm`-role forwarded actor
   * is NOT re-checked here — this actor has no `Db`/campaign-meta access at all (this file's own
   * header comment), so it has no way to independently verify a forwarding campaign's OWN `dmId`;
   * that check already happens campaign-side (`mapGatewayActor`'s `dm` branch, fix round 1 Critical
   * 1, requires `actor.userId === meta.dmId` — THIS campaign's own dm — before ever forwarding) and
   * the target stream's existing `permissions.allowed(type, 'dm')` check (per `EVENT_ACTORS`) is
   * the dm-side's own defense in depth: WHICH event types a dm may append, not WHO the dm is.
   *
   * [fix round 2 — CRITICAL gap in the round-1 fix, controller-ruled] `character.created` is NOT
   * exempt from this branch. Round 1's version special-cased `character.created` out of the
   * mismatched-owner rejection loop below, reasoning that it "can never legitimately arrive via
   * the gateway forward path" — true, but irrelevant: the branch's OWN condition
   * (`metaBefore.ownerId !== undefined && metaBefore.ownerId !== actor.userId`) already means a
   * REAL owner exists and does NOT match this actor, which is exactly the shape of a forged/
   * mismatched actor produced by a future `mapGatewayActor` bug (the whole scenario this backstop
   * exists for). Exempting `character.created` from rejection in that state let such an actor
   * REPLAY `character.created` — `applyMetaHooks` below unconditionally overwrites
   * `META_KEY_OWNER_ID` from `actor.userId` on every acked `character.created`, with no
   * first-event/already-established guard anywhere in the pipeline — silently HIJACKING
   * ownership, the single highest-value target this backstop was built to close off, while every
   * OTHER owner-class event correctly stayed refused. `character.created` is now rejected exactly
   * like every other event once this branch's condition is true; the ONLY way it still commits
   * normally is by never entering the branch at all, which happens precisely in the two
   * LEGITIMATE cases: a fresh stream (`metaBefore.ownerId === undefined` — the condition's first
   * half fails) and an owner re-sending `character.created` on their OWN already-owned stream
   * (`metaBefore.ownerId === actor.userId` — the condition's second half fails). Both are covered
   * by tests (`characters.test.ts`).
   */
  override async append(events: Event[], actor: Actor, sourceConn?: Conn): Promise<AppendOutcome> {
    if (actor.role === 'member') {
      return {
        acked: [],
        rejected: events.map((event) => ({
          id: event.id,
          code: 'forbidden' as const,
          message: 'event.forbidden: character streams never accept a raw member-role actor (owner/dm only)',
        })),
      };
    }

    // Read BEFORE this append's meta hooks run — plan-9 Task 6's notify-target formula (see
    // `notifyCampaignIfLinked`'s doc comment) needs the PRE-batch `campaignId` to still notify the
    // campaign a `character.campaign_left` in THIS SAME batch just unlinked from. [fix round 1]
    // Also doubles as the owner-backstop's own `ownerId` read below — nothing mutates meta between
    // this read and that check, so reusing it is safe and avoids a second `getCharacterMeta` round
    // trip.
    const metaBefore = await this.getCharacterMeta();
    const beforeCampaignId = metaBefore.campaignId;

    // [fix round 1, extended fix round 2] The owner backstop — see this method's doc comment for
    // the full rationale and the round-2 fix (no `character.created` exemption). Every event in
    // this call is refused uniformly; nothing reaches `super.append`/`applyMetaHooks` at all.
    if (actor.role === 'owner' && metaBefore.ownerId !== undefined && metaBefore.ownerId !== actor.userId) {
      return {
        acked: [],
        rejected: events.map((event) => ({
          id: event.id,
          code: 'forbidden' as const,
          message: `event.forbidden: ${actor.userId} is not this character's established owner`,
        })),
      };
    }

    const outcome = await super.append(events, actor, sourceConn);
    await this.applyMetaHooks(events, outcome, actor);
    await this.notifyCampaignIfLinked(outcome, beforeCampaignId);
    return outcome;
  }

  /** Reads the full meta shape (doc comment above). Every field is read in one `Promise.all`
   * round-trip against `StreamStore.getMeta`, matching `StreamActor.readMeta`'s own pattern. */
  async getCharacterMeta(): Promise<CharacterMeta> {
    const [ownerId, campaignId, pinsRaw, archivedRaw] = await Promise.all([
      this.store.getMeta(META_KEY_OWNER_ID),
      this.store.getMeta(META_KEY_CAMPAIGN_ID),
      this.store.getMeta(META_KEY_PINS),
      this.store.getMeta(META_KEY_ARCHIVED),
    ]);
    return {
      ownerId,
      // Plan-9 Task 6: `character.campaign_left`'s hook (`applyMetaHooks` below) clears this by
      // writing `''` (`StreamStore.setMeta` has no "delete a key" verb — same constraint
      // `archived`'s '0'/'1' flag pattern already works around) — normalized to `undefined` HERE,
      // the single read site, so every OTHER caller of this method (`notifyCampaignIfLinked`'s
      // `!== undefined` check, `CampaignActor`'s gateway ownership mapping, any future reader)
      // never has to know the empty-string encoding exists.
      campaignId: campaignId && campaignId.length > 0 ? campaignId : undefined,
      pins: pinsRaw ? (JSON.parse(pinsRaw) as Record<string, string>) : {},
      archived: archivedRaw === '1',
    };
  }

  // `deleteAll` — `DELETE /api/characters/:id`'s hard-delete step (`core/routes/characters.ts`),
  // reached via `StreamHost.get(id).deleteAll()` so the delete runs under the same single-writer
  // guarantee as every `append` (see `ports/stream.ts`'s `StreamHandle.deleteAll` doc comment for
  // the full rationale) — is inherited unchanged from `StreamActor` (whole-branch review finding
  // 3: that base implementation now closes every live connection and flips the `closed` guard
  // BEFORE wiping the store; see its doc comment there). No character-specific override is needed
  // here: `CharacterActor`'s own meta (`owner_id`/`campaign_id`/`pins`/`archived`) lives in the
  // SAME `StreamStore` `StreamActor.deleteAll` already wipes.

  /** Sets `ownerId`/`archived` from the events this append just committed (see this file's
   * header comment). `actor` is the SESSION-verified actor `append` was called with — never an
   * event's own (client-sent) `actor` field — matching `StreamActor.stampActor`'s rule that only
   * the session-stamped identity is ever trusted for anything security- or ownership-relevant. */
  private async applyMetaHooks(events: readonly Event[], outcome: AppendOutcome, actor: Actor): Promise<void> {
    if (outcome.acked.length === 0) return;
    const ackedIds = new Set(outcome.acked.map((a) => a.id));
    for (const event of events) {
      if (!ackedIds.has(event.id)) continue;
      if (event.type === 'character.created') {
        await this.store.setMeta(META_KEY_OWNER_ID, actor.userId);
        await this.store.setMeta(META_KEY_ARCHIVED, '0');
      } else if (event.type === 'character.archived') {
        await this.store.setMeta(META_KEY_ARCHIVED, '1');
      } else if (event.type === 'character.restored') {
        await this.store.setMeta(META_KEY_ARCHIVED, '0');
      } else if (event.type === 'character.campaign_joined') {
        // Plan-9 Task 6, deliverable 5: the SERVER meta hook `notifyCampaignIfLinked` keys off —
        // the client-side `notApplicableSolo` reducer no-ops (doc-01/doc-05) are a separate,
        // client-plan concern; this is what makes `meta.campaignId` live on the server. Payload is
        // `{campaignId}` only (character.ts's `CharacterCampaignJoinedV1`) — the character itself
        // is THIS stream (`this.streamId`), never a payload field.
        const payload = event.payload as CharacterCampaignJoined;
        await this.store.setMeta(META_KEY_CAMPAIGN_ID, payload.campaignId);
      } else if (event.type === 'character.campaign_left') {
        // No equality check against the payload's own `campaignId` before clearing (mirrors this
        // method's other hooks' "trust the committed event, not a cross-field consistency check"
        // stance — `character.campaign_left` only ever legitimately targets the campaign this
        // character is CURRENTLY linked to; a client sending a stale/wrong `campaignId` here is a
        // client bug this hook does not need to detect to stay correct for every real client).
        await this.store.setMeta(META_KEY_CAMPAIGN_ID, '');
      }
    }
  }

  /**
   * After-commit campaign notify (plan-9 Task 6, deliverable 3 — the Phase-2 no-op this method's
   * doc comment on `ports/infra.ts`'s `Rpc.notify` names becomes real here): when this character
   * is linked to a campaign, forward whatever THIS append call just acked (freshly committed OR
   * idempotently re-acked — see the note below) to that campaign's stream so `CampaignActor.
   * handleNotify` can fan them out to the DM/owner/full-visibility members (doc-08's "Read
   * character stream" row — `CampaignActor`'s own filter, not this method's concern).
   *
   * TARGET formula: `afterCampaignId ?? beforeCampaignId`. `applyMetaHooks` above has ALREADY run
   * by the time this is called, so `afterCampaignId` reflects any `character.campaign_joined`/
   * `character.campaign_left` THIS SAME batch just committed:
   *   - steady state (linked before and after, no join/leave this batch): before === after — the
   *     one linked campaign is notified, as expected.
   *   - a `character.campaign_joined` in this batch: before is `undefined`, after is the NEW
   *     campaign id — the newly-joined campaign is notified (including the join event itself).
   *   - a `character.campaign_left` in this batch: before is the OLD campaign id, after is
   *     `undefined` — `afterCampaignId ?? beforeCampaignId` falls back to `beforeCampaignId`, so
   *     the campaign being LEFT still gets notified of the leave event (and anything else in this
   *     same batch), instead of the notify silently vanishing the instant the link is cleared.
   *   - never linked at all: both `undefined` — nothing to notify, no-op.
   *
   * EVENT SELECTION: every id `outcome.acked` names, re-read from the store via `findByIds`
   * (ports/stream.ts's dedupe-lookup extension — already exists for exactly this "resolve ids back
   * to full committed events" need) rather than threading the stamped-with-seq events through the
   * pipeline as a new return shape (`AppendOutcome`'s `{acked, rejected}` id/seq-only shape is
   * shared with `StreamActor`'s and every adapter's own understanding of an append result — widening
   * it is out of this task's scope). This DOES include idempotently-re-acked duplicates (a retried
   * append of already-committed ids), not only newly-stored ones: distinguishing the two would need
   * pipeline-shape changes this task doesn't make (see `stream-actor.ts`'s `append` doc comment —
   * `AppendOutcome` doesn't carry that distinction either), and it is harmless here — the sync
   * protocol already requires every consumer of an `events` frame to de-dupe by `id` (doc-03:
   * "Duplicates (same `id`) are acked with the existing `seq`"), which a campaign socket receiving
   * a notify-forwarded `events` frame is exactly such a consumer.
   */
  private async notifyCampaignIfLinked(outcome: AppendOutcome, beforeCampaignId: string | undefined): Promise<void> {
    if (outcome.acked.length === 0) return;
    const afterCampaignId = (await this.getCharacterMeta()).campaignId;
    const targetCampaignId = afterCampaignId ?? beforeCampaignId;
    if (targetCampaignId === undefined) return;

    const ids = outcome.acked.map((a) => a.id);
    const committed = await this.store.findByIds(ids);
    if (committed.length === 0) return;
    const ordered = [...committed].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    await this.rpc.notify(`camp:${targetCampaignId}`, this.streamId, ordered);
  }
}
