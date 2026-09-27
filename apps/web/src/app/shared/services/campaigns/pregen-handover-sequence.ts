import type { DraftEvent } from '../../stores/character.store';
import {
  appendAndAwaitAck,
  bareCharacterId,
  campaignCharacterLinkDraft,
  characterCampaignLinkDraft,
  type AppendablePort,
  type CampaignLinkAckOptions,
  type LinkStepOutcome,
} from './campaign-link-sequence';
import { currentOwnerIdOf, lastCampaignLinkEvent } from './character-campaign-link';

/**
 * Task 12 (pregen claiming), ruling 6's DM-driven handover — the FULL, server-rule-validated
 * 5-step sequence (see task-12-report.md for the derivation + the `campaign-gateway.test.ts`
 * two-actor tests that pin it against the real server code). The key realization that corrects
 * the plan's own speculative ordering note: a DM-owned PREGEN is a character the DM genuinely
 * D1-owns (created via the DM's own `CharacterStore`, exactly like any of their own characters —
 * see `core/routes/characters.ts`'s header comment: D1's `characters.owner_id` never moves after
 * creation in this codebase). The DM therefore has a DIRECT connection to the pregen's own stream
 * for the entire handover — every char-side step below goes through `characterPort` (the DM's own
 * loaded `CharacterStore`, ordinary `appendTx`), NEVER `CampaignStore.gatewayAppend`. Only the
 * campaign-side roster mirror events go through `campaignPort` (also a plain, local `appendTx` —
 * the DM's own campaign socket, `refineAppendPermission`'s `actor.role === 'dm'` exemption covers
 * both the ownerId self-match check for `campaign.character_left`/`_joined` and lets the DM name a
 * DIFFERENT final owner than themselves).
 *
 * Steps, IN THIS ORDER (do not reorder — see the class doc's citations):
 *   (1) `characterLeave` — DIRECT char-side `character.campaign_left {campaignId}`. Backstop
 *       passes (the DM is still the established owner at this point).
 *   (2) `rosterClear` — LOCAL campaign-side `campaign.character_left` (dm-exempt). Requires (1)
 *       to have ALREADY committed (`verifyCharacterMirror`'s LEFT check: `current !==
 *       thisCampaignId`) — this is why it must run BEFORE the char-side rejoin (3), not after.
 *   (3) `characterRejoin` — DIRECT char-side `character.campaign_joined {campaignId}` (same
 *       campaign). Still backstop-safe (still the DM). Required so `verifyCharacterMirror`'s JOIN
 *       check (`current === thisCampaignId`) can pass for (4).
 *   (4) `rosterRejoin` — LOCAL campaign-side `campaign.character_joined {ownerId: toUserId}`
 *       (dm-exempt from the ownerId self-match check — this is what lets the DM name M as the
 *       final owner here, before M has done anything at all). `(b2)`'s existing-owner check
 *       passes since the roster slot is empty (cleared by (2)).
 *   (5) `ownerTransfer` — DIRECT char-side `character.owner_transferred {toUserId}` — sent LAST,
 *       while the DM is STILL the character's own established owner (backstop passes one final
 *       time). Moving this step any earlier breaks EVERY subsequent char-side step: once
 *       `meta.ownerId` flips away from the DM, the owner backstop refuses every further
 *       DM-authored owner-class append on this character, including the rejoin (3) this sequence
 *       still needs — a real deadlock, pinned by `campaign-gateway.test.ts`'s own "sent too early"
 *       test.
 *
 * Each step function independently re-derives whether it is ALREADY done from FRESH state
 * (`characterPort.events()`/`rosterEntry()`) before deciding whether to append anything at all —
 * the same "always re-check reality before choosing fresh-vs-resume" pattern
 * `campaign-link-sequence.ts`'s fix round 1 established (findings 2/3 there). This is what makes
 * `runPregenHandoverSequence` itself both the FRESH-attempt AND the RETRY entry point: a caller's
 * "Retry" button just calls this function again — whatever already committed is skipped, and the
 * sequence picks up exactly where it left off.
 */

export function ownerTransferDraft(toUserId: string): DraftEvent {
  return { type: 'character.owner_transferred', v: 1, payload: { toUserId } };
}

export type HandoverStepName =
  'characterLeave' | 'rosterClear' | 'characterRejoin' | 'rosterRejoin' | 'ownerTransfer';

export interface HandoverStepResult {
  readonly step: HandoverStepName;
  /** `'skipped'` — this step's target state was ALREADY true before this call, no append sent. */
  readonly outcome: LinkStepOutcome | 'skipped';
}

export interface HandoverOutcome {
  /** `true` only once EVERY step is `'committed'` or `'skipped'`. */
  readonly ok: boolean;
  readonly steps: readonly HandoverStepResult[];
}

/** A roster row's read shape this module needs — `CampaignState.roster`'s own `RosterEntry`
 * (`campaign-projection.ts`) satisfies this structurally; declared narrowly here so this module
 * never imports that file directly. */
export interface HandoverRosterEntry {
  readonly ownerId: string;
  readonly left: boolean;
}

