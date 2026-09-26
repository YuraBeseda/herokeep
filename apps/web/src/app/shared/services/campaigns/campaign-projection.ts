import type {
  CampaignArchived,
  CampaignCharacterJoined,
  CampaignCharacterLeft,
  CampaignCreated,
  CampaignJoinCodeRotated,
  CampaignRenamed,
  CampaignSettings,
  CampaignSettingsChanged,
  ChatMessage,
  DmNoteAdded,
  DmNoteRemoved,
  DmNoteUpdated,
  Event,
  MemberJoined,
  MemberLeft,
  MemberRemoved,
  MemberRenamed,
  MembershipRole,
  PackDisabled,
  PackEnabled,
  PartyOverviewUpdated,
  RollLogged,
  SessionEnded,
  SessionStarted,
} from '@hk/protocol';

/**
 * Ruling 1 (plan 10 Task 3): "Projection, not reduction". Pure, deterministic module — no Angular
 * imports, no injection, no `Date.now`/`Math.random` — folding a campaign stream's `Event[]` (the
 * protocol envelope type from `@hk/protocol`, what the plan/brief text calls "EventEnvelope"; the
 * same type `parseEvent` and `EventsRepository.byStream` produce) into a `CampaignState` view
 * model. Mirrors `packages/engine/src/reduce/reducer.ts`'s discipline even though it lives in
 * `apps/web` (a campaign stream is app-local view state, not `@hk/engine`'s character facts model
 * — `@hk/engine` is untouched by this module).
 *
 * Unlike the character reducer, a campaign stream never carries `event.reverted`
 * (`EVENT_STREAM_KIND` in `@hk/protocol` is `char`-only for that type — `packages/protocol/src/
 * events/index.ts`), so there is no revert pre-scan here.
 */

/** `party.overview_updated`'s `overview` field shape, re-exported standalone so callers don't have
 * to reach into `PartyOverviewUpdated['overview']` themselves. */
export type PartyOverview = PartyOverviewUpdated['overview'];

/**
 * A campaign membership row. Ruling 1 pins this EXACT shape — `{displayName, role, removed:
 * boolean}` — with a single boolean flag, not one flag per removal reason. `member.left`
 * (voluntary) and `member.removed` (DM-initiated) both set `removed: true` on the SAME field: the
 * pinned shape leaves no room for a separate `left` flag alongside `removed`, so "your call" (the
 * brief's wording) resolves to reusing the one field the shape already has. The row is never
 * deleted from `members` by either event — same "flagged, not removed" persistence the brief pins
 * explicitly for `member.removed`, applied uniformly to `member.left` too. A later `member.joined`
 * for the same `userId` reactivates the row (`removed: false`).
 */
export interface MemberEntry {
  displayName: string;
  role: MembershipRole;
  removed: boolean;
}

/**
 * A campaign roster row (a character linked to this campaign). `campaign.character_left` sets
 * `left: true` but the entry PERSISTS (doc-03: a departed member's character stays visible in the
 * roster until the DM unlinks it — there is no separate "unlink" event type in the 21-type
 * catalog, so `campaign.character_left` IS the unlink action; `campaign.character_joined` is the
 * only way a row is (re)inserted or reactivated to `left: false`).
 */
export interface RosterEntry {
  ownerId: string;
  name: string;
  left: boolean;
}

/** An enabled non-core pack, keyed by `packId` in `CampaignState.packs` (one entry per packId —
 * `pack.enabled` overwrites, `pack.disabled` deletes the key). `campaign.created`'s `corePack` is
 * NOT folded into this map: the event catalog only routes `pack.enabled`/`pack.disabled` here. */
export interface EnabledPack {
  version: string;
  sha256: string;
}

/** A DM note row, keyed by `id` in `CampaignState.dmNotes`. `dm.note_updated` replaces the row
 * wholesale (both payloads carry the full `{title?, body?}`, same "full document" convention as
 * `campaign.settings_changed`) — there is no field-level merge. */
export interface DmNoteEntry {
  title?: string;
  body?: string;
}

