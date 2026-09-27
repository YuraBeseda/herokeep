import type { RejectCode } from '@hk/protocol';
import type { AckOrReject } from '../../stores/campaign.store';
import type { DraftEvent } from '../../stores/character.store';
import {
  appendAndAwaitAck,
  bareCharacterId,
  campaignCharacterLinkDraft,
  characterCampaignLinkDraft,
  type AppendablePort,
  type CampaignLinkAckOptions,
} from './campaign-link-sequence';

/**
 * The DM "unlink character" sequence (plan-10 task-11-brief.md, doc-03 §bye obligation): scoped
 * EXACTLY to a roster entry whose owning member has been removed/left AND whose character is
 * still `left: false` — `member.removed` unlinks the MEMBERSHIP only, never the character
 * (doc-03: "`member.removed` unlinks the MEMBERSHIP only... it does NOT unlink that member's
 * character(s) from the campaign roster"), and a removed, non-rejoined owner cannot complete the
 * campaign-side half of an ordinary self-leave alone (`campaign-actor.ts`'s
 * `refineAppendPermission`, (b): the owner would need to still BE a campaign member). Finishing
 * the unlink after a removal is therefore a DM action (doc-03, verbatim: "finishing the unlink
 * after a removal is a DM action, not an automatic one").
 *
 * Sequence, mirroring ruling 4's LEAVE ordering (`campaign-link-sequence.ts`) but through the
 * GATEWAY for step (a), since the DM is never the character's own owner and cannot load it into
 * their own `CharacterStore`:
 *   (a) `character.campaign_left {campaignId}` on `char:<characterId>`, via
 *       `CampaignStore.gatewayAppend` (doc-03's cross-stream forwarding — the server maps this
 *       DM's gateway actor to `dm` per `mapGatewayActor`, `campaign-actor.ts`, as long as the
 *       roster still lists the character — true until step (b) actually commits). AWAIT its
 *       ack before ever attempting step (b) (ruling 4's ordering, applied identically here).
 *   (b) `campaign.character_left {characterId, ownerId, name}` on the campaign's OWN stream, via
 *       ordinary `CampaignStore.appendTx` — `ownerId` is the ROSTER ENTRY's real owner, NOT the
 *       acting DM (`refineAppendPermission`'s own ownerId check is bypassed entirely for a
 *       `role: 'dm'` actor — verified by reading `campaign-actor.ts` directly, task-11-brief.md's
 *       binding instruction). `verifyCharacterMirror`'s LEFT branch requires step (a) to have
 *       ALREADY committed (`hasEvent` + `current !== thisCampaignId`), which is exactly why (a)
 *       must be awaited first.
 *
 * Resending step (a) on a retry is deliberately never special-cased against "was it already
 * committed" (unlike `retryCampaignLinkStepB`'s owner-authored equivalent): `character.campaign_left`
 * has no reducer-side effect at all (`character.campaign_joined`/`_left` are `notApplicableSolo`
 * in `packages/engine/src/reduce/handlers/identity.ts` — `Facts` never carries a `campaignId`
 * field), and the server's gateway-actor mapping for the DM only requires the CAMPAIGN's own live
 * roster to still list the character (`meta.characters.has`), which stays true right up until
 * step (b) commits — so a duplicate step (a) append is harmless, just an extra inert log entry on
 * the character's own stream. This lets a full retry simply re-run the WHOLE sequence rather than
 * needing to poll the character's own (DM-inaccessible) event log to decide whether to skip it.
 */

export interface DmUnlinkParams {
  /** The campaign's OWN store (or any `AppendablePort`-satisfying stand-in) — step (b) only. */
  readonly campaignPort: AppendablePort;
  /** `CampaignStore.gatewayAppend`, bound — step (a) only. */
  readonly gatewayAppend: (characterId: string, drafts: DraftEvent[]) => Promise<AckOrReject>;
  /** Bare campaign uuid. */
  readonly campaignId: string;
  /** Either form — `char:<uuid>` or bare. */
  readonly characterId: string;
  /** The ROSTER entry's real owner — never the acting DM's own userId. */
  readonly ownerId: string;
  readonly characterName: string;
  readonly ackOpts?: CampaignLinkAckOptions;
}

export interface DmUnlinkStepResult {
  readonly step: 'character' | 'campaign';
  readonly ok: boolean;
  readonly code?: RejectCode;
  readonly message?: string;
}

export interface DmUnlinkOutcome {
  /** `true` only when BOTH steps committed. */
  readonly ok: boolean;
  readonly steps: readonly DmUnlinkStepResult[];
}

/** Step (a) alone — a thin wrapper resolving `gatewayAppend`'s `AckOrReject` (never a poll: the
 * gateway promise already only settles once the server has answered every sent id) into this
 * module's own step-result shape. A thrown `CampaignGatewayUnavailableError` (no live session, a
 * send failure, or the gateway's own 30s ack timeout — `campaign.store.ts`) is caught here and
 * folded into an ordinary `ok: false` result rather than propagating — the panel's retry affordance
 * treats "the gateway wasn't reachable" the same as "the server rejected it": both mean "not done
 * yet, offer Retry", never a crash. */
async function runStepA(params: DmUnlinkParams): Promise<DmUnlinkStepResult> {
  const bareId = bareCharacterId(params.characterId);
  const draft = characterCampaignLinkDraft('leave', params.campaignId);
  try {
    const result = await params.gatewayAppend(bareId, [draft]);
    const rejection = result.rejected[0];
    return rejection
      ? { step: 'character', ok: false, code: rejection.code, message: rejection.message }
      : { step: 'character', ok: true };
  } catch (err) {
    return {
      step: 'character',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Step (b) alone — reuses `campaign-link-sequence.ts`'s own draft builder + ack-polling
 * primitive (`appendAndAwaitAck`), the SAME pieces the owner-authored LEAVE flow uses for its own
 * step (b); only the `ownerId` differs (the roster's real owner, not `params.campaignPort`'s own
 * acting user). */
async function runStepB(params: DmUnlinkParams): Promise<DmUnlinkStepResult> {
  const draft = campaignCharacterLinkDraft('leave', {
    characterId: params.characterId,
    ownerId: params.ownerId,
    characterName: params.characterName,
  });
  const result = await appendAndAwaitAck(params.campaignPort, draft, params.ackOpts);
  return { step: 'campaign', ok: result.outcome === 'committed' };
}

/** Runs the FULL two-step sequence — step (b) is only ever attempted once step (a) has committed
 * (mirroring ruling 4's "SEQUENCE STRICTLY: await (a)'s ack first"). If step (a) fails, this
 * returns immediately with a single step recorded; there is nothing to retry BUT re-running this
 * same function again (see this module's class doc for why re-sending step (a) is always safe). */
export async function runDmUnlinkSequence(params: DmUnlinkParams): Promise<DmUnlinkOutcome> {
  const stepA = await runStepA(params);
  if (!stepA.ok) return { ok: false, steps: [stepA] };

  const stepB = await runStepB(params);
  return { ok: stepB.ok, steps: [stepA, stepB] };
}
