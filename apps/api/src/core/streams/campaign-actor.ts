/**
 * `CampaignActor` — wraps `StreamActor` with the campaign-specific `meta` doc-10 §CampaignActor
 * names (`dmId`, `settings`, `members`, `characters`, `packs`; plan-9 design ruling 3) plus the
 * three campaign-only behaviors doc-10 lists for it that a plain `StreamActor` has no notion of:
 * per-append permission refinement beyond the static `EVENT_ACTORS` table, REAL read-visibility
 * filtering (`dm.note_*`, `roll.logged`), and presence (`members` snapshots, throttled).
 *
 * Scope note (task-5-brief, read together with the ledger's R-pf1 sequencing ruling): this task
 * runs BEFORE Task 4 (routes) and Task 6 (gateway forwarding + cross-stream mirrors + DM
 * subscribe-relay) — `campaign.created`'s D1 dual-write, the WS-handoff role stamping (ruling 1),
 * the `Rpc` gateway forward, and the actual char-stream relay for a validated `subscribe` are ALL
 * later tasks' work. What ships here is the actor those later tasks emit/relay THROUGH: meta
 * maintenance from committed events, the permission refinements only an actor with live meta can
 * express, presence, real visibility filtering (now applying to catch-up too — see
 * `stream-actor.ts`'s `hello` — per this task's own finding), and `subscribe`/`unsubscribe`
 * attachment bookkeeping (validated, not yet relayed).
 *
 * Meta is `getMeta`/`setMeta`-backed via the SAME `StreamStore` namespace `CharacterActor` uses —
 * see that file's header comment for the pattern this mirrors. Structured fields (`members`,
 * `characters`, `packs`) are stored as one JSON blob per key, same as `CharacterActor.pins`.
 */
import {
  type Actor,
  type CampaignCharacterJoined,
  type CampaignCharacterLeft,
  CAMPAIGN_EVENT_ACTORS,
  type CampaignCreated,
  type CampaignSettings,
  type CampaignSettingsChanged,
  type Event,
  type HelloMsg,
  type MemberJoined,
  type MemberLeft,
  type MembersMsg,
  type MembershipRole,
  type MemberRemoved,
  type MemberRenamed,
  type PackDisabled,
  type PackEnabled,
  parseClientMessage,
  type SubscribeMsg,
  type UnsubscribeMsg,
} from '@hk/protocol';
import type { Conn } from '../../ports/connections.ts';
import * as quotasModule from '../quotas.ts';
import {
  type AppendOutcome,
  type ConnAttachment,
  type QuotasPort,
  type RejectResult,
  StreamActor,
  type StreamActorDeps,
} from './stream-actor.ts';

const META_KEY_DM_ID = 'dm_id';
const META_KEY_SETTINGS = 'settings';
const META_KEY_MEMBERS = 'members';
const META_KEY_CHARACTERS = 'characters';
const META_KEY_PACKS = 'packs';

/** doc-10 §Presence: "`members` frame on connect/close, throttled to one per 5 s." */
const PRESENCE_THROTTLE_MS = 5_000;

/**
 * `CampaignActor`'s own `QuotasPort` (task-5-brief item 3's "check how quotas.ts parameterizes;
 * extend cleanly for per-stream-type limits") — closes over `quotas.ts`'s new `CAMPAIGN_QUOTA_LIMITS`
 * instead of the character-stream default every OTHER `QuotasPort` consumer keeps getting for
 * free. Exported (not just used internally) so adapter wiring (Task 8) and tests can pass it to
 * the constructor exactly like `stream-actor.test.ts` passes the real `quotas` module today.
 */
export const campaignQuotas: QuotasPort = {
  quotaFor: (meta) => quotasModule.quotaFor(meta, quotasModule.CAMPAIGN_QUOTA_LIMITS),
  checkAppend: (meta, events) => quotasModule.checkAppend(meta, events, quotasModule.CAMPAIGN_QUOTA_LIMITS),
};

