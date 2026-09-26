import type { Signal } from '@angular/core';
import type { Event } from '@hk/protocol';
import type { DraftEvent } from '../../stores/character.store';

/**
 * Ruling 4 (plan-10 task-7-brief.md, verbatim): "JOIN = (a) char socket
 * `character.campaign_joined {campaignId}` → ack, then (b) campaign socket
 * `campaign.character_joined {characterId, ownerId: self, name}` (server mirror-verifies (a)
 * committed). LEAVE = (a) char socket `character.campaign_left` FIRST, then (b) campaign
 * `campaign.character_left` (server requires char-side current ≠ this campaign). Partial states
 * are legal (recovery = retry (b)); the UI surfaces 'link incomplete — retry' on (b) rejects."
 *
 * This module is the reusable, transport-agnostic HALF of that sequencing — pure event-shape
 * builders plus a generic "append one draft, then wait for its own transition from pending to
 * committed (or its disappearance, i.e. a reject)" primitive. It knows nothing about dialogs,
 * routes, or i18n; `views/campaigns/link-character/*` and `shared/components/campaign-chip/*` are
 * the UI callers.
 *
 * ## Reuse note for Task 12 (pregen claiming)
 *
 * Task 12's claim flow shares this SAME event-catalog shape (a DM claims a pregen FOR a player —
 * still `character.campaign_joined` + `campaign.character_joined`, ruling 6 reusing ruling 4's
 * sequence per the plan's pre-flight scan), but its step (a) is very likely authored by the DM
 * through `CampaignStore.gatewayAppend` (doc-03's cross-stream forwarding — the DM isn't the
 * pregen's owner and can't load it into their own `CharacterStore`), NOT a local `appendTx`.
 * `gatewayAppend` already resolves with a real `AckOrReject` the moment the server answers — it
 * has NO local `events` signal to poll (gateway-forwarded events are never written to the
 * campaign's own Dexie rows — `campaign.store.ts`'s own class doc). That means:
 *   - `characterCampaignLinkDraft`/`campaignCharacterLinkDraft` (the pure payload builders) are
 *     directly reusable for BOTH flows — same event types, same payload shapes, regardless of
 *     transport.
 *   - `awaitEventSettled`/`appendAndAwaitAck` (the polling primitives) are reusable for step (b)
 *     in BOTH flows — Task 12's DM is still the one authoring `campaign.character_joined`
 *     directly on the campaign's OWN stream via `CampaignStore.appendTx`, exactly like this task's
 *     own member-join flow.
 *   - `runCampaignLinkSequence`/`retryCampaignLinkStepB` (the two-step ORCHESTRATOR) assume BOTH
 *     steps go through an `AppendablePort` (a local `appendTx` + `events` signal) — Task 12 should
 *     NOT reuse the orchestrator itself for step (a); it should call `characterCampaignLinkDraft`
 *     + `campaignStore.gatewayAppend(...)` directly for that half, then this module's
 *     `campaignCharacterLinkDraft` + `appendAndAwaitAck(campaignPort, ...)` for step (b) once (a)'s
 *     `AckOrReject` confirms the forwarded append committed.
 */

/** `'join'` builds `character.campaign_joined`/`campaign.character_joined`; `'leave'` builds
 * `character.campaign_left`/`campaign.character_left`. Both directions share the exact same
 * ordering (char-side (a) first, campaign-side (b) second) per ruling 4 — only the event TYPES
 * differ, never the sequencing. */
export type CampaignLinkAction = 'join' | 'leave';

/** The structural shape both `CharacterStore` and `CampaignStore` satisfy — an ordinary
 * (non-gateway) append plus the store's own live `events` signal. Declared here rather than
 * imported from either store so this module never depends on `stores/character.store.ts` or
 * `stores/campaign.store.ts` themselves (only the standalone `DraftEvent` type) — either store is
 * passed in as-is by its caller, no adapter needed (TypeScript structural typing). */
export interface AppendablePort {
  readonly events: Signal<Event[]>;
  appendTx(drafts: DraftEvent[]): Promise<void>;
}

/** `'committed'` — the event now carries a server-assigned `seq`. `'rejected'` — the event is no
 * longer present at all (`dropPending` removed it — a server `reject` frame). `'timeout'` — still
 * pending when `opts.timeoutMs` elapsed (offline, a slow reconnect, …) — NOT a hard failure, just
 * "give up waiting, let the caller decide" (doc-03 gives no bounded-time guarantee for a pending
 * append; the timeout exists so a UI never polls forever with no way to offer the user anything). */
export type LinkStepOutcome = 'committed' | 'rejected' | 'timeout';

