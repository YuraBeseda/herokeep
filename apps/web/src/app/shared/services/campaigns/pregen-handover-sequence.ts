import { ApiError, apiJson } from '../api/api-fetch';
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
 *   (5) `ownerTransfer` — `POST /api/characters/:id/transfer {toUserId}` (round 2: was a DIRECT
 *       char-side `character.owner_transferred` append; now a real ownership move — doc-02
 *       L178-179's binding claim ruling, "a claimed pregen behaves like any player character",
 *       is not satisfiable from a client-side-only event append, since D1's `characters.owner_id`
 *       is a SEPARATE, server-authoritative copy `character-actor.ts`'s own header comment
 *       documents — see `core/routes/characters.ts`'s own route doc comment for the full
 *       dual-write design this now drives). Sent LAST, while the DM is STILL the character's own
 *       established owner (the route's own authorization check requires exactly that). Moving
 *       this step any earlier breaks EVERY subsequent char-side step: once ownership flips away
 *       from the DM, the owner backstop refuses every further DM-authored owner-class DIRECT
 *       append on this character, including the rejoin (3) this sequence still needs — a real
 *       deadlock, pinned by `campaign-gateway.test.ts`'s own "sent too early" test (still true:
 *       this route is authorization-gated on the SAME "session user is the CURRENT owner" check).
 *
 * Steps (1)-(4) each independently re-derive whether they are ALREADY done from FRESH state
 * (`characterPort.events()`/`rosterEntry()`) before deciding whether to append anything at all —
 * the same "always re-check reality before choosing fresh-vs-resume" pattern
 * `campaign-link-sequence.ts`'s fix round 1 established (findings 2/3 there). Step (5) does the
 * same, reading `currentOwnerIdOf` (which the SERVER-appended `character.owner_transferred` event
 * feeds once it round-trips back through the DM's own live sync session — same ordinary fan-out
 * every OTHER externally-committed event on an open stream already gets, `stream-actor.ts`'s
 * `fanOut`). This is what makes `runPregenHandoverSequence` itself both the FRESH-attempt AND the
 * RETRY entry point: a caller's "Retry" button just calls this function again — whatever already
 * committed is skipped, and the sequence picks up exactly where it left off.
 */

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

/**
 * A single, MONOTONIC classification of how far this handover has already progressed, read fresh
 * from `characterPort.events()`/`rosterEntry()` every call. Each step below skips itself when
 * `currentPhase(p) >= <the phase that step completes>` — deliberately NOT five independent
 * "does MY OWN target state already hold" checks: a per-step event-log heuristic (e.g.
 * `stepCharacterLeave`'s original "is the LAST relevant char-side event a committed LEFT for this
 * campaign?") goes STALE once a LATER step also completes — by the time step (3) (the rejoin) has
 * committed, the last relevant char-side event is a JOIN, not a LEFT, even though step (1)
 * genuinely DID happen earlier in this same handover. Since `character.campaign_left`'s hook
 * UNCONDITIONALLY clears `meta.campaignId` (`character-actor.ts`), wrongly re-sending step (1)
 * after step (3) has already rejoined would silently UNDO that rejoin — this is not a merely
 * redundant resend, it is destructive. Ordering the phases from the MOST-complete signal down to
 * the least is what makes this monotonic and immune to that staleness: once ANY later-phase signal
 * is observed, every earlier step is unconditionally treated as done, regardless of what its own
 * narrower, single-purpose event-log check would say in isolation.
 */
function currentPhase(p: HandoverParams): 0 | 1 | 2 | 3 | 4 | 5 {
  if (currentOwnerIdOf(p.characterPort.events()) === p.toUserId) return 5;
  const entry = p.rosterEntry();
  if (entry?.left === false && entry.ownerId === p.toUserId) return 4;
  const stillOriginalRoster = entry?.ownerId === p.fromOwnerId && entry.left === false;
  const link = lastCampaignLinkEvent(p.characterPort.events());
  const rejoinedThisCampaign =
    link?.type === 'character.campaign_joined' &&
    link.campaignId === p.campaignId &&
    link.committed;
  const leftThisCampaign =
    link?.type === 'character.campaign_left' && link.campaignId === p.campaignId && link.committed;
  if (!stillOriginalRoster) return rejoinedThisCampaign ? 3 : 2;
  return leftThisCampaign ? 1 : 0;
}

async function stepCharacterLeave(p: HandoverParams): Promise<HandoverStepResult> {
  if (currentPhase(p) >= 1) return { step: 'characterLeave', outcome: 'skipped' };
  const outcome = await appendStep(
    p.characterPort,
    characterCampaignLinkDraft('leave', p.campaignId),
    p.ackOpts,
  );
  return { step: 'characterLeave', outcome };
}

async function stepRosterClear(p: HandoverParams): Promise<HandoverStepResult> {
  if (currentPhase(p) >= 2) return { step: 'rosterClear', outcome: 'skipped' };
  const draft = campaignCharacterLinkDraft('leave', {
    characterId: p.characterId,
    ownerId: p.fromOwnerId,
    characterName: p.characterName,
  });
  const outcome = await appendStep(p.campaignPort, draft, p.ackOpts);
  return { step: 'rosterClear', outcome };
}

async function stepCharacterRejoin(p: HandoverParams): Promise<HandoverStepResult> {
  if (currentPhase(p) >= 3) return { step: 'characterRejoin', outcome: 'skipped' };
  const outcome = await appendStep(
    p.characterPort,
    characterCampaignLinkDraft('join', p.campaignId),
    p.ackOpts,
  );
  return { step: 'characterRejoin', outcome };
}

async function stepRosterRejoin(p: HandoverParams): Promise<HandoverStepResult> {
  if (currentPhase(p) >= 4) return { step: 'rosterRejoin', outcome: 'skipped' };
  const draft = campaignCharacterLinkDraft('join', {
    characterId: p.characterId,
    ownerId: p.toUserId,
    characterName: p.characterName,
  });
  const outcome = await appendStep(p.campaignPort, draft, p.ackOpts);
  return { step: 'rosterRejoin', outcome };
}

/**
 * [round 2] Calls the REAL ownership-transfer route instead of appending
 * `character.owner_transferred` directly — see this module's own class doc, step (5). A genuine
 * `ApiError` (any status: a 403/404/409 from the route's own checks, or a `status: 0` network
 * failure) is folded into `'rejected'` here — this step has no `CampaignStoreNotLeaderError`-style
 * TYPE the dialog needs to distinguish (unlike steps (1)-(4)'s plain `appendTx` calls); the
 * per-step retry UI's own "click retry" already covers every one of these causes uniformly. Any
 * OTHER (unexpected, non-`ApiError`) thrown value still propagates — this step doesn't swallow a
 * genuine bug.
 */
async function stepOwnerTransfer(p: HandoverParams): Promise<HandoverStepResult> {
  if (currentPhase(p) >= 5) return { step: 'ownerTransfer', outcome: 'skipped' };
  try {
    await apiJson(`/api/characters/${p.characterId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toUserId: p.toUserId }),
    });
    return { step: 'ownerTransfer', outcome: 'committed' };
  } catch (err) {
    if (err instanceof ApiError) {
      return { step: 'ownerTransfer', outcome: 'rejected' };
    }
    throw err;
  }
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
