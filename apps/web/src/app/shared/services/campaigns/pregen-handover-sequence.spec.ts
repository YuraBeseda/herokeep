import type { Event } from '@hk/protocol';
import { signal } from '@angular/core';
import type { DraftEvent } from '../../stores/character.store';
import {
  ownerTransferDraft,
  runPregenHandoverSequence,
  type HandoverParams,
} from './pregen-handover-sequence';

const CHARACTER_ID = '00000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const DM_ID = 'usr_dm';
const MEMBER_ID = 'usr_member';
const CHARACTER_NAME = 'Pregen Paul';

let nextId = 1;
function eventId(): string {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
}

/** A minimal fake `AppendablePort` — `appendTx` synchronously (well, after a microtask) commits
 * the draft with a fresh seq, mirroring the real stores' own "events() updates before appendTx's
 * promise resolves" contract (`campaign-link-sequence.ts`'s own doc comment). */
function makePort(seed: Event[] = []) {
  const events = signal<Event[]>(seed);
  let nextSeq = seed.filter((e) => e.seq !== undefined).length + 1;
  return {
    events: events.asReadonly(),
    /** Test-only escape hatch — the SAME writable signal `events` (above) exposes read-only,
     * needed by tests that simulate a genuine (non-throwing) server reject by mutating the
     * underlying event list directly rather than through `appendTx`. */
    rawEvents: events,
    appendTx: (drafts: DraftEvent[]): Promise<void> => {
      const now = [...events()];
      for (const draft of drafts) {
        now.push({
          id: eventId(),
          stream: `char:${CHARACTER_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
          type: draft.type,
          v: draft.v,
          payload: draft.payload,
          seq: nextSeq++,
        });
      }
      events.set(now);
      return Promise.resolve();
    },
  };
}

function makeCreated(ownerUserId: string): Event {
  return {
    id: eventId(),
    stream: `char:${CHARACTER_ID}`,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: ownerUserId, deviceId: 'dev_1', role: 'owner' },
    type: 'character.created',
    v: 1,
    payload: { name: CHARACTER_NAME },
    seq: 1,
  };
}

interface RosterEntryFixture {
  ownerId: string;
  left: boolean;
}

function makeParams(
  characterPort: ReturnType<typeof makePort>,
  campaignPort: ReturnType<typeof makePort>,
  roster: { current: RosterEntryFixture | undefined },
): HandoverParams {
  return {
    characterPort,
    campaignPort,
    rosterEntry: () => roster.current,
    campaignId: CAMPAIGN_ID,
    characterId: CHARACTER_ID,
    characterName: CHARACTER_NAME,
    fromOwnerId: DM_ID,
    toUserId: MEMBER_ID,
    ackOpts: { pollMs: 1, timeoutMs: 200 },
  };
}

describe('ownerTransferDraft', () => {
  it('builds character.owner_transferred@1 {toUserId}', () => {
    expect(ownerTransferDraft(MEMBER_ID)).toEqual({
      type: 'character.owner_transferred',
      v: 1,
      payload: { toUserId: MEMBER_ID },
    });
  });
});

describe('runPregenHandoverSequence', () => {
  it('runs all 5 steps in order (character leave, roster clear, character rejoin, roster rejoin, owner transfer) against fresh state', async () => {
    const characterPort = makePort([makeCreated(DM_ID)]);
    const campaignPort = makePort([]);
    const roster = { current: { ownerId: DM_ID, left: false } };
    // A fake campaign store's own commit of campaign.character_left/joined isn't modeled by
    // `makePort` (roster is a SEPARATE projection this test drives by hand) — mutate `roster`
    // alongside each campaign-side appendTx the same way the real CampaignStore's projector would.
    const originalAppendTx = campaignPort.appendTx;
    campaignPort.appendTx = async (drafts) => {
      await originalAppendTx(drafts);
      for (const draft of drafts) {
        if (draft.type === 'campaign.character_left') {
          roster.current = { ownerId: (draft.payload as { ownerId: string }).ownerId, left: true };
        }
        if (draft.type === 'campaign.character_joined') {
          roster.current = { ownerId: (draft.payload as { ownerId: string }).ownerId, left: false };
        }
      }
    };

    const outcome = await runPregenHandoverSequence(
      makeParams(characterPort, campaignPort, roster),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.steps.map((s) => s.step)).toEqual([
      'characterLeave',
      'rosterClear',
      'characterRejoin',
      'rosterRejoin',
      'ownerTransfer',
    ]);
    expect(outcome.steps.every((s) => s.outcome === 'committed')).toBe(true);
    expect(roster.current).toEqual({ ownerId: MEMBER_ID, left: false });

    const charTypes = characterPort
      .events()
      .map((e) => e.type)
      .filter((t) => t !== 'character.created');
    expect(charTypes).toEqual([
      'character.campaign_left',
      'character.campaign_joined',
      'character.owner_transferred',
    ]);
  });

  it('re-running the WHOLE sequence after a partial success skips every already-committed step (idempotent resume, no separate "retry from step N" API needed)', async () => {
    const characterPort = makePort([makeCreated(DM_ID)]);
    const campaignPort = makePort([]);
    const roster = { current: { ownerId: DM_ID, left: false } };
    const originalAppendTx = campaignPort.appendTx;
    campaignPort.appendTx = async (drafts) => {
      await originalAppendTx(drafts);
      for (const draft of drafts) {
        if (draft.type === 'campaign.character_left') {
          roster.current = { ownerId: (draft.payload as { ownerId: string }).ownerId, left: true };
        }
        if (draft.type === 'campaign.character_joined') {
          roster.current = { ownerId: (draft.payload as { ownerId: string }).ownerId, left: false };
        }
      }
    };
    const params = makeParams(characterPort, campaignPort, roster);

    // Manually pre-commit steps A and B only (simulating an earlier attempt that stopped there).
    await characterPort.appendTx([
      { type: 'character.campaign_left', v: 1, payload: { campaignId: CAMPAIGN_ID } },
    ]);
    await campaignPort.appendTx([
      {
        type: 'campaign.character_left',
        v: 1,
        payload: { characterId: CHARACTER_ID, ownerId: DM_ID, name: CHARACTER_NAME },
      },
    ]);

    const outcome = await runPregenHandoverSequence(params);

    expect(outcome.ok).toBe(true);
    expect(outcome.steps).toEqual([
      { step: 'characterLeave', outcome: 'skipped' },
      { step: 'rosterClear', outcome: 'skipped' },
      { step: 'characterRejoin', outcome: 'committed' },
      { step: 'rosterRejoin', outcome: 'committed' },
      { step: 'ownerTransfer', outcome: 'committed' },
    ]);
  });

  it('stops and reports a rejected step (a genuine server reject, no exception) without attempting the next one', async () => {
    const characterPort = makePort([makeCreated(DM_ID)]);
    const campaignPort = makePort([]);
    const roster = { current: { ownerId: DM_ID, left: false } };
    // A REAL reject frame never throws — `appendTx` resolves normally, but the event never gains a
    // seq and is later removed (`dropPending`'s own contract, `campaign-link-sequence.ts`'s doc
    // comment) — simulated here by writing nothing at all, so `appendAndAwaitAck`'s own
    // before/after diff finds no matching new event and `awaitEventSettled` times out waiting for
    // one that will never appear... instead, more directly: append a row that never gets a seq and
    // is removed before the poll's first tick.
    campaignPort.appendTx = (drafts): Promise<void> => {
      const draft = drafts[0];
      const pendingId = eventId();
      campaignPort.rawEvents.set([
        ...campaignPort.events(),
        {
          id: pendingId,
          stream: `camp:${CAMPAIGN_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'dm' },
          type: draft.type,
          v: draft.v,
          payload: draft.payload,
        },
      ]);
      // Removed ~5ms later — a real, short-lived timer (matches `link-character.component.spec.ts`'s
      // own `rejectOnceThenCommitPort` precedent), well after `appendAndAwaitAck`'s own synchronous
      // before/after diff (which needs to see the event present at least once) but still comfortably
      // inside this test's 1ms poll interval / 200ms timeout.
      setTimeout(() => {
        campaignPort.rawEvents.set(campaignPort.events().filter((e) => e.id !== pendingId));
      }, 5);
      return Promise.resolve();
    };

    const outcome = await runPregenHandoverSequence(
      makeParams(characterPort, campaignPort, roster),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.steps).toEqual([
      { step: 'characterLeave', outcome: 'committed' },
      { step: 'rosterClear', outcome: 'rejected' },
    ]);
  });

  it('a THROWN exception (e.g. a not-leader error) propagates out of the sequence rather than being folded into a step result — the UI caller needs the real error type to pick the right message', async () => {
    const characterPort = makePort([makeCreated(DM_ID)]);
    const campaignPort = makePort([]);
    const roster = { current: { ownerId: DM_ID, left: false } };
    class FakeNotLeaderError extends Error {}
    campaignPort.appendTx = (): Promise<void> => {
      throw new FakeNotLeaderError('not the leader');
    };

    await expect(
      runPregenHandoverSequence(makeParams(characterPort, campaignPort, roster)),
    ).rejects.toBeInstanceOf(FakeNotLeaderError);
  });
});