export interface CampaignLinkAckOptions {
  /** How often to re-check `events()` while waiting. Default 25ms. */
  readonly pollMs?: number;
  /** How long to wait before resolving `'timeout'` instead of continuing to poll. Default 30s —
   * matches `CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS`'s own reconnect-cap rationale
   * (`campaign.store.ts`, fix round 1, F1b). */
  readonly timeoutMs?: number;
}

const DEFAULT_POLL_MS = 25;
const DEFAULT_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `events()` (a store's own live signal — `CharacterStore.events`/`CampaignStore.events`
 * both qualify) until `eventId` either gains a `seq` (committed) or disappears entirely (rejected
 * — `dropPending` removes the row outright, never leaving a "rejected" marker behind), or until
 * `opts.timeoutMs` elapses. This is the "await the event's transition from pending to committed
 * via the store's signals" design the brief asks for — no new store API, no Angular `effect()`
 * (this runs from plain async code with no guaranteed change-detection tick to attach one to,
 * mirroring `CharacterStore.whenPacksReady`'s own plain-poll precedent). */
export async function awaitEventSettled(
  events: Signal<Event[]>,
  eventId: string,
  opts: CampaignLinkAckOptions = {},
): Promise<LinkStepOutcome> {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const found = events().find((e) => e.id === eventId);
    if (found?.seq !== undefined) return 'committed';
    if (found === undefined) return 'rejected';
    if (Date.now() >= deadline) return 'timeout';
    await sleep(pollMs);
  }
}

export interface AppendCaptureResult {
  readonly event: Event;
  readonly outcome: LinkStepOutcome;
}

/**
 * Appends exactly ONE draft via `port.appendTx`, discovers which newly-visible event in
 * `port.events()` is the one it just wrote (neither `CharacterStore.appendTx` nor
 * `CampaignStore.appendTx` returns the appended event/id — see this module's class doc for why a
 * before/after diff against the store's own signal was chosen over widening either store's public
 * return type), then awaits its settlement. The "before/after diff" is narrowed to the SAME event
 * `type` as the draft (not just "any id not seen before") as cheap defense against a genuinely
 * concurrent, unrelated append elsewhere in the app landing in the same window — belt-and-braces
 * only; `appendTx` on both stores serializes through the store's own internal queue, so no OTHER
 * caller of THIS SAME store instance can interleave with it, but the diff is trivially safer to
 * make more specific for near-zero cost. Throws if, somehow, no such event is observed — a
 * bug/regression signal, not a normal outcome this caller should ever need to handle.
 */
export async function appendAndAwaitAck(
  port: AppendablePort,
  draft: DraftEvent,
  opts: CampaignLinkAckOptions = {},
): Promise<AppendCaptureResult> {
  const before = new Set(port.events().map((e) => e.id));
  await port.appendTx([draft]);

  const created = port.events().find((e) => e.type === draft.type && !before.has(e.id));
  if (!created) {
    throw new Error(
      `campaign-link-sequence: appendTx resolved but no new "${draft.type}" event was observed on the store's events() signal`,
    );
  }

  const outcome = await awaitEventSettled(port.events, created.id, opts);
  return { event: created, outcome };
}

/** Builds the CHARACTER-stream half of ruling 4's sequence — `character.campaign_joined@1`
 * (join) or `character.campaign_left@1` (leave), both `{campaignId}` only
 * (`packages/protocol/src/events/character.ts`'s `CharacterCampaignJoinedV1`/
 * `CharacterCampaignLeftV1` — identical shape, distinguished only by event type). `campaignId` is
 * always the BARE uuid (never `camp:`-prefixed) per that schema's own `UUID` regex. */
export function characterCampaignLinkDraft(
  action: CampaignLinkAction,
  campaignId: string,
): DraftEvent {
  return {
    type: action === 'join' ? 'character.campaign_joined' : 'character.campaign_left',
    v: 1,
    payload: { campaignId },
  };
}

export interface CampaignCharacterLinkParticipants {
  /** Bare character uuid — NOT `char:`-prefixed (`CampaignCharacterJoinedV1`/`...LeftV1`'s
   * `characterId` field, `packages/protocol/src/events/campaign.ts`, is `z.string().regex(UUID)`,
   * the same bare-uuid pattern as the stream envelope's own `UUID`). Callers holding a full
   * `char:<uuid>` stream id should strip it first — `bareCharacterId` does exactly that. */
  readonly characterId: string;
  /** MUST equal the acting user's own `userId` (`AuthService.user()?.userId`) — the server's own
   * `refineAppendPermission` refine rejects `forbidden` otherwise (payload facts, task-7-brief.md:
   * "payload.ownerId MUST equal the acting user's own userId"). This module never resolves it
   * itself — the caller is the one with an `AuthService` to ask. */
  readonly ownerId: string;
  readonly characterName: string;
}