/** Every campaign event type whose `CAMPAIGN_EVENT_ACTORS` row is `['dm']` exactly — task-5-brief
 * item 2's "dm-family events require actor.role dm AND actor.userId === meta.dmId". Derived from
 * the protocol package's own table (not hand-duplicated) so this can never drift from it. */
const DM_ONLY_TYPES: ReadonlySet<string> = new Set(
  Object.entries(CAMPAIGN_EVENT_ACTORS)
    .filter(([, roles]) => roles.length === 1 && roles[0] === 'dm')
    .map(([type]) => type),
);

/** doc-10 §CampaignActor's meta shape (plan-9 design ruling 3). `settings`/`dmId` are `undefined`
 * until `campaign.created` commits (mirrors `CharacterMeta`'s own "not established yet" stance). */
export interface CampaignMeta {
  readonly dmId: string | undefined;
  readonly settings: CampaignSettings | undefined;
  readonly members: ReadonlyMap<string, { readonly displayName: string; readonly role: MembershipRole }>;
  /** `characterId -> ownerId`, from `campaign.character_joined`/`campaign.character_left`. */
  readonly characters: ReadonlyMap<string, string>;
  /** Pins CURRENTLY enabled via `pack.enabled`/`pack.disabled` — see `applyMetaHooks`'s
   * `pack.enabled` case for why the pack JSON body itself is not handled here. */
  readonly packs: readonly { readonly packId: string; readonly version: string; readonly sha256: string }[];
}

/** doc-02's settings document defaults, seeded from `campaign.created.system` the moment that
 * event commits (task-5-brief item 1: "campaign.created → dmId/settings-defaults/system"). No
 * doc-02 passage states a canonical default for every `houseRules`/`visibility`/`join` field —
 * these mirror 5e's own out-of-the-box behavior (standard XP, average HP on level-up, no
 * encumbrance tracking, the SRD's attunement cap of 3, level 1 start, full party-sheet visibility,
 * public rolls with private rolls allowed, and an open, non-approval join) rather than a
 * maximally-restrictive/permissive extreme, so a freshly created campaign behaves like "ordinary
 * 5e" until the DM changes something via `campaign.settings_changed`. `packs: []` — the core pack
 * itself is NOT represented here (see `CampaignMeta.packs`'s doc comment): it is named by
 * `campaign.created.corePack`, tracked by the D1/settings side (Task 3/4), never by `pack.enabled`.
 */
function defaultSettings(system: string): CampaignSettings {
  return {
    system,
    packs: [],
    houseRules: {
      strictValidation: true,
      allowOverrides: false,
      editOutsideSession: 'free',
      xpMode: 'xp',
      hpOnLevelUp: 'average',
      encumbrance: 'off',
      attunementMax: 3,
      startingLevel: 1,
    },
    visibility: { partySheets: 'full', rolls: 'everyone', allowPrivateRolls: true },
    join: { open: true, requireApproval: false },
  };
}

/** Safely reads a `string` field off an event's (possibly still schema-UNVALIDATED — see
 * `append`'s doc comment on why) payload, without throwing on a malformed shape. Used only by the
 * PRE-super.append refinement checks below — `applyMetaHooks` runs strictly AFTER `super.append`,
 * so every event it inspects has already passed full schema validation and a plain `as` cast is
 * safe there (matches `CharacterActor.applyMetaHooks`'s own precedent). */