/**
 * One folded log entry — `roll.logged` / `chat.message` / `session.started` / `session.ended`, in
 * seq order (`CampaignState.log`'s element type). `seq` is carried through as-is (`undefined` for
 * a still-pending event) so a renderer can tell a locally-optimistic entry apart from a committed
 * one. The `roll`/`chat` variants carry `actorUserId` (from the envelope's `actor.userId` — never
 * from the payload, which has no such field) because a renderer needs "who" to attribute the
 * entry; the `session-start`/`session-end` variants do not (per the brief's own union spec — a
 * session marker is campaign-wide, not attributed to whoever started the clock).
 */
export type LogEntry =
  | {
      kind: 'roll';
      seq: number | undefined;
      eventId: string;
      actorUserId: string;
      payload: RollLogged;
    }
  | {
      kind: 'chat';
      seq: number | undefined;
      eventId: string;
      actorUserId: string;
      payload: ChatMessage;
    }
  | { kind: 'session-start'; seq: number | undefined; eventId: string; title: string | undefined }
  | { kind: 'session-end'; seq: number | undefined; eventId: string; title: string | undefined };

/**
 * The full projected view of a campaign stream (Ruling 1's pinned shape). `settings` is `null`
 * until the first `campaign.settings_changed` (a campaign can exist — `campaign.created` — before
 * its settings document is ever posted). `session.startedAt` holds the STARTING event's own `id`
 * (an event id, not a timestamp — this module never reads a clock), cleared back to `undefined`
 * once the session ends (no session is "started as of" anything while none is active).
 */
export interface CampaignState {
  name: string;
  system: string;
  settings: CampaignSettings | null;
  joinCode?: string;
  members: Map<string, MemberEntry>;
  roster: Map<string, RosterEntry>;
  packs: Map<string, EnabledPack>;
  overviews: Map<string, PartyOverview>;
  session: { active: boolean; startedAt?: string; title?: string };
  log: LogEntry[];
  dmNotes: Map<string, DmNoteEntry>;
  archived: boolean;
}

function emptyState(): CampaignState {
  return {
    name: '',
    system: '',
    settings: null,
    members: new Map(),
    roster: new Map(),
    packs: new Map(),
    overviews: new Map(),
    session: { active: false },
    log: [],
    dmNotes: new Map(),
    archived: false,
  };
}

/**
 * Committed (seq-assigned) events fold in strict seq order; pending (seq-less) events fold last,
 * in the caller's given array order — same convention as `packages/engine/src/reduce/reducer.ts`'s
 * `orderEvents` and doc-03's `facts = reduce(committed ++ pending)`. `Array#sort` is stable, so two
 * same-seq events (a duplicate delivery) keep their relative input order.
 */
function orderEvents(events: readonly Event[]): Event[] {
  const committed = events.filter((e) => e.seq !== undefined).sort((a, b) => a.seq! - b.seq!);
  const pending = events.filter((e) => e.seq === undefined);
  return [...committed, ...pending];
}

/**
 * Folds a campaign stream's events into a `CampaignState`. Pure and deterministic: the same
 * `events` array always yields an equal (deep) result, the input array is never mutated, and no
 * clock/RNG/locale is consulted. Unknown or future event types are skipped silently (forward
 * compatibility — the same tolerance the engine reducer applies to unhandled types).
 */