export interface HandoverParams {
  /** The DM's OWN `CharacterStore`, already `load()`ed onto this pregen. */
  readonly characterPort: AppendablePort;
  /** The DM's OWN `CampaignStore`, already `open()`ed on this campaign. */
  readonly campaignPort: AppendablePort;
  /** Live read of this character's CURRENT roster row (`CampaignStore.state()?.roster.get(...)`)
   * — `undefined` only if the roster has literally never seen this characterId at all (not the
   * expected case for an already-rostered pregen, but not assumed away). */
  readonly rosterEntry: () => HandoverRosterEntry | undefined;
  /** Bare campaign uuid. */
  readonly campaignId: string;
  /** Either form — `char:<uuid>` or bare. */
  readonly characterId: string;
  readonly characterName: string;
  /** The DM's own userId — the CURRENT roster owner before this sequence runs. */
  readonly fromOwnerId: string;
  /** The claiming member's userId — the FINAL owner once this sequence completes. */
  readonly toUserId: string;
  readonly ackOpts?: CampaignLinkAckOptions;
}

/** A thrown error (`CampaignStoreNotLeaderError`/`CharacterStoreNotLeaderError`/anything else
 * `appendTx` can throw) is DELIBERATELY NOT caught here — same posture `campaign-link-sequence.ts`'s
 * `runStepB`/`retryCampaignLinkStepB` already establish (neither wraps its own `appendAndAwaitAck`
 * call in a try/catch either): the exception propagates all the way out of
 * `runPregenHandoverSequence` to the UI CALLER's own try/catch, which is what needs the specific
 * error TYPE to choose the right scoped message (`toErrorKey` in
 * `handover-character-dialog.component.ts`) — folding it into a generic `'rejected'` step result
 * here would lose that distinction. A genuine server REJECT (no exception — `appendAndAwaitAck`
 * resolves normally with `outcome: 'rejected'`) is unaffected either way.
 */
async function appendStep(
  port: AppendablePort,
  draft: DraftEvent,
  opts: CampaignLinkAckOptions | undefined,
): Promise<LinkStepOutcome> {
  const result = await appendAndAwaitAck(port, draft, opts);
  return result.outcome;
}

async function stepCharacterLeave(p: HandoverParams): Promise<HandoverStepResult> {
  const link = lastCampaignLinkEvent(p.characterPort.events());
  if (
    link?.type === 'character.campaign_left' &&
    link.campaignId === p.campaignId &&
    link.committed
  ) {
    return { step: 'characterLeave', outcome: 'skipped' };
  }
  const outcome = await appendStep(
    p.characterPort,
    characterCampaignLinkDraft('leave', p.campaignId),
    p.ackOpts,
  );
  return { step: 'characterLeave', outcome };
}

async function stepRosterClear(p: HandoverParams): Promise<HandoverStepResult> {
  if (p.rosterEntry()?.left === true) {
    return { step: 'rosterClear', outcome: 'skipped' };
  }
  const draft = campaignCharacterLinkDraft('leave', {
    characterId: p.characterId,
    ownerId: p.fromOwnerId,
    characterName: p.characterName,
  });
  const outcome = await appendStep(p.campaignPort, draft, p.ackOpts);
  return { step: 'rosterClear', outcome };
}

async function stepCharacterRejoin(p: HandoverParams): Promise<HandoverStepResult> {
  const link = lastCampaignLinkEvent(p.characterPort.events());
  if (
    link?.type === 'character.campaign_joined' &&
    link.campaignId === p.campaignId &&
    link.committed
  ) {
    return { step: 'characterRejoin', outcome: 'skipped' };
  }
  const outcome = await appendStep(
    p.characterPort,
    characterCampaignLinkDraft('join', p.campaignId),
    p.ackOpts,
  );
  return { step: 'characterRejoin', outcome };
}

async function stepRosterRejoin(p: HandoverParams): Promise<HandoverStepResult> {
  const entry = p.rosterEntry();
  if (entry?.left === false && entry.ownerId === p.toUserId) {
    return { step: 'rosterRejoin', outcome: 'skipped' };
  }
  const draft = campaignCharacterLinkDraft('join', {
    characterId: p.characterId,
    ownerId: p.toUserId,
    characterName: p.characterName,
  });
  const outcome = await appendStep(p.campaignPort, draft, p.ackOpts);
  return { step: 'rosterRejoin', outcome };
}

async function stepOwnerTransfer(p: HandoverParams): Promise<HandoverStepResult> {
  if (currentOwnerIdOf(p.characterPort.events()) === p.toUserId) {
    return { step: 'ownerTransfer', outcome: 'skipped' };
  }
  const outcome = await appendStep(p.characterPort, ownerTransferDraft(p.toUserId), p.ackOpts);
  return { step: 'ownerTransfer', outcome };
}

const STEP_FNS: readonly ((p: HandoverParams) => Promise<HandoverStepResult>)[] = [
  stepCharacterLeave,
  stepRosterClear,
  stepCharacterRejoin,
  stepRosterRejoin,
  stepOwnerTransfer,
];

/** Runs (or resumes — see the class doc) the full 5-step handover. Stops at the first step whose
 * outcome is neither `'committed'` nor `'skipped'`, so `outcome.steps` always tells a caller
 * exactly how far it got and which single step needs a retry. `characterId` is normalized to its
 * bare form once here — every draft builder this module calls already expects that. */
export async function runPregenHandoverSequence(params: HandoverParams): Promise<HandoverOutcome> {
  const p: HandoverParams = { ...params, characterId: bareCharacterId(params.characterId) };
  const steps: HandoverStepResult[] = [];
  for (const stepFn of STEP_FNS) {
    // Strictly sequential by design (ruling 6/4: each step's own precondition depends on the
    // PREVIOUS one having already committed) — never parallelized.
    const result = await stepFn(p);
    steps.push(result);
    if (result.outcome !== 'committed' && result.outcome !== 'skipped') {
      return { ok: false, steps };
    }
  }
  return { ok: true, steps };
}