function readStringField(payload: unknown, field: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

export interface CampaignActorDeps extends StreamActorDeps {
  /** Injectable clock for the presence throttle (task-5-brief item 5: "injectable clock for
   * tests"). Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injectable timer scheduler for the throttle's TRAILING edge — defaults to the real
   * `setTimeout`. A test passes a fake pair (capturing the callback/delay instead of actually
   * waiting) so the trailing send can be driven deterministically alongside a fake `now`. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export class CampaignActor extends StreamActor {
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private presenceLastSentAt = Number.NEGATIVE_INFINITY;
  private presenceTrailingTimer: unknown;

  constructor(deps: CampaignActorDeps) {
    super(deps);
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    // `clearTimer` (accepted in `CampaignActorDeps` for symmetry with `setTimer`) is intentionally
    // never called: the throttle design below never needs to CANCEL a scheduled trailing send —
    // see `triggerPresence`'s doc comment — only to schedule at most one.
  }

  /**
   * The append pipeline, wrapped exactly once around `StreamActor.append` (mirrors
   * `CharacterActor.append`'s own shape) to add three things `StreamActor`'s generic pipeline
   * cannot express on its own: (1) per-event permission REFINEMENT beyond the static
   * `EVENT_ACTORS` table (`refineAppendPermission`) — checked BEFORE `super.append`, so a refused
   * event never reaches schema validation/dedupe/quota at all; (2) the two per-append COUNT
   * quotas (`member.joined` at 12, `pack.enabled` at 6) that `quotas.ts`'s generic byte/event-count
   * machinery cannot express (see `quotas.ts`'s `CAMPAIGN_BYTES_MAX` doc comment); (3) meta
   * maintenance from whatever `super.append` actually committed.
   *
   * IMPORTANT ordering note: steps (1)/(2) run against events whose `payload` has NOT yet been
   * schema-validated (that happens inside `super.append`'s stage 1) — `refineAppendPermission`
   * and the count checks below therefore read payload fields DEFENSIVELY (`readStringField`) and
   * let anything they can't safely interpret fall through to `super.append`, where schema
   * validation rejects a genuinely malformed payload with the correct code (`invalid`), not a
   * misleading `forbidden`/`quota`.
   */
  override async append(events: Event[], actor: Actor, sourceConn?: Conn): Promise<AppendOutcome> {
    if (events.length === 0) return { acked: [], rejected: [] };
    if (this.closed) {
      return {
        acked: [],
        rejected: events.map((event) => ({
          id: event.id,
          code: 'stream_closed' as const,
          message: 'event.streamClosed: this stream has been deleted',
        })),
      };
    }

    const meta = await this.getCampaignMeta();
    const passed: Event[] = [];
    const preRejected: RejectResult[] = [];
    let membersCount = meta.members.size;
    let packsCount = meta.packs.length;

    for (const event of events) {
      const refusal = this.refineAppendPermission(event, actor, meta);
      if (refusal) {
        preRejected.push({ id: event.id, code: refusal.code, message: refusal.message });
        continue;
      }

      if (event.type === 'member.joined') {
        const userId = readStringField(event.payload, 'userId');
        const alreadyMember = userId !== undefined && meta.members.has(userId);
        if (!alreadyMember && membersCount >= quotasModule.CAMPAIGN_MEMBER_MAX) {
          preRejected.push({
            id: event.id,
            code: 'quota',
            message: `event.quota: campaign already has the maximum of ${quotasModule.CAMPAIGN_MEMBER_MAX} members`,
          });
          continue;
        }
        if (!alreadyMember) membersCount += 1;
      }

      if (event.type === 'pack.enabled') {
        const packId = readStringField(event.payload, 'packId');
        const version = readStringField(event.payload, 'version');
        const exists =
          packId !== undefined &&
          version !== undefined &&
          meta.packs.some((p) => p.packId === packId && p.version === version);
        if (!exists && packsCount >= quotasModule.CAMPAIGN_NON_CORE_PACK_MAX) {
          preRejected.push({
            id: event.id,
            code: 'quota',
            message: `event.quota: campaign already has the maximum of ${quotasModule.CAMPAIGN_NON_CORE_PACK_MAX} non-core packs`,
          });
          continue;
        }
        if (!exists) packsCount += 1;
      }

      passed.push(event);
    }

    const base = passed.length > 0 ? await super.append(passed, actor, sourceConn) : { acked: [], rejected: [] };
    const outcome: AppendOutcome = { acked: base.acked, rejected: [...base.rejected, ...preRejected] };
    await this.applyMetaHooks(events, outcome, actor);
    return outcome;
  }

  /**
   * Per-append permission refinements the static `EVENT_ACTORS` table (`campaign-permissions.ts`)
   * cannot express — task-5-brief item 2, each bullet implemented as its own guard:
   *
   *   (a) a `member`-role actor must actually BE a member of THIS campaign per live meta — except
   *       `member.joined` itself, which is how membership is ESTABLISHED (the joiner cannot
   *       already be in `meta.members` when they send it; excluding it is not a loophole, it is
   *       the only way this event could ever succeed).
   *   (b) `campaign.character_joined`/`campaign.character_left` and `party.overview_updated`
   *       require the actor to BE the character's owner (per the event's own `ownerId` payload
   *       field for the join/left pair, per `meta.characters` for the overview post) — DM exempt.
   *   (c) `member.renamed` is inherently self-only: its payload carries no OTHER user's id at all
   *       (`{displayName}`), so there is no separate guard to write — `applyMetaHooks` below
   *       always applies it to `actor.userId`, never anything from the payload.
   *   (d) "dm-family" events (`DM_ONLY_TYPES`, this file's module-level constant) require BOTH
   *       `actor.role === 'dm'` (redundant with the static table — kept explicit per the brief)
   *       AND `actor.userId === meta.dmId`, i.e. THIS campaign's own DM, not merely a dm-role
   *       actor from a stale/incorrect handoff. `campaign.created` is exempted from the `dmId`
   *       half: `meta.dmId` does not exist until THIS event establishes it.
   */
  private refineAppendPermission(
    event: Event,
    actor: Actor,
    meta: CampaignMeta,
  ): { readonly code: 'forbidden'; readonly message: string } | undefined {
    if (actor.role === 'member' && event.type !== 'member.joined' && !meta.members.has(actor.userId)) {
      return { code: 'forbidden', message: `event.forbidden: ${actor.userId} is not a member of this campaign` };
    }

    if (DM_ONLY_TYPES.has(event.type)) {
      if (actor.role !== 'dm') {
        return { code: 'forbidden', message: `event.forbidden: ${event.type} requires the dm role` };
      }
      if (event.type !== 'campaign.created' && actor.userId !== meta.dmId) {
        return { code: 'forbidden', message: `event.forbidden: ${event.type} requires this campaign's own dm` };
      }
    }

    if (event.type === 'campaign.character_joined' || event.type === 'campaign.character_left') {
      const ownerId = readStringField(event.payload, 'ownerId');
      if (ownerId !== undefined && actor.role !== 'dm' && actor.userId !== ownerId) {
        return {
          code: 'forbidden',
          message: `event.forbidden: ${event.type} requires the character's own owner or this campaign's dm`,
        };
      }
    }

    if (event.type === 'party.overview_updated' && actor.role !== 'dm') {
      const characterId = readStringField(event.payload, 'characterId');
      if (characterId !== undefined) {
        const ownerId = meta.characters.get(characterId);
        if (ownerId === undefined || ownerId !== actor.userId) {
          return {
            code: 'forbidden',
            message: "event.forbidden: party.overview_updated requires the character's own owner or this campaign's dm",
          };
        }
      }
    }

    return undefined;
  }

  /** Reads the full meta shape (this file's header comment). Every field is read in one
   * `Promise.all` round-trip against `StreamStore.getMeta`, matching `CharacterActor`'s own
   * pattern (`getCharacterMeta`). */
  async getCampaignMeta(): Promise<CampaignMeta> {
    const [dmId, settingsRaw, membersRaw, charactersRaw, packsRaw] = await Promise.all([
      this.store.getMeta(META_KEY_DM_ID),
      this.store.getMeta(META_KEY_SETTINGS),
      this.store.getMeta(META_KEY_MEMBERS),
      this.store.getMeta(META_KEY_CHARACTERS),
      this.store.getMeta(META_KEY_PACKS),
    ]);
    const membersObj = membersRaw
      ? (JSON.parse(membersRaw) as Record<string, { displayName: string; role: MembershipRole }>)
      : {};
    const charactersObj = charactersRaw ? (JSON.parse(charactersRaw) as Record<string, string>) : {};
    return {
      dmId,
      settings: settingsRaw ? (JSON.parse(settingsRaw) as CampaignSettings) : undefined,
      members: new Map(Object.entries(membersObj)),
      characters: new Map(Object.entries(charactersObj)),
      packs: packsRaw ? (JSON.parse(packsRaw) as CampaignMeta['packs']) : [],
    };
  }

  /**
   * Sets `dmId`/`settings`/`members`/`characters`/`packs` from the events this append just
   * committed (design ruling 3's event families, one `switch` case each). Reads the CURRENT meta
   * once, mutates plain `Map`/array copies across every acked event in this batch, then writes
   * back only the collections actually touched — cheaper than a `getMeta`/`setMeta` round-trip
   * per event for a multi-event append, and matches `CharacterActor.applyMetaHooks`'s own
   * "acked-only" filtering.
   */
  private async applyMetaHooks(events: readonly Event[], outcome: AppendOutcome, actor: Actor): Promise<void> {
    if (outcome.acked.length === 0) return;
    const ackedIds = new Set(outcome.acked.map((a) => a.id));

    const meta = await this.getCampaignMeta();
    const members = new Map(meta.members);
    const characters = new Map(meta.characters);
    const packs = [...meta.packs];
    let dmId = meta.dmId;
    let settings = meta.settings;
    let dmIdDirty = false;
    let settingsDirty = false;
    let membersDirty = false;
    let charactersDirty = false;
    let packsDirty = false;

    for (const event of events) {
      if (!ackedIds.has(event.id)) continue;
      switch (event.type) {
        case 'campaign.created': {
          const payload = event.payload as CampaignCreated;
          dmId = actor.userId;
          dmIdDirty = true;
          settings = defaultSettings(payload.system);
          settingsDirty = true;
          break;
        }
        case 'campaign.settings_changed': {
          const payload = event.payload as CampaignSettingsChanged;
          settings = payload.settings;
          settingsDirty = true;
          break;
        }
        case 'member.joined': {
          const payload = event.payload as MemberJoined;
          members.set(payload.userId, { displayName: payload.displayName, role: payload.role });
          membersDirty = true;
          break;
        }
        case 'member.left': {
          const payload = event.payload as MemberLeft;
          members.delete(payload.userId);
          membersDirty = true;
          break;
        }
        case 'member.removed': {
          const payload = event.payload as MemberRemoved;
          members.delete(payload.userId);
          membersDirty = true;
          break;
        }
        case 'member.renamed': {
          // Self-only by construction (this file's `refineAppendPermission` doc comment, (c)):
          // the payload carries no OTHER user's id, so `actor.userId` — never anything read from
          // `event.payload` — is always the target.
          const payload = event.payload as MemberRenamed;
          const existing = members.get(actor.userId);
          members.set(actor.userId, {
            displayName: payload.displayName,
            role: existing?.role ?? (actor.role === 'dm' ? 'dm' : 'player'),
          });
          membersDirty = true;
          break;
        }
        case 'campaign.character_joined': {
          const payload = event.payload as CampaignCharacterJoined;
          characters.set(payload.characterId, payload.ownerId);
          charactersDirty = true;
          break;
        }
        case 'campaign.character_left': {
          const payload = event.payload as CampaignCharacterLeft;
          characters.delete(payload.characterId);
          charactersDirty = true;
          break;
        }
        case 'pack.enabled': {
          const payload = event.payload as PackEnabled;
          if (!packs.some((p) => p.packId === payload.packId && p.version === payload.version)) {
            packs.push({ packId: payload.packId, version: payload.version, sha256: payload.sha256 });
            packsDirty = true;
          }
          // The pack JSON BODY itself (`StreamStore.putPack`) is NOT written here: this event's
          // payload only ever carries `{packId, version, sha256}` (Task 1's flag: `sha256` is
          // bare hex, not `BlobHashSchema`'s `sha256:<hex>` form) — never the pack document. A DM
          // device holds the actual pack asset (doc-07); wiring an upload path that calls
          // `putPack` with the real JSON is T4/T6's job. Only this meta LIST entry (for the
          // ≤6-non-core-packs quota above and a future `welcome.packs` frame) is maintained here.
          break;
        }
        case 'pack.disabled': {
          const payload = event.payload as PackDisabled;
          const next = packs.filter((p) => !(p.packId === payload.packId && p.version === payload.version));
          if (next.length !== packs.length) {
            packs.length = 0;
            packs.push(...next);
            packsDirty = true;
          }
          break;
        }
        default:
          break;
      }
    }

    const writes: Promise<void>[] = [];
    if (dmIdDirty && dmId !== undefined) writes.push(this.store.setMeta(META_KEY_DM_ID, dmId));
    if (settingsDirty && settings !== undefined)
      writes.push(this.store.setMeta(META_KEY_SETTINGS, JSON.stringify(settings)));
    if (membersDirty) writes.push(this.store.setMeta(META_KEY_MEMBERS, JSON.stringify(Object.fromEntries(members))));
    if (charactersDirty)
      writes.push(this.store.setMeta(META_KEY_CHARACTERS, JSON.stringify(Object.fromEntries(characters))));
    if (packsDirty) writes.push(this.store.setMeta(META_KEY_PACKS, JSON.stringify(packs)));
    await Promise.all(writes);
  }

  /**
   * `hello` (connect): catch-up/welcome unchanged (inherited via `super.hello`, now filtered per
   * `filterForConnection` below thanks to `stream-actor.ts`'s catch-up fix) plus a throttled
   * presence broadcast — doc-10 §Presence: "`members` frame on connect/close".
   */
  override async hello(conn: Conn, msg: HelloMsg): Promise<void> {
    await super.hello(conn, msg);
    await this.triggerPresence();
  }

  /**
   * The adapter-side surface for the OTHER half of "on connect/close" (doc-10 §Presence) —
   * `hello` above covers connect; there is no base-class "a connection went away" hook (unlike
   * `hello`, no client FRAME signals a close — it is a transport-level event: Cloudflare's
   * `webSocketClose`, Node's `ws` `'close'` listener). Task 8 (adapters, not built yet) calls this
   * AFTER removing `conn` from `Connections` (matching `FakeConnections.close`'s own "delete from
   * `registered` before returning" ordering, which `test/helpers/fake-connections.ts` already
   * does) — `buildPresenceMembers`'s `online` flag reads ONLY live connections via
   * `Connections.byTag`, so calling this before the adapter has actually removed the connection
   * would report a just-closed socket as still online for one broadcast.
   *
   * Returns the same `Promise<void>` `triggerPresence` does (see its doc comment for exactly what
   * that promise does and doesn't wait for) — an adapter's own close handler is free to ignore it
   * (`void actor.onConnectionClosed(conn)`, matching Cloudflare's synchronous `webSocketClose`
   * signature) or await it; tests await it for determinism.
   */
  onConnectionClosed(_conn: Conn): Promise<void> {
    return this.triggerPresence();
  }

  /**
   * Leading+trailing throttle (task-5-brief item 5: "throttled ≥1 per 5 s (trailing send so the
   * last change isn't lost); injectable clock for tests"). First trigger in a fresh 5 s window
   * sends immediately (leading edge — a lone connect/close is never delayed) and returns the
   * `broadcastPresence()` promise itself, so `hello`'s `await this.triggerPresence()` genuinely
   * waits for that immediate send to complete (fixing a real race: without awaiting it here, the
   * fire-and-forget send could still be pending microtasks when `hello()` — and the caller
   * awaiting it — returned, so a test asserting "exactly one `members` frame after `hello`" could
   * observe zero). Any FURTHER trigger within the window schedules AT MOST one trailing call for
   * when the window elapses (a resolved no-op promise — deliberately NOT awaited by callers, since
   * a real `setTimeout` should never block `hello`/`onConnectionClosed`); extra triggers while one
   * is already scheduled are no-ops on the SCHEDULING side, but never lose information —
   * `broadcastPresence` recomputes the member list from LIVE state when the timer actually fires,
   * so whatever the roster looks like at that moment (not at scheduling time) is what gets sent,
   * which is exactly "the last change isn't lost" without needing to cancel/reschedule a timer on
   * every intermediate trigger.
   */
  private triggerPresence(): Promise<void> {
    const now = this.now();
    const elapsed = now - this.presenceLastSentAt;
    if (elapsed >= PRESENCE_THROTTLE_MS) {
      this.presenceLastSentAt = now;
      return this.broadcastPresence();
    }
    if (this.presenceTrailingTimer === undefined) {
      this.presenceTrailingTimer = this.setTimer(() => {
        this.presenceTrailingTimer = undefined;
        this.presenceLastSentAt = this.now();
        void this.broadcastPresence();
      }, PRESENCE_THROTTLE_MS - elapsed);
    }
    return Promise.resolve();
  }

  private async broadcastPresence(): Promise<void> {
    const members = await this.buildPresenceMembers();
    const frame: MembersMsg = { t: 'members', members };
    for (const conn of this.connections.all()) this.connections.send(conn, frame);
  }

  /** Builds the `[{userId, displayName, role, online}]` roster (doc-03's presence-snapshot shape,
   * `MembersMsgSchema`) from `meta.members` plus a synthesized DM entry, since `meta.members`
   * (design ruling 3) only ever gains entries via `member.joined`/`member.renamed` — events the DM
   * never sends about themselves unless they also call `member.renamed` on their own account.
   *
   * KNOWN LIMITATION (documented per this task's brief, not silently papered over): this actor has
   * no `Db` port (doc-10's port table: `CampaignActor` gets `StreamStore` + `Connections` +
   * `quotas` + `permissions` only), so there is no username lookup available for a DM who has
   * never renamed themselves — the userId itself is used as a display-name fallback. A richer
   * WS-handoff attachment (carrying a resolved display name from D1, the way `role`/`userId`
   * already are) is the natural fix; it did not exist to build on as of this task (Task 4's WS
   * route is not built yet) and is flagged here rather than invented speculatively. */
  private async buildPresenceMembers(): Promise<MembersMsg['members']> {
    const meta = await this.getCampaignMeta();
    const roster = new Map<string, { displayName: string; role: 'dm' | 'member' }>();
    for (const [userId, member] of meta.members) {
      roster.set(userId, { displayName: member.displayName, role: member.role === 'dm' ? 'dm' : 'member' });
    }
    if (meta.dmId !== undefined) {
      const existing = roster.get(meta.dmId);
      roster.set(meta.dmId, { displayName: existing?.displayName ?? meta.dmId, role: 'dm' });
    }
    return [...roster.entries()].map(([userId, entry]) => ({
      userId,
      displayName: entry.displayName,
      role: entry.role,
      online: this.connections.byTag(userId).length > 0,
    }));
  }

  /**
   * Read-visibility filtering — doc-08 §Authorization matrix "Filtering on read" paragraph,
   * verbatim: `dm.note_*` never reaches a non-DM connection; `roll.logged` with `visibility: 'dm'`
   * reaches DM connections AND the roller's own connections (matched by `userId`, so a player
   * sees their OWN dm-visibility rolls); `visibility: 'private'` reaches the roller only.
   * "everything else passes" (task-5-brief item 4, verbatim) — notably `chat.message` ALSO carries
   * a `visibility` field (`ChatMessageV1`, `campaign.ts`) but doc-08's filtering paragraph does not
   * mention `chat.message` at all, only `roll.logged` — so that field is stored and relayed
   * as-is, unfiltered, exactly as written here; this is a real finding (doc-08 defines the field
   * without stating server-side filtering for it), recorded in task-5-report.md, not a shortcut.
   *
   * Overridden here (design ruling R-pf3), not by editing `StreamActor`'s own identity default —
   * used by BOTH `fanOut` (live delivery) and `hello`'s catch-up paging, both inherited unchanged
   * from `StreamActor`, which now calls this hook from both places (`stream-actor.ts`'s `hello`
   * fix, this task's own catch-up-filtering finding).
   */
  protected override filterForConnection(events: Event[], conn: Conn): Event[] {
    const attachment = this.connections.getAttachment(conn);
    return events.filter((event) => this.isVisibleTo(event, attachment));
  }

  private isVisibleTo(event: Event, attachment: ConnAttachment): boolean {
    if (event.type === 'dm.note_added' || event.type === 'dm.note_updated' || event.type === 'dm.note_removed') {
      return attachment.role === 'dm';
    }
    if (event.type === 'roll.logged') {
      const visibility = readStringField(event.payload, 'visibility');
      if (visibility === 'dm') return attachment.role === 'dm' || attachment.userId === event.actor.userId;
      if (visibility === 'private') return attachment.userId === event.actor.userId;
      return true; // 'everyone' (or an unrecognized value — fail OPEN here; schema validation at
      // append time is what guarantees `visibility` is one of the three enum values in practice).
    }
    return true;
  }

  /**
   * `subscribe`/`unsubscribe` dispatch (task-5-brief item 6): attachment bookkeeping ONLY — the
   * actual char-stream event RELAY (forwarding a subscribed character's events to this campaign
   * connection) is Task 6's `Rpc`/gateway work, not built yet. Every OTHER message type is
   * forwarded to `StreamActor.handleMessage` unchanged (append/hello/blob frames/presence — the base
   * class's own dispatch already handles `hello`/`append` correctly via virtual dispatch to this
   * class's own overrides, and Phase-3 no-ops the rest per its own documented stance).
   *
   * Re-parses `raw` once more inside `super.handleMessage` for every non-subscribe message rather
   * than threading the already-parsed message through a second entry point — `parseClientMessage`
   * is a cheap, pure Zod parse (no I/O), and keeping `StreamActor.handleMessage`'s own signature
   * untouched (still `(conn, raw)`, no new overload) is worth the small duplicated parse.
   */
  override async handleMessage(conn: Conn, raw: unknown): Promise<void> {
    const parsed = parseClientMessage(raw);
    if (parsed.ok && parsed.message.t === 'subscribe') {
      await this.handleSubscribe(conn, parsed.message);
      return;
    }
    if (parsed.ok && parsed.message.t === 'unsubscribe') {
      this.handleUnsubscribe(conn, parsed.message);
      return;
    }
    await super.handleMessage(conn, raw);
  }

  /**
   * Validates the subscriber is this campaign's DM or the target character's own owner (per live
   * `meta.characters`), then records `msg.stream` on the connection's `subs` list. Silently
   * ignored (no reply, no close) when invalid: `subscribe` carries no `rid` (doc-03's client->server
   * frame shapes have no subscribe-ack), so there is no reject frame to answer an unauthorized
   * request with, and closing the socket over a well-formed-but-not-yet-authorized request (e.g. a
   * member's own client eagerly subscribing to a character it turns out it doesn't own) would be
   * needlessly hostile — matches `StreamActor.handleMessage`'s own stance on schema-valid-but-not-
   * actionable Phase-3 message types.
   */
  private async handleSubscribe(conn: Conn, msg: SubscribeMsg): Promise<void> {
    if (!msg.stream.startsWith('char:')) return; // a campaign socket only ever subscribes to a char: stream
    const characterId = msg.stream.slice('char:'.length);
    const attachment = this.connections.getAttachment(conn);
    const meta = await this.getCampaignMeta();
    const ownerId = meta.characters.get(characterId);
    const authorized = attachment.role === 'dm' || (ownerId !== undefined && ownerId === attachment.userId);
    if (!authorized) return;
    if (attachment.subs.includes(msg.stream)) return;
    this.connections.setAttachment(conn, { ...attachment, subs: [...attachment.subs, msg.stream] });
  }

  private handleUnsubscribe(conn: Conn, msg: UnsubscribeMsg): void {
    const attachment = this.connections.getAttachment(conn);
    this.connections.setAttachment(conn, { ...attachment, subs: attachment.subs.filter((s) => s !== msg.stream) });
  }
}
