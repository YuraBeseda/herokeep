import type { Event } from '@hk/protocol';
import { signal } from '@angular/core';
import type { DraftEvent } from '../../stores/character.store';
import { runPregenHandoverSequence, type HandoverParams } from './pregen-handover-sequence';

const CHARACTER_ID = '00000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const DM_ID = 'usr_dm';
const MEMBER_ID = 'usr_member';
const CHARACTER_NAME = 'Pregen Paul';

let nextId = 1;
function eventId(): string {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
}

/** `RequestInfo | URL` -> a plain string — `String(input)` would use `Request`'s default
 * `[object Object]` stringification for a real `Request` instance (`no-base-to-string`); this
 * fake `fetch` only ever receives a plain string URL from `apiFetch`, but typed narrowly to match
 * the real `fetch` signature regardless (mirrors `sync.service.spec.ts`'s own identical helper). */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** [round 2] Step (5) is now a real HTTP call (`POST /api/characters/:id/transfer`) — this fake
 * `fetch` answers 204 for that exact path by default; individual tests override
 * `fetchImpl.current` to simulate a rejection/network failure. Every test in this file replaces
 * the global `fetch` with this same double so step (5) never reaches a real network call. */
const fetchImpl = {
  current: (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    Promise.resolve(new Response(null, { status: 204 })),
};

beforeEach(() => {
  fetchImpl.current = (_input, _init) => Promise.resolve(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl.current(input, init),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
     * underlying event list directly rather than through `appendTx`, OR (round 2) simulate the
     * server-appended `character.owner_transferred` round-tripping back through a live sync
     * session once step (5)'s HTTP call succeeds. */
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

/** Wires `campaignPort.appendTx` to also mutate `roster` (a fake campaign store's own commit of
 * `campaign.character_left`/`_joined` isn't modeled by `makePort` — `roster` is a SEPARATE
 * projection this test drives by hand, the same way the real `CampaignStore`'s own projector
 * would react to those same events), AND (round 2) wires `characterPort.appendTx` so that a
 * SUCCESSFUL step (5) HTTP call also writes the `character.owner_transferred` event onto
 * `characterPort`'s own signal — simulating that event round-tripping back through the DM's live
 * sync session (this module's own class doc: "the same ordinary fan-out every OTHER
 * externally-committed event on an open stream already gets"), which is what lets
 * `currentOwnerIdOf` observe the transfer for the "already done?" resume check.
 */
function wireProjection(
  characterPort: ReturnType<typeof makePort>,
  campaignPort: ReturnType<typeof makePort>,
  roster: { current: RosterEntryFixture | undefined },
): void {
  const originalCampaignAppendTx = campaignPort.appendTx;
  campaignPort.appendTx = async (drafts) => {
    await originalCampaignAppendTx(drafts);
    for (const draft of drafts) {
      if (draft.type === 'campaign.character_left') {
        roster.current = { ownerId: (draft.payload as { ownerId: string }).ownerId, left: true };
      }
      if (draft.type === 'campaign.character_joined') {
        roster.current = { ownerId: (draft.payload as { ownerId: string }).ownerId, left: false };
      }
    }
  };
  fetchImpl.current = (input) => {
    if (requestUrl(input).includes('/transfer')) {
      characterPort.rawEvents.set([
        ...characterPort.events(),
        {
          id: eventId(),
          stream: `char:${CHARACTER_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
          type: 'character.owner_transferred',
          v: 1,
          payload: { toUserId: MEMBER_ID },
          seq: 999,
        },
      ]);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };
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

describe('runPregenHandoverSequence', () => {
  it('runs all 5 steps in order (character leave, roster clear, character rejoin, roster rejoin, owner transfer) against fresh state', async () => {
    const characterPort = makePort([makeCreated(DM_ID)]);
    const campaignPort = makePort([]);
    const roster = { current: { ownerId: DM_ID, left: false } };
    wireProjection(characterPort, campaignPort, roster);

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
    wireProjection(characterPort, campaignPort, roster);
    const params = makeParams(characterPort, campaignPort, roster);

    // Manually pre-commit steps 1 and 2 only (simulating an earlier attempt that stopped there).
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

  it('re-running after step (5) already committed skips it too (reads currentOwnerIdOf off the round-tripped event)', async () => {
    const characterPort = makePort([
      makeCreated(DM_ID),
      {
        id: eventId(),
        stream: `char:${CHARACTER_ID}`,
        ts: '2026-09-26T00:00:00.000Z',
        actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
        type: 'character.campaign_left',
        v: 1,
        payload: { campaignId: CAMPAIGN_ID },
        seq: 2,
      },
      {
        id: eventId(),
        stream: `char:${CHARACTER_ID}`,
        ts: '2026-09-26T00:00:00.000Z',
        actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
        type: 'character.campaign_joined',
        v: 1,
        payload: { campaignId: CAMPAIGN_ID },
        seq: 3,
      },
      {
        id: eventId(),
        stream: `char:${CHARACTER_ID}`,
        ts: '2026-09-26T00:00:00.000Z',
        actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
        type: 'character.owner_transferred',
        v: 1,
        payload: { toUserId: MEMBER_ID },
        seq: 4,
      },
    ]);
    const campaignPort = makePort([]);
    const roster = { current: { ownerId: MEMBER_ID, left: false } };
    const transferCalls: string[] = [];
    fetchImpl.current = (input) => {
      transferCalls.push(requestUrl(input));
      return Promise.resolve(new Response(null, { status: 204 }));
    };

    const outcome = await runPregenHandoverSequence(
      makeParams(characterPort, campaignPort, roster),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.steps.every((s) => s.outcome === 'skipped')).toBe(true);
    expect(transferCalls).toEqual([]); // the route is never called once already-transferred
  });

  it('stops and reports a rejected step (a genuine server reject, no exception) without attempting the next one', async () => {
    const characterPort = makePort([makeCreated(DM_ID)]);
    const campaignPort = makePort([]);
    const roster = { current: { ownerId: DM_ID, left: false } };
    // A REAL reject frame never throws — `appendTx` resolves normally, but the event never gains a
    // seq and is later removed (`dropPending`'s own contract, `campaign-link-sequence.ts`'s doc
    // comment) — simulated here by writing a pending row that's removed before the poll's first
    // tick.
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

  it('a THROWN exception (e.g. a not-leader error) from an appendTx-based step propagates out of the sequence rather than being folded into a step result — the UI caller needs the real error type to pick the right message', async () => {
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

  describe('step 5 (ownerTransfer) — POST /api/characters/:id/transfer', () => {
    it('calls the route with the bare characterId and {toUserId}, and reports "committed" on 204', async () => {
      const characterPort = makePort([
        makeCreated(DM_ID),
        {
          id: eventId(),
          stream: `char:${CHARACTER_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
          type: 'character.campaign_left',
          v: 1,
          payload: { campaignId: CAMPAIGN_ID },
          seq: 2,
        },
        {
          id: eventId(),
          stream: `char:${CHARACTER_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
          type: 'character.campaign_joined',
          v: 1,
          payload: { campaignId: CAMPAIGN_ID },
          seq: 3,
        },
      ]);
      const campaignPort = makePort([]);
      const roster = { current: { ownerId: MEMBER_ID, left: false } };
      const calls: { url: string; body: unknown }[] = [];
      fetchImpl.current = (input, init) => {
        calls.push({
          url: requestUrl(input),
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        return Promise.resolve(new Response(null, { status: 204 }));
      };

      const outcome = await runPregenHandoverSequence(
        makeParams(characterPort, campaignPort, roster),
      );

      expect(outcome.steps.at(-1)).toEqual({ step: 'ownerTransfer', outcome: 'committed' });
      expect(calls).toEqual([
        { url: `/api/characters/${CHARACTER_ID}/transfer`, body: { toUserId: MEMBER_ID } },
      ]);
    });

    it('reports "rejected" (not a throw) when the route answers a server ApiError (e.g. 409)', async () => {
      const characterPort = makePort([
        makeCreated(DM_ID),
        {
          id: eventId(),
          stream: `char:${CHARACTER_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
          type: 'character.campaign_left',
          v: 1,
          payload: { campaignId: CAMPAIGN_ID },
          seq: 2,
        },
        {
          id: eventId(),
          stream: `char:${CHARACTER_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
          type: 'character.campaign_joined',
          v: 1,
          payload: { campaignId: CAMPAIGN_ID },
          seq: 3,
        },
      ]);
      const campaignPort = makePort([]);
      const roster = { current: { ownerId: MEMBER_ID, left: false } };
      fetchImpl.current = () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'quota_exceeded', message: 'over budget' }), {
            status: 409,
          }),
        );

      const outcome = await runPregenHandoverSequence(
        makeParams(characterPort, campaignPort, roster),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.steps.at(-1)).toEqual({ step: 'ownerTransfer', outcome: 'rejected' });
    });

    it('reports "rejected" (not a throw) on a network-level failure (ApiError status 0)', async () => {
      const characterPort = makePort([
        makeCreated(DM_ID),
        {
          id: eventId(),
          stream: `char:${CHARACTER_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
          type: 'character.campaign_left',
          v: 1,
          payload: { campaignId: CAMPAIGN_ID },
          seq: 2,
        },
        {
          id: eventId(),
          stream: `char:${CHARACTER_ID}`,
          ts: '2026-09-26T00:00:00.000Z',
          actor: { userId: DM_ID, deviceId: 'dev_1', role: 'owner' },
          type: 'character.campaign_joined',
          v: 1,
          payload: { campaignId: CAMPAIGN_ID },
          seq: 3,
        },
      ]);
      const campaignPort = makePort([]);
      const roster = { current: { ownerId: MEMBER_ID, left: false } };
      fetchImpl.current = () => Promise.reject(new Error('offline'));

      const outcome = await runPregenHandoverSequence(
        makeParams(characterPort, campaignPort, roster),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.steps.at(-1)).toEqual({ step: 'ownerTransfer', outcome: 'rejected' });
    });
  });
});
