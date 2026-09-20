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
import type { RpcAppendOutcome } from '../../ports/infra.ts';
import * as quotasModule from '../quotas.ts';
import {
  type AckResult,
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

/** [plan-9 Task 6] `subscribe`'s catch-up paging size — same number as `stream-actor.ts`'s own
 * `CATCH_UP_PAGE_SIZE` (doc-03 §Catch-up performance: "the DO pages 200 events per frame"), kept
 * as its own local constant rather than importing that file's `private`/module-scoped one, since
 * `sendSubscribeCatchUp` pages a DIFFERENT stream's history (a `char:` target via `Rpc.readStream`,
 * not this actor's own `StreamStore`) through a structurally similar but independent loop. */
const SUBSCRIBE_CATCH_UP_PAGE_SIZE = 200;

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
   * `CharacterActor.append`'s own shape) to add everything `StreamActor`'s generic single-stream
   * pipeline cannot express on its own: (0) [plan-9 Task 6] ROUTING every event by its OWN
   * `.stream` field to either this campaign's own local pipeline or a `char:` GATEWAY forward
   * (`routeByTargetStream` below — doc-03 §Gateway/§Ordering); (1) per-event permission REFINEMENT
   * beyond the static `EVENT_ACTORS` table (`refineAppendPermission`) — checked BEFORE
   * `super.append`, so a refused event never reaches schema validation/dedupe/quota at all; (1b)
   * [plan-9 Task 6] cross-stream MIRROR VERIFICATION for `campaign.character_joined`/`_left`
   * (`verifyCharacterMirror`); (2) the two per-append COUNT quotas (`member.joined` at 12,
   * `pack.enabled` at 6) that `quotas.ts`'s generic byte/event-count machinery cannot express (see
   * `quotas.ts`'s `CAMPAIGN_BYTES_MAX` doc comment); (3) meta maintenance from whatever
   * `super.append` actually committed.
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

    const { localEvents, forwardGroups, routingRejected } = this.routeByTargetStream(events);

    const meta = await this.getCampaignMeta();
    const passed: Event[] = [];
    const preRejected: RejectResult[] = [...routingRejected];
    let membersCount = meta.members.size;
    let packsCount = meta.packs.length;

    for (const event of localEvents) {
      const refusal = this.refineAppendPermission(event, actor, meta);
      if (refusal) {
        preRejected.push({ id: event.id, code: refusal.code, message: refusal.message });
        continue;
      }

      if (event.type === 'campaign.character_joined' || event.type === 'campaign.character_left') {
        const verified = await this.verifyCharacterMirror(event);
        if (!verified) {
          const mirrorType =
            event.type === 'campaign.character_joined' ? 'character.campaign_joined' : 'character.campaign_left';
          preRejected.push({
            id: event.id,
            code: 'invalid',
            message: `event.invalid: ${event.type} requires the matching ${mirrorType} event on the character's own stream (RPC verify) — no half-join`,
          });
          continue;
        }
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
    const forwarded = await this.forwardGroupsToCharacterStreams(forwardGroups, actor, meta);
    const outcome: AppendOutcome = {
      acked: [...base.acked, ...forwarded.acked],
      rejected: [...base.rejected, ...preRejected, ...forwarded.rejected],
    };
    await this.applyMetaHooks(events, outcome, actor);
    return outcome;
  }

  /**
   * [plan-9 Task 6] Splits `events` into this campaign's own LOCAL pipeline vs. `char:` GATEWAY
   * forward groups, by each event's OWN `.stream` field — doc-03's `append` row: "each event names
   * its stream". Also enforces doc-03 §Ordering's single-stream `txId` rule up front: "events
   * sharing a `txId` are appended in one `append` ... single-stream only — a level-up never spans
   * streams" — a `txId` whose members target MORE THAN ONE distinct stream (this campaign's own
   * PLUS one-or-more `char:` targets, or two different `char:` targets) is rejected `invalid` in
   * its entirety here, before either the local pipeline or any gateway forward ever sees it (a
   * partial forward of half a transaction, with the other half committed locally, is exactly the
   * "half-join"-shaped bug this rule exists to prevent).
   *
   * An event whose `.stream` is neither this campaign's own stream nor a `char:<uuid>` id (a
   * different `camp:` id entirely, or a malformed value that still passed `StreamIdSchema`) is
   * rejected `invalid` outright: this campaign's gateway only ever forwards to CHARACTER streams
   * (doc-03 §Gateway: "campaign sockets may carry append frames whose events target char: streams")
   * — nothing in doc-02/doc-03 describes one campaign's socket reaching a DIFFERENT campaign's
   * stream, so that shape is simply not a supported target here, not silently accepted/dropped.
   */
  private routeByTargetStream(events: readonly Event[]): {
    readonly localEvents: Event[];
    readonly forwardGroups: Map<string, Event[]>;
    readonly routingRejected: RejectResult[];
  } {
    const txTargets = new Map<string, Set<string>>();
    for (const event of events) {
      if (!event.txId) continue;
      const set = txTargets.get(event.txId) ?? new Set<string>();
      set.add(event.stream);
      txTargets.set(event.txId, set);
    }
    const crossStreamTxIds = new Set(
      [...txTargets.entries()].filter(([, targets]) => targets.size > 1).map(([txId]) => txId),
    );

    const localEvents: Event[] = [];
    const forwardGroups = new Map<string, Event[]>();
    const routingRejected: RejectResult[] = [];

    for (const event of events) {
      if (event.txId && crossStreamTxIds.has(event.txId)) {
        routingRejected.push({
          id: event.id,
          code: 'invalid',
          message: `event.txGroupInvalid: txId ${event.txId} spans more than one stream (doc-03 §Ordering: single-stream only)`,
        });
        continue;
      }
      if (event.stream === this.streamId) {
        localEvents.push(event);
      } else if (event.stream.startsWith('char:')) {
        const group = forwardGroups.get(event.stream) ?? [];
        group.push(event);
        forwardGroups.set(event.stream, group);
      } else {
        routingRejected.push({
          id: event.id,
          code: 'invalid',
          message: `event.invalid: a campaign socket may only append to this campaign's own stream or a char: stream, not ${event.stream}`,
        });
      }
    }
    return { localEvents, forwardGroups, routingRejected };
  }

  /**
   * [plan-9 Task 6] THE GATEWAY (doc-03 §Permission enforcement point / Global Constraints
   * "Gateway" bullet): forwards each `char:`-targeted group to its own stream via
   * `Rpc.forwardAppend`, with the actor mapped per design ruling 1 (`mapGatewayActor`). A group
   * whose actor cannot be mapped (neither this campaign's own DM acting on a character JOINED to
   * THIS campaign, nor the target character's own established-member owner) is rejected
   * `forbidden` for EVERY event in that group WITHOUT ever calling `Rpc.forwardAppend` — the
   * campaign gateway is the FIRST enforcement point; nothing about an unmapped sender is forwarded
   * for the target stream's own pipeline to re-check. Acks/rejects the target stream's own
   * `append` pipeline returns are relayed back VERBATIM (doc-03: "acks/rejects relayed to the
   * campaign socket") — merged into this campaign's own `AppendOutcome` by the caller, so they
   * ride the SAME `rid`'s `ack`/`reject` frame as any locally-appended event in the same client
   * `append` message.
   *
   * [fix round 1, Important 3 — cross-tenant forged mirror] `character.campaign_joined`/
   * `character.campaign_left` are the CHAR-side halves of the cross-stream mirror (doc-03) and,
   * structurally, are just ordinary `char:`-targeted events like any other — nothing in
   * `routeByTargetStream`/`mapGatewayActor` distinguishes them. That is a real forgery path: THIS
   * campaign's own DM (a genuine, correctly-mapped `dm` actor for a character genuinely joined to
   * THIS campaign — fix round 1's Critical 1 already narrowed `mapGatewayActor`'s `dm` branch to
   * require exactly that) could otherwise forward a `character.campaign_joined`/`_left` event
   * whose PAYLOAD names a COMPLETELY DIFFERENT campaign's id — silently re-pointing the character's
   * `meta.campaignId` to a campaign this DM has no authority over, or forging a "left" record a
   * foreign campaign's own later mirror-verify (`verifyCharacterMirror`'s `hasEvent` check) would
   * then trust. `isValidForwardedMirrorPayload` closes this: for exactly these two types, the
   * payload's OWN `campaignId` field must equal THIS campaign's own id — anything else is rejected
   * `invalid` (a payload-shape problem, not a permission one — checked BEFORE `mapGatewayActor`,
   * so it applies uniformly regardless of who is forwarding) and is never forwarded. This does not
   * touch the ordinary, legitimate flow at all: `character.campaign_joined/_left` are normally
   * appended DIRECTLY on the character's own socket (the owner's device), never via this gateway —
   * this check only ever fires on the abuse path.
   */
  private async forwardGroupsToCharacterStreams(
    groups: ReadonlyMap<string, Event[]>,
    actor: Actor,
    meta: CampaignMeta,
  ): Promise<RpcAppendOutcome> {
    const acked: AckResult[] = [];
    const rejected: RejectResult[] = [];
    for (const [targetStream, groupEvents] of groups) {
      const characterId = targetStream.slice('char:'.length);

      const forwardable: Event[] = [];
      for (const event of groupEvents) {
        if (this.isValidForwardedMirrorPayload(event)) {
          forwardable.push(event);
          continue;
        }
        rejected.push({
          id: event.id,
          code: 'invalid',
          message: `event.invalid: ${event.type} forwarded through this campaign's gateway must carry THIS campaign's own id as payload.campaignId`,
        });
      }
      if (forwardable.length === 0) continue;

      const forwardActor = this.mapGatewayActor(actor, characterId, meta);
      if (!forwardActor) {
        for (const event of forwardable) {
          rejected.push({
            id: event.id,
            code: 'forbidden',
            message: `event.forbidden: ${actor.userId} may not append to ${targetStream} through this campaign (not this campaign's dm acting on a character joined to this campaign, and not that character's own established-member owner)`,
          });
        }
        continue;
      }
      const result = await this.rpc.forwardAppend(targetStream, forwardable, forwardActor);
      acked.push(...result.acked);
      rejected.push(...result.rejected);
    }
    return { acked, rejected };
  }

  /** [fix round 1, Important 3] See `forwardGroupsToCharacterStreams`'s doc comment. Non-mirror
   * event types are untouched (always `true`) — this guard is scoped exactly to the two types
   * whose payload names a campaign at all. `campaignId` is read defensively (`readStringField`):
   * an unreadable one is treated as INVALID here (`false`) rather than falling through, since (a)
   * `character.campaign_joined/_left`'s schema REQUIRES `campaignId` (unlike `characterId`
   * elsewhere in this file, there is no legitimate reason a well-formed instance of exactly these
   * two types would lack it), so an unreadable value already means "not this campaign's own id"
   * either way, and (b) failing closed here is the correct default for a forgery-prevention check. */
  private isValidForwardedMirrorPayload(event: Event): boolean {
    if (event.type !== 'character.campaign_joined' && event.type !== 'character.campaign_left') return true;
    const campaignId = readStringField(event.payload, 'campaignId');
    return campaignId === this.streamId.slice('camp:'.length);
  }

  /**
   * [plan-9 Task 6] Design ruling 1's role mapping (plan verbatim): "gateway-forwarded char-stream
   * actor role = `dm` when the sender is the campaign's DM, else `owner` IF the target character's
   * `meta.ownerId == sender userId` (a member acting on their OWN character through the campaign
   * socket) else REJECT forbidden." The forwarded actor is NEVER the raw campaign-socket actor.
   *
   * OWNERSHIP IS CHECKED FIRST (order matters — see PREGEN note below), then the `dm` mapping:
   *   - `owner`: the sender is an ESTABLISHED member of THIS campaign (`meta.members.has`, defense
   *     in depth: a WS-handoff bug that stamped a non-member with `role: 'member'` still can't
   *     forward through a character it happens to guess the id of) AND the TARGET character has
   *     actually joined THIS campaign with THAT sender as its owner
   *     (`meta.characters.get(characterId) === actor.userId`).
   *   - `dm`: genuinely being THIS campaign's OWN dm (`actor.userId === meta.dmId`, the same
   *     live-meta check `refineAppendPermission`'s `DM_ONLY_TYPES` guard uses — not merely
   *     `actor.role === 'dm'` from a stale/incorrect handoff) [fix round 1, Critical 1] AND the
   *     target character has actually JOINED THIS campaign (`meta.characters.has(characterId)`).
   *     Before this fix, the `dm` branch had NO character-scoping at all — this campaign's DM
   *     could gateway-forward a `dm.*`-class event to ANY character in the entire system, joined
   *     to this campaign or not (or joined to a completely different one). Red-first: a foreign
   *     campaign's DM forwarding `hp.changed` to a character never joined to THEIR campaign is now
   *     rejected `forbidden`, nothing forwarded (`campaign-gateway.test.ts`).
   *
   * PREGEN NOTE (fix round 1, spec'd per review): a DM-OWNED pregen — joined to this campaign with
   * `meta.characters.get(characterId) === meta.dmId` (the DM is, structurally, also always an
   * established member of their own campaign per Task 4's bootstrap `member.joined`) — matches the
   * OWNERSHIP branch FIRST and maps to `owner`, NOT `dm`. This is deliberate, not incidental: doc-08's
   * "Append DM events" row already grants `owner` role "solo/self" rights over `dm.*`-class events
   * on their OWN character (`EVENT_ACTORS['hp.changed'] = ['owner','dm']`, etc.) — mapping the
   * DM's own pregen to `owner` therefore grants it BOTH owner-class AND dm-class permissions
   * (exactly like an ordinary player's character), whereas mapping it to `dm` would WRONGLY refuse
   * every owner-class event on that same pregen (`EVENT_ACTORS` never grants `dm` those types —
   * e.g. `character.archived` is owner-only). Checking ownership before the `dm` branch is what
   * makes this fall out correctly without a separate pregen special-case.
   *
   * Returns `undefined` — never throws — for anything else, so the caller can reject `forbidden`
   * WITHOUT calling `Rpc.forwardAppend` at all (doc-03: the campaign is the FIRST enforcement
   * point; the target character stream's own pipeline re-checks independently regardless, via
   * `CharacterActor.append`'s owner-role gate + `permissions.allowed` — defense in depth, not the
   * only gate).
   */
  private mapGatewayActor(actor: Actor, characterId: string, meta: CampaignMeta): Actor | undefined {
    const ownerId = meta.characters.get(characterId);
    if (meta.members.has(actor.userId) && ownerId !== undefined && ownerId === actor.userId) {
      return { userId: actor.userId, role: 'owner' };
    }
    if (
      actor.role === 'dm' &&
      meta.dmId !== undefined &&
      actor.userId === meta.dmId &&
      meta.characters.has(characterId)
    ) {
      return { userId: actor.userId, role: 'dm' };
    }
    return undefined;
  }

  /**
   * [plan-9 Task 6] Cross-stream MIRROR VERIFICATION (doc-03 §Ordering and commit rules, verbatim:
   * "the DO for the campaign verifies the character event exists before accepting the mirror (RPC
   * read), so a half-join is not possible") — called only for `campaign.character_joined`/
   * `campaign.character_left`, and only AFTER `refineAppendPermission`'s ownership check already
   * passed (so a non-owner/non-dm sender is still rejected `forbidden` first, never reaching an
   * RPC call it has no business making — see the two existing ownership tests this preserves).
   * `event.payload.characterId` is read DEFENSIVELY (`readStringField`, same stance as every other
   * pre-`super.append` check in this file): an unreadable `characterId` is treated as VERIFIED
   * here (returns `true`) so the event falls through to `super.append`'s own schema validation,
   * which reports the real problem (`invalid`, "missing/malformed characterId") instead of this
   * method's own, misleading "mirror not found" message.
   *
   * [fix round 1, Critical 4 — mirror CURRENCY, not just historical existence] A plain
   * `Rpc.hasEvent` check (still used below, for LEFT) only proves a matching event EXISTS
   * SOMEWHERE in the character's history — events are immutable and never removed, so that stays
   * true FOREVER once committed. That is stale for a JOIN check: `character.campaign_joined`
   * followed later by a genuine `character.campaign_left` leaves the OLD join event sitting in
   * history forever; a REPLAYED (or forged) `campaign.character_joined` after the real leave would
   * still `hasEvent`-verify against that stale record and incorrectly re-add the character to this
   * campaign's roster. `Rpc.currentCampaignOf` (new this fix round) reads the character's LIVE
   * `meta.campaignId` instead — not a history scan — so JOIN verification now requires the
   * character's CURRENT link to genuinely BE this campaign RIGHT NOW, which a stale/replayed join
   * cannot satisfy once a real leave has cleared it. (This subsumes the old `hasEvent` check for
   * JOIN — a current link to this campaign can only exist because a real matching join event
   * committed — so `hasEvent` is no longer called for the JOIN branch at all.)
   *
   * LEFT semantics are NOT the mirror-image of JOIN's, and are spec'd here explicitly (fix round 1
   * review: "think through and document the left semantics"): by the time a campaign-side
   * `campaign.character_left` reaches this check, the char-side `character.campaign_left` has
   * ALREADY committed (doc-03: the campaign verifies the character event EXISTS before accepting
   * the mirror — i.e. char-side first) — which means `CharacterActor`'s own hook has ALREADY
   * cleared `meta.campaignId` by the time this runs. Requiring `current === thisCampaign` for LEFT
   * would therefore NEVER pass for a genuine, ordinary leave — that cannot be the check. The
   * correct DUAL guarantee for LEFT is `current !== thisCampaign`: this still accepts the ordinary
   * post-clear state (`current === undefined`) while rejecting a STALE `campaign.character_left`
   * replayed AFTER the character has since REJOINED this SAME campaign (`current === thisCampaign`
   * again) — a case that must not be allowed to spuriously de-list an actively-linked character.
   * `hasEvent` is STILL required alongside it for LEFT (unlike JOIN): `current !== thisCampaign` is
   * true for a character that never joined this campaign AT ALL just as much as for one that
   * genuinely left it, so `hasEvent` is what confirms a real leave-from-THIS-campaign record
   * actually exists before accepting the removal.
   */
  private async verifyCharacterMirror(event: Event): Promise<boolean> {
    const characterId = readStringField(event.payload, 'characterId');
    if (characterId === undefined) return true;
    const charStream = `char:${characterId}`;
    const thisCampaignId = this.streamId.slice('camp:'.length);

    if (event.type === 'campaign.character_joined') {
      const current = await this.rpc.currentCampaignOf(charStream);
      return current === thisCampaignId;
    }

    const historyOk = await this.rpc.hasEvent(charStream, {
      type: 'character.campaign_left',
      campaignId: thisCampaignId,
    });
    if (!historyOk) return false;
    const current = await this.rpc.currentCampaignOf(charStream);
    return current !== thisCampaignId;
  }

  /**
   * Per-append permission refinements the static `EVENT_ACTORS` table (`campaign-permissions.ts`)
   * cannot express — task-5-brief item 2, each bullet implemented as its own guard:
   *
   *   (a) a `member`-role actor must actually BE a member of THIS campaign per live meta — except
   *       `member.joined` itself, which is how membership is ESTABLISHED (the joiner cannot
   *       already be in `meta.members` when they send it; excluding it is not a loophole, it is
   *       the only way this event could ever succeed).
   *   (a2) [fix round 1, Critical 2] `member.joined`/`member.left` require
   *       `payload.userId === actor.userId`, with NO exemption for ANY role. Without this, an
   *       established member could admit an ARBITRARY userId via `member.joined` (bypassing the
   *       join-code gate entirely) or evict another member via `member.left` (an eviction path
   *       that was supposed to belong only to the DM-gated `member.removed` sibling —
   *       `member.left` is "I am leaving", never "I am removing someone else"). No role exemption
   *       because self-binding is what makes `member.joined` safe to grant BOTH `'member'` and
   *       `'dm'` in the static table (plan-9 Task 4 fix round 1, `campaign.ts`'s
   *       `CAMPAIGN_EVENT_ACTORS` — the DM's own client authors it, in the 'dm' capacity, to
   *       bootstrap the DM's own membership row alongside `campaign.created`, `core/routes/
   *       campaigns.ts`'s create route): this guard is what still prevents a DM (or anyone else)
   *       admitting/evicting a DIFFERENT userId via either type — a join/leave always originates
   *       from the acting user's own client, about themselves, whichever role authored it, and
   *       DM-driven removal of someone ELSE is `member.removed` (a separate, already dm-gated type
   *       in `DM_ONLY_TYPES` below) — never `member.left`.
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
   *       half ONLY while `meta.dmId` is still unset — see (e).
   *   (e) [fix round 1, Critical 1] `campaign.created` itself is rejected once `meta.dmId` is
   *       ALREADY set — the original exemption was keyed on the event TYPE ("campaign.created is
   *       always exempt from the dmId check"), not on whether a campaign had actually been
   *       established yet. That let a SECOND `campaign.created` on an already-created stream
   *       (from the real DM re-sending it, or from a different dm-role actor entirely) pass
   *       straight through `DM_ONLY_TYPES`'s dmId check and reach `applyMetaHooks`, which
   *       unconditionally reassigns `dmId` and RESETS `settings` back to the fresh-campaign
   *       defaults — silently wiping every `campaign.settings_changed` the DM had made. Rejected
   *       `forbidden` (not `invalid`): the payload itself is perfectly schema-valid: it is the
   *       STATE — a campaign that already exists — that makes re-creating it impermissible,
   *       matching how every other refinement in this method signals "not schema-invalid, just
   *       not allowed" with `forbidden`.
   */
  private refineAppendPermission(
    event: Event,
    actor: Actor,
    meta: CampaignMeta,
  ): { readonly code: 'forbidden'; readonly message: string } | undefined {
    if (actor.role === 'member' && event.type !== 'member.joined' && !meta.members.has(actor.userId)) {
      return { code: 'forbidden', message: `event.forbidden: ${actor.userId} is not a member of this campaign` };
    }

    if (event.type === 'member.joined' || event.type === 'member.left') {
      const userId = readStringField(event.payload, 'userId');
      if (userId !== undefined && userId !== actor.userId) {
        return {
          code: 'forbidden',
          message: `event.forbidden: ${event.type} requires payload.userId to match the acting user (self-only)`,
        };
      }
    }

    if (event.type === 'campaign.created' && meta.dmId !== undefined) {
      return {
        code: 'forbidden',
        message:
          'event.forbidden: campaign.created requires a stream with no established dm (this campaign already exists)',
      };
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
   * Read-visibility filtering — doc-08 §Authorization matrix "Filtering on read" paragraph:
   * `dm.note_*` never reaches a non-DM connection; `roll.logged`/`chat.message` with
   * `visibility: 'dm'` reach DM connections AND the sender's own connections (matched by
   * `userId`, so a player sees their OWN dm-visibility rolls/messages); `visibility: 'private'`
   * reaches the sender only. Everything else passes unfiltered.
   *
   * [fix round 1, Adjudicated 3] `chat.message` is now filtered by the SAME everyone/dm/private
   * branch as `roll.logged` — task-5-report.md's original finding (doc-08's own prose named only
   * `roll.logged`, even though `ChatMessageV1` carries the identical `visibility` enum) was
   * reviewed and the controller/reviewer AGREED the omission was a doc-08 gap, not intended
   * behavior: a `visibility: 'private'`/`'dm'` chat message is meaningless if the server still
   * broadcasts it to every connection regardless. `docs/02-architecture/08-security-permissions-
   * quotas.md`'s filtering paragraph is updated (one line) to name `chat.message` alongside
   * `roll.logged` — doc-08 is an architecture doc, not an ADR (ADRs are never edited; this file
   * is), so this is a spec clarification, not a violation of that rule; flagged in the fix-round
   * commit body/report per the adjudication for the owner's visibility.
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
    if (event.type === 'roll.logged' || event.type === 'chat.message') {
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
   * `meta.characters`), records `msg.stream` on the connection's `subs` list (idempotent — a
   * repeat subscribe doesn't grow it), then [plan-9 Task 6] serves CATCH-UP for `msg.lastSeq` via
   * `sendSubscribeCatchUp` — doc-03: `subscribe {stream, lastSeq?}`. Catch-up runs on EVERY
   * authorized subscribe call, even a repeat one (not gated behind "first time only"): a client
   * may deliberately resubscribe specifically to ask for anything committed since its own last-
   * known `lastSeq`, the same way `hello`'s own `streams[].lastSeq` works.
   *
   * Silently ignored (no reply, no close, no catch-up) when UNAUTHORIZED: `subscribe` carries no
   * `rid` (doc-03's client->server frame shapes have no subscribe-ack), so there is no reject frame
   * to answer an unauthorized request with, and closing the socket over a well-formed-but-not-yet-
   * authorized request (e.g. a member's own client eagerly subscribing to a character it turns out
   * it doesn't own) would be needlessly hostile — matches `StreamActor.handleMessage`'s own stance
   * on schema-valid-but-not-actionable Phase-3 message types.
   *
   * LIVE relay note (deliverable 4's other half): subscribing does NOT change who receives this
   * character's events live — `handleNotify` below already delivers to every one of the DM's
   * connections and every one of the owner's OWN connections UNCONDITIONALLY (doc-08's "Read
   * character stream" row: Owner v, DM v, regardless of any subscription), and `subscribe` is
   * DM-or-owner-only by the `authorized` check just above — so a DM/owner connection that
   * subscribes was ALREADY receiving this character's live events before doing so, and continues
   * to after. `subs` (this method's bookkeeping) exists for a FUTURE narrower use (doc-03 lists it
   * as adapter-visible connection state) but `handleNotify`'s fan-out deliberately does not consult
   * it — see that method's own doc comment for why gating live delivery on subscription would be
   * WRONG here (it would let a DM who forgets to subscribe miss events the authorization matrix
   * already promises them).
   *
   * [fix round 1, Critical 2] The `dm` branch of `authorized` is now scoped to a character JOINED
   * to THIS campaign — `isJoinedToThisCampaign` (`ownerId !== undefined`, the same live
   * `meta.characters` lookup the `member`-owner branch already used). Before this fix, ANY DM
   * could subscribe to (and catch up on, via `sendSubscribeCatchUp`) ANY character stream in the
   * entire system merely by knowing/guessing its id — the character never needed to have anything
   * to do with that DM's campaign at all. This mirrors `mapGatewayActor`'s identical Critical-1 fix
   * for the WRITE side (fix round 1) — a DM's authority is scoped to THIS campaign's own roster,
   * never global.
   */
  private async handleSubscribe(conn: Conn, msg: SubscribeMsg): Promise<void> {
    if (!msg.stream.startsWith('char:')) return; // a campaign socket only ever subscribes to a char: stream
    const characterId = msg.stream.slice('char:'.length);
    const attachment = this.connections.getAttachment(conn);
    const meta = await this.getCampaignMeta();
    const ownerId = meta.characters.get(characterId);
    const isJoinedToThisCampaign = ownerId !== undefined;
    const authorized =
      (attachment.role === 'dm' && isJoinedToThisCampaign) || (isJoinedToThisCampaign && ownerId === attachment.userId);
    if (!authorized) return;
    if (!attachment.subs.includes(msg.stream)) {
      this.connections.setAttachment(conn, { ...attachment, subs: [...attachment.subs, msg.stream] });
    }
    await this.sendSubscribeCatchUp(conn, msg);
  }

  /**
   * [plan-9 Task 6] Pages `msg.stream`'s (a `char:<uuid>`) own committed history, from
   * `(msg.lastSeq ?? 0) + 1`, to `conn` as `events` frames — via `Rpc.readStream` (the SAME
   * cross-DO/in-process read `verifyCharacterMirror` above uses `Rpc.hasEvent` for, generalized to
   * the full page shape). Mirrors `StreamActor.hello`'s own catch-up loop (`stream-actor.ts`) in
   * page size and "stop once a short/empty page comes back" termination, but does NOT run pages
   * through `filterForConnection`: that hook filters CAMPAIGN-stream event types (`dm.note_*`,
   * `roll.logged`/`chat.message` visibility) which a CHARACTER stream never carries — every
   * connection authorized to reach this method (this method's own `authorized` check, just above
   * its call site) is already either this campaign's DM or the target character's own owner, and
   * doc-08's authorization matrix grants BOTH of those roles unfiltered read access to a character
   * stream ("Read character stream | Owner v | DM v | ..."), so there is nothing left to filter.
   */
  private async sendSubscribeCatchUp(conn: Conn, msg: SubscribeMsg): Promise<void> {
    let from = (msg.lastSeq ?? 0) + 1;
    for (;;) {
      const page = await this.rpc.readStream(msg.stream, from, SUBSCRIBE_CATCH_UP_PAGE_SIZE);
      if (page.length === 0) break;
      this.connections.send(conn, { t: 'events', stream: msg.stream, events: page });
      from += page.length;
      if (page.length < SUBSCRIBE_CATCH_UP_PAGE_SIZE) break; // last page
    }
  }

  private handleUnsubscribe(conn: Conn, msg: UnsubscribeMsg): void {
    const attachment = this.connections.getAttachment(conn);
    this.connections.setAttachment(conn, { ...attachment, subs: attachment.subs.filter((s) => s !== msg.stream) });
  }

  /**
   * [plan-9 Task 6, deliverable 3] The gateway's RECEIVING side — matches `ports/stream.ts`'s
   * `StreamHandle.notify(fromStream, events)` signature exactly (doc comment there: "delivers
   * events that were committed on another stream's handle to this one's connections"), so a real
   * adapter's `StreamHandle.notify` for THIS campaign's stream can delegate here directly (Task 8).
   * Called by `CharacterActor.notifyCampaignIfLinked` (via `Rpc.notify`) whenever a linked
   * character stream commits.
   *
   * FAN-OUT RULING for this task (settling the brief's own ambiguity, citing doc-08's
   * "Authorization matrix" table's "Read character stream" row verbatim: "Owner v | DM (of the
   * character's campaign) v | Member per `visibility.partySheets` (`full` only) | Other x"):
   *   - the DM: EVERY one of the DM's connections, always.
   *   - the character's own OWNER (`meta.characters.get(characterId) === attachment.userId`):
   *     EVERY one of the owner's own connections, always.
   *   - every OTHER established member's connections: ONLY when
   *     `meta.settings.visibility.partySheets === 'full'` — the doc-08 row's own qualifier.
   *   - anyone else (a member with a narrower `partySheets` setting, or a connection that is
   *     neither this campaign's DM nor an established member at all): nothing. They are expected
   *     to consume `party.overview_updated` instead (a deliberately opaque, DM/owner-controlled
   *     summary — design ruling 5), not this character's raw event stream.
   *
   * Not gated on `subs`/subscription state at all — see `handleSubscribe`'s own doc comment for
   * why doing so would be wrong (it would let a DM/owner who hasn't subscribed miss events the
   * authorization matrix unconditionally promises them).
   */
  async handleNotify(fromStream: string, events: readonly Event[]): Promise<void> {
    if (events.length === 0 || !fromStream.startsWith('char:')) return;
    const characterId = fromStream.slice('char:'.length);
    const meta = await this.getCampaignMeta();
    const ownerId = meta.characters.get(characterId);
    const partySheetsFull = meta.settings?.visibility.partySheets === 'full';
    const frame = { t: 'events' as const, stream: fromStream, events: [...events] };

    for (const conn of this.connections.all()) {
      const attachment = this.connections.getAttachment(conn);
      const isDm = attachment.role === 'dm';
      const isOwner = ownerId !== undefined && attachment.userId === ownerId;
      const isVisibleMember = !isDm && !isOwner && partySheetsFull && meta.members.has(attachment.userId);
      if (isDm || isOwner || isVisibleMember) this.connections.send(conn, frame);
    }
  }
}
