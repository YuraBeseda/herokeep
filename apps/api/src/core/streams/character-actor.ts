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
import type { Actor, Event } from '@hk/protocol';
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
   * Phase-2 entry rule (doc-03 §Permission enforcement: "Direct solo sockets only allow the
   * owner role") enforced HERE, one level stricter than `StreamActor.append`'s own per-event
   * `permissions.allowed(type, role)` check: that table also lists `dm.*` events as allowed for
   * role `'dm'`, because it's ADR-012's FULL table (owner AND DM columns) — correct for a DM
   * acting through a campaign's `Rpc` forward (doc-10 §CharacterActor: "DM events only via the
   * campaign's Rpc"), which is not how a request ever reaches THIS method in Phase 2 (no
   * `CampaignActor`/`Rpc` exists yet — every call here comes from a direct socket, per the WS
   * handoff in `core/routes/characters.ts` always stamping `role: 'owner'`). A `'dm'`/`'member'`
   * actor reaching this method regardless (a test constructing one directly, or a future bug in
   * the handoff) is therefore refused OUTRIGHT — before `permissions.ts` even runs — rather than
   * being allowed through for the subset of event types the full table happens to permit a DM.
   */
  override async append(events: Event[], actor: Actor, sourceConn?: Conn): Promise<AppendOutcome> {
    if (actor.role !== 'owner') {
      return {
        acked: [],
        rejected: events.map((event) => ({
          id: event.id,
          code: 'forbidden' as const,
          message: 'event.forbidden: character streams accept only the owner role on a direct socket',
        })),
      };
    }
    const outcome = await super.append(events, actor, sourceConn);
    await this.applyMetaHooks(events, outcome, actor);
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
      campaignId,
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
      }
    }
  }
}