export function projectCampaign(events: readonly Event[]): CampaignState {
  const state = emptyState();
  // Local mutable working copies of the Map-shaped fields — the function's OUTPUT is what must be
  // deterministic and side-effect-free, not every intermediate step; cloning every collection on
  // every fold iteration (matching the engine reducer's per-field immutability) would be needless
  // O(n^2) work for a module with no other consumer of intermediate states.
  const members = state.members;
  const roster = state.roster;
  const packs = state.packs;
  const overviews = state.overviews;
  const dmNotes = state.dmNotes;
  const log = state.log;
  let name = state.name;
  let system = state.system;
  let settings = state.settings;
  let joinCode = state.joinCode;
  let session = state.session;
  let archived = state.archived;

  for (const e of orderEvents(events)) {
    switch (e.type) {
      case 'campaign.created': {
        const p = e.payload as CampaignCreated;
        name = p.name;
        system = p.system;
        break;
      }
      case 'campaign.renamed': {
        const p = e.payload as CampaignRenamed;
        name = p.name;
        break;
      }
      case 'campaign.settings_changed': {
        const p = e.payload as CampaignSettingsChanged;
        settings = p.settings;
        break;
      }
      case 'campaign.join_code_rotated': {
        const p = e.payload as CampaignJoinCodeRotated;
        joinCode = p.joinCode;
        break;
      }
      case 'campaign.archived': {
        void (e.payload as CampaignArchived);
        archived = true;
        break;
      }
      case 'pack.enabled': {
        const p = e.payload as PackEnabled;
        packs.set(p.packId, { version: p.version, sha256: p.sha256 });
        break;
      }
      case 'pack.disabled': {
        const p = e.payload as PackDisabled;
        packs.delete(p.packId);
        break;
      }
      case 'member.joined': {
        const p = e.payload as MemberJoined;
        members.set(p.userId, { displayName: p.displayName, role: p.role, removed: false });
        break;
      }
      case 'member.left': {
        const p = e.payload as MemberLeft;
        members.set(p.userId, { displayName: p.displayName, role: p.role, removed: true });
        break;
      }
      case 'member.removed': {
        const p = e.payload as MemberRemoved;
        members.set(p.userId, { displayName: p.displayName, role: p.role, removed: true });
        break;
      }
      case 'member.renamed': {
        // No `userId` in this payload (`MemberRenamedV1 = {displayName}` only,
        // packages/protocol/src/events/campaign.ts) — the row this event targets is the
        // AUTHORING actor's own membership (`e.actor.userId`), matching the self-service
        // semantics of this event's actor grant (`['dm', 'member']`, doc-08). An unknown actor
        // (no existing row) is a no-op — there is nothing to rename.
        const p = e.payload as MemberRenamed;
        const existing = members.get(e.actor.userId);
        if (existing) members.set(e.actor.userId, { ...existing, displayName: p.displayName });
        break;
      }
      case 'campaign.character_joined': {
        const p = e.payload as CampaignCharacterJoined;
        roster.set(p.characterId, { ownerId: p.ownerId, name: p.name, left: false });
        break;
      }
      case 'campaign.character_left': {
        const p = e.payload as CampaignCharacterLeft;
        roster.set(p.characterId, { ownerId: p.ownerId, name: p.name, left: true });
        break;
      }
      case 'party.overview_updated': {
        const p = e.payload as PartyOverviewUpdated;
        overviews.set(p.characterId, p.overview);
        break;
      }
      case 'session.started': {
        const p = e.payload as SessionStarted;
        session = { active: true, startedAt: e.id, title: p.title };
        log.push({ kind: 'session-start', seq: e.seq, eventId: e.id, title: p.title });
        break;
      }
      case 'session.ended': {
        const p = e.payload as SessionEnded;
        session = { active: false, title: p.title };
        log.push({ kind: 'session-end', seq: e.seq, eventId: e.id, title: p.title });
        break;
      }
      case 'roll.logged': {
        const p = e.payload as RollLogged;
        log.push({
          kind: 'roll',
          seq: e.seq,
          eventId: e.id,
          actorUserId: e.actor.userId,
          payload: p,
        });
        break;
      }
      case 'chat.message': {
        const p = e.payload as ChatMessage;
        log.push({
          kind: 'chat',
          seq: e.seq,
          eventId: e.id,
          actorUserId: e.actor.userId,
          payload: p,
        });
        break;
      }
      case 'dm.note_added': {
        const p = e.payload as DmNoteAdded;
        dmNotes.set(p.id, { title: p.title, body: p.body });
        break;
      }
      case 'dm.note_updated': {
        const p = e.payload as DmNoteUpdated;
        dmNotes.set(p.id, { title: p.title, body: p.body });
        break;
      }
      case 'dm.note_removed': {
        const p = e.payload as DmNoteRemoved;
        dmNotes.delete(p.id);
        break;
      }
      default:
        // Unknown/future event type: skip silently (forward compatibility).
        break;
    }
  }

  return { ...state, name, system, settings, joinCode, session, archived };
}