/** Strips a `char:` stream-id prefix, if present — `campaign.character_joined/left`'s
 * `characterId` payload field is always the bare uuid (see `CampaignCharacterLinkParticipants`'s
 * own doc). A no-op for an already-bare id, so callers may pass either form. */
export function bareCharacterId(characterId: string): string {
  return characterId.startsWith('char:') ? characterId.slice('char:'.length) : characterId;
}

/** Builds the CAMPAIGN-stream half of ruling 4's sequence — `campaign.character_joined@1` (join)
 * or `campaign.character_left@1` (leave), both `{characterId, ownerId, name}`
 * (`packages/protocol/src/events/campaign.ts`'s `CampaignCharacterJoinedV1`/`...LeftV1`). */
export function campaignCharacterLinkDraft(
  action: CampaignLinkAction,
  participants: CampaignCharacterLinkParticipants,
): DraftEvent {
  return {
    type: action === 'join' ? 'campaign.character_joined' : 'campaign.character_left',
    v: 1,
    payload: {
      characterId: bareCharacterId(participants.characterId),
      ownerId: participants.ownerId,
      name: participants.characterName,
    },
  };
}

export interface CampaignLinkStepResult {
  readonly step: 'character' | 'campaign';
  readonly outcome: LinkStepOutcome;
  readonly event: Event;
}

export interface CampaignLinkOutcome {
  /** `true` only when BOTH steps committed. */
  readonly ok: boolean;
  /** One entry after step (a) alone (if it didn't commit — nothing to retry but re-running this
   * whole call again); two entries once step (b) has ALSO been attempted. */
  readonly steps: readonly CampaignLinkStepResult[];
}

export interface CampaignLinkParams {
  readonly action: CampaignLinkAction;
  /** The character's OWN store — must already be loaded/pointed at `characterId` before this is
   * called (`CharacterStore.load(characterId)`) and in sync mode (a "synced" character) — this
   * module never checks either precondition itself, matching `appendTx`'s own existing contract. */
  readonly characterPort: AppendablePort;
  /** The campaign's OWN store — must already be `open()`'d on `campaignId` before this is called. */
  readonly campaignPort: AppendablePort;
  /** Bare campaign uuid. */
  readonly campaignId: string;
  /** Either form — `char:<uuid>` or bare; see `bareCharacterId`. */
  readonly characterId: string;
  readonly ownerId: string;
  readonly characterName: string;
  readonly ackOpts?: CampaignLinkAckOptions;
}

/**
 * Runs ruling 4's FULL two-step sequence for a character that has NOT yet committed step (a) for
 * this action — step (b) is only ever attempted once step (a) has genuinely committed (ruling 4:
 * "SEQUENCE STRICTLY: await (a)'s ack first"). If step (a) itself rejects or times out, this
 * returns immediately with only one step recorded — there is nothing to retry there but calling
 * this again (a fresh attempt), not `retryCampaignLinkStepB` (that helper only ever re-sends step
 * (b), assuming (a) is already known-committed).
 */
export async function runCampaignLinkSequence(
  params: CampaignLinkParams,
): Promise<CampaignLinkOutcome> {
  const characterDraft = characterCampaignLinkDraft(params.action, params.campaignId);
  const characterResult = await appendAndAwaitAck(
    params.characterPort,
    characterDraft,
    params.ackOpts,
  );
  const steps: CampaignLinkStepResult[] = [
    { step: 'character', outcome: characterResult.outcome, event: characterResult.event },
  ];

  if (characterResult.outcome !== 'committed') {
    return { ok: false, steps };
  }

  const campaignStep = await runStepB(params);
  steps.push(campaignStep);
  return { ok: campaignStep.outcome === 'committed', steps };
}

/**
 * Re-sends ONLY step (b) — ruling 4's documented recovery path for "(a) committed, (b) rejected
 * [or timed out]": "Partial states are legal (recovery = retry (b))". Also the right call for a
 * character whose step (a) committed in an EARLIER session/page-load (this device navigated away
 * before (b) ever landed) — callers discover that case via `campaignIdOfCharacter` already
 * reading the target campaign for a `'join'`, or already reading `undefined`/a DIFFERENT campaign
 * for a `'leave'` (the char-side half is already done either way).
 */
export async function retryCampaignLinkStepB(
  params: CampaignLinkParams,
): Promise<CampaignLinkStepResult> {
  return runStepB(params);
}

async function runStepB(params: CampaignLinkParams): Promise<CampaignLinkStepResult> {
  const draft = campaignCharacterLinkDraft(params.action, {
    characterId: params.characterId,
    ownerId: params.ownerId,
    characterName: params.characterName,
  });
  const result = await appendAndAwaitAck(params.campaignPort, draft, params.ackOpts);
  return { step: 'campaign', outcome: result.outcome, event: result.event };
}
