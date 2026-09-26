import { signal, type WritableSignal } from '@angular/core';
import type { Event } from '@hk/protocol';
import type { DraftEvent } from '../../stores/character.store';
import {
  appendAndAwaitAck,
  bareCharacterId,
  campaignCharacterLinkDraft,
  characterCampaignLinkDraft,
  runCampaignLinkSequence,
  retryCampaignLinkStepB,
  awaitEventSettled,
  type AppendablePort,
  type CampaignLinkParams,
} from './campaign-link-sequence';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const CHARACTER_STREAM = 'char:00000000-0000-4000-8000-0000000000c1';
const CHARACTER_BARE = '00000000-0000-4000-8000-0000000000c1';
const OWNER_ID = 'usr_owner1';

let nextId = 1;
function freshId(): string {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
}

function mkEvent(type: string, payload: unknown, seq?: number, id?: string): Event {
  return {
    id: id ?? freshId(),
    stream: CHARACTER_STREAM,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: OWNER_ID, deviceId: 'dev_1', role: 'owner' },
    type,
    v: 1,
    payload,
    ...(seq !== undefined ? { seq } : {}),
  };
}

/** A fake `AppendablePort` — `appendTx` mutates `state` itself, mirroring how
 * `CharacterStore`/`CampaignStore` synchronously update their `events` signal by the time
 * `appendTx`'s returned promise resolves (see `campaign-link-sequence.ts`'s own doc for why this
 * diffing approach exists at all). Tests override `appendTx`'s behavior per case via
 * `state.set(...)` inside a custom implementation, or use `pushPending` for the common case. */
function makePort(initial: Event[] = []): {
  port: AppendablePort;
  state: WritableSignal<Event[]>;
  appendTx: ReturnType<typeof vi.fn>;
} {
  const state = signal<Event[]>(initial);
  const appendTx = vi.fn((drafts: DraftEvent[]): Promise<void> => {
    const draft = drafts[0];
    state.set([...state(), mkEvent(draft.type, draft.payload)]);
    return Promise.resolve();
  });
  return { port: { events: state.asReadonly(), appendTx }, state, appendTx };
}

function settle(state: WritableSignal<Event[]>, eventId: string, seq: number): void {
  state.set(state().map((e) => (e.id === eventId ? { ...e, seq } : e)));
}

function reject(state: WritableSignal<Event[]>, eventId: string): void {
  state.set(state().filter((e) => e.id !== eventId));
}

/** Same "poll rather than fake-timer" precedent as `campaign.store.spec.ts`'s own `waitFor` — this
 * module has no real I/O to fake-time around, but the identical shape keeps the convention
 * consistent across this package's async-store-signal tests. Unlike that helper's plain
 * boolean-returning predicate, this one takes an ASSERTION (an `expect(...)` call, which throws on
 * failure) — retried until it stops throwing or `timeoutMs` elapses, at which point the last
 * (real, descriptive) assertion error is rethrown instead of a generic "timed out" message. */
async function waitFor(predicate: () => void, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      predicate();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

describe('draft builders', () => {
  it('characterCampaignLinkDraft("join") builds character.campaign_joined@1 {campaignId}', () => {
    expect(characterCampaignLinkDraft('join', CAMPAIGN_ID)).toEqual({
      type: 'character.campaign_joined',
      v: 1,
      payload: { campaignId: CAMPAIGN_ID },
    });
  });

  it('characterCampaignLinkDraft("leave") builds character.campaign_left@1 {campaignId}', () => {
    expect(characterCampaignLinkDraft('leave', CAMPAIGN_ID)).toEqual({
      type: 'character.campaign_left',
      v: 1,
      payload: { campaignId: CAMPAIGN_ID },
    });
  });

  it('campaignCharacterLinkDraft("join") builds campaign.character_joined@1 {characterId, ownerId, name}, stripping char: prefix', () => {
    expect(
      campaignCharacterLinkDraft('join', {
        characterId: CHARACTER_STREAM,
        ownerId: OWNER_ID,
        characterName: 'Aria',
      }),
    ).toEqual({
      type: 'campaign.character_joined',
      v: 1,
      payload: { characterId: CHARACTER_BARE, ownerId: OWNER_ID, name: 'Aria' },
    });
  });

  it('campaignCharacterLinkDraft("leave") builds campaign.character_left@1', () => {
    expect(
      campaignCharacterLinkDraft('leave', {
        characterId: CHARACTER_BARE,
        ownerId: OWNER_ID,
        characterName: 'Aria',
      }),
    ).toEqual({
      type: 'campaign.character_left',
      v: 1,
      payload: { characterId: CHARACTER_BARE, ownerId: OWNER_ID, name: 'Aria' },
    });
  });

  it('bareCharacterId strips a char: prefix and is a no-op on an already-bare id', () => {
    expect(bareCharacterId(CHARACTER_STREAM)).toBe(CHARACTER_BARE);
    expect(bareCharacterId(CHARACTER_BARE)).toBe(CHARACTER_BARE);
  });
});

describe('awaitEventSettled', () => {
  it('resolves "committed" once the event gains a seq', async () => {
    const { port, state } = makePort([mkEvent('character.campaign_joined', {}, undefined, 'e1')]);
    setTimeout(() => settle(state, 'e1', 7), 15);

    const outcome = await awaitEventSettled(port.events, 'e1', { pollMs: 5, timeoutMs: 500 });
    expect(outcome).toBe('committed');
  });

  it('resolves "rejected" once the event disappears', async () => {
    const { port, state } = makePort([mkEvent('character.campaign_joined', {}, undefined, 'e1')]);
    setTimeout(() => reject(state, 'e1'), 15);

    const outcome = await awaitEventSettled(port.events, 'e1', { pollMs: 5, timeoutMs: 500 });
    expect(outcome).toBe('rejected');
  });

  it('resolves "timeout" when the event stays pending past timeoutMs', async () => {
    const { port } = makePort([mkEvent('character.campaign_joined', {}, undefined, 'e1')]);

    const outcome = await awaitEventSettled(port.events, 'e1', { pollMs: 5, timeoutMs: 30 });
    expect(outcome).toBe('timeout');
  });
});

describe('appendAndAwaitAck', () => {
  it('captures the newly-appended event and awaits its settlement (committed)', async () => {
    const { port, state } = makePort();
    const draft: DraftEvent = {
      type: 'character.campaign_joined',
      v: 1,
      payload: { campaignId: CAMPAIGN_ID },
    };

    const promise = appendAndAwaitAck(port, draft, { pollMs: 5, timeoutMs: 500 });
    // appendTx resolves synchronously-ish (no real I/O in this fake); grab the id it just wrote.
    await Promise.resolve();
    const written = state().find((e) => e.type === draft.type);
    expect(written).toBeDefined();
    setTimeout(() => settle(state, written!.id, 3), 15);

    const result = await promise;
    expect(result.outcome).toBe('committed');
    expect(result.event.type).toBe('character.campaign_joined');
    expect(result.event.payload).toEqual({ campaignId: CAMPAIGN_ID });
  });

  it('ignores a pre-existing same-type event when diffing before/after', async () => {
    const preExisting = mkEvent('character.campaign_joined', { campaignId: 'old' });
    const { port, state } = makePort([preExisting]);
    const draft: DraftEvent = {
      type: 'character.campaign_joined',
      v: 1,
      payload: { campaignId: CAMPAIGN_ID },
    };

    const promise = appendAndAwaitAck(port, draft, { pollMs: 5, timeoutMs: 500 });
    await Promise.resolve();
    const written = state().find((e) => e.id !== preExisting.id && e.type === draft.type)!;
    settle(state, written.id, 1);

    const result = await promise;
    expect(result.event.id).not.toBe(preExisting.id);
    expect(result.event.payload).toEqual({ campaignId: CAMPAIGN_ID });
  });

  it('throws when appendTx resolves but no matching new event is observed', async () => {
    const state = signal<Event[]>([]);
    const appendTx = vi.fn((): Promise<void> => Promise.resolve()); // does NOT write anything
    const port: AppendablePort = { events: state.asReadonly(), appendTx };
    const draft: DraftEvent = {
      type: 'character.campaign_joined',
      v: 1,
      payload: { campaignId: CAMPAIGN_ID },
    };

    await expect(appendAndAwaitAck(port, draft)).rejects.toThrow(/no new/i);
  });
});

describe('runCampaignLinkSequence / retryCampaignLinkStepB', () => {
  function baseParams(overrides: {
    characterPort: AppendablePort;
    campaignPort: AppendablePort;
    action?: 'join' | 'leave';
  }): CampaignLinkParams {
    return {
      action: overrides.action ?? 'join',
      characterPort: overrides.characterPort,
      campaignPort: overrides.campaignPort,
      campaignId: CAMPAIGN_ID,
      characterId: CHARACTER_STREAM,
      ownerId: OWNER_ID,
      characterName: 'Aria',
      ackOpts: { pollMs: 5, timeoutMs: 500 },
    };
  }

  it('JOIN happy path: both steps committed in order, character first', async () => {
    const charPort = makePort();
    const campPort = makePort();
    const params = baseParams({ characterPort: charPort.port, campaignPort: campPort.port });

    const resultPromise = runCampaignLinkSequence(params);
    // Settle whichever step is currently pending, in turn.
    await waitFor(() => {
      const e = charPort.state().find((ev) => ev.type === 'character.campaign_joined');
      expect(e).toBeDefined();
    });
    const charEvent = charPort.state().find((ev) => ev.type === 'character.campaign_joined')!;
    settle(charPort.state, charEvent.id, 1);

    await waitFor(() => {
      const e = campPort.state().find((ev) => ev.type === 'campaign.character_joined');
      expect(e).toBeDefined();
    });
    const campEvent = campPort.state().find((ev) => ev.type === 'campaign.character_joined')!;
    settle(campPort.state, campEvent.id, 1);

    const outcome = await resultPromise;
    expect(outcome.ok).toBe(true);
    expect(outcome.steps.map((s) => s.step)).toEqual(['character', 'campaign']);
    expect(outcome.steps.every((s) => s.outcome === 'committed')).toBe(true);
    expect(charEvent.payload).toEqual({ campaignId: CAMPAIGN_ID });
    expect(campEvent.payload).toEqual({
      characterId: CHARACTER_BARE,
      ownerId: OWNER_ID,
      name: 'Aria',
    });
    // Step (b) must never be sent before step (a) committed — assert ordering, not just outcome.
    expect(campPort.appendTx).toHaveBeenCalledTimes(1);
  });

  it('LEAVE happy path uses character.campaign_left / campaign.character_left', async () => {
    const charPort = makePort();
    const campPort = makePort();
    const params = baseParams({
      characterPort: charPort.port,
      campaignPort: campPort.port,
      action: 'leave',
    });

    const resultPromise = runCampaignLinkSequence(params);
    await waitFor(() => {
      expect(charPort.state().find((ev) => ev.type === 'character.campaign_left')).toBeDefined();
    });
    settle(
      charPort.state,
      charPort.state().find((ev) => ev.type === 'character.campaign_left')!.id,
      1,
    );

    await waitFor(() => {
      expect(campPort.state().find((ev) => ev.type === 'campaign.character_left')).toBeDefined();
    });
    settle(
      campPort.state,
      campPort.state().find((ev) => ev.type === 'campaign.character_left')!.id,
      1,
    );

    const outcome = await resultPromise;
    expect(outcome.ok).toBe(true);
    expect(outcome.steps.map((s) => s.event.type)).toEqual([
      'character.campaign_left',
      'campaign.character_left',
    ]);
  });

  it('step (a) rejected stops the sequence — step (b) is never sent', async () => {
    const charPort = makePort();
    const campPort = makePort();
    const params = baseParams({ characterPort: charPort.port, campaignPort: campPort.port });

    const resultPromise = runCampaignLinkSequence(params);
    await waitFor(() => {
      expect(charPort.state().find((ev) => ev.type === 'character.campaign_joined')).toBeDefined();
    });
    reject(
      charPort.state,
      charPort.state().find((ev) => ev.type === 'character.campaign_joined')!.id,
    );

    const outcome = await resultPromise;
    expect(outcome.ok).toBe(false);
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]).toMatchObject({ step: 'character', outcome: 'rejected' });
    expect(campPort.appendTx).not.toHaveBeenCalled();
  });

  it('the (a)-committed/(b)-rejected recovery path: step (b) reject is reported, then retryCampaignLinkStepB alone succeeds', async () => {
    const charPort = makePort();
    const campPort = makePort();
    const params = baseParams({ characterPort: charPort.port, campaignPort: campPort.port });

    const resultPromise = runCampaignLinkSequence(params);
    await waitFor(() => {
      expect(charPort.state().find((ev) => ev.type === 'character.campaign_joined')).toBeDefined();
    });
    settle(
      charPort.state,
      charPort.state().find((ev) => ev.type === 'character.campaign_joined')!.id,
      1,
    );

    await waitFor(() => {
      expect(campPort.state().find((ev) => ev.type === 'campaign.character_joined')).toBeDefined();
    });
    reject(
      campPort.state,
      campPort.state().find((ev) => ev.type === 'campaign.character_joined')!.id,
    );

    const outcome = await resultPromise;
    expect(outcome.ok).toBe(false);
    expect(outcome.steps).toHaveLength(2);
    expect(outcome.steps[1]).toMatchObject({ step: 'campaign', outcome: 'rejected' });

    // Recovery: retry ONLY step (b) — character-side appendTx must not be called again.
    const retryPromise = retryCampaignLinkStepB(params);
    await waitFor(() => {
      expect(campPort.appendTx).toHaveBeenCalledTimes(2);
    });
    const retryEvent = campPort
      .state()
      .filter((ev) => ev.type === 'campaign.character_joined')
      .at(-1)!;
    settle(campPort.state, retryEvent.id, 2);

    const retryResult = await retryPromise;
    expect(retryResult).toMatchObject({ step: 'campaign', outcome: 'committed' });
    expect(charPort.appendTx).toHaveBeenCalledTimes(1); // never re-sent
  });

  // Fix round 1 (finding 2): retryCampaignLinkStepB must re-verify (a) is genuinely COMMITTED —
  // not just present — before ever sending (b), since a caller's own snapshot of (a) (e.g. a
  // picker's candidate list) can be stale.
  describe('retryCampaignLinkStepB re-verifies step (a) before sending (b)', () => {
    it('a still-PENDING (a) that goes on to commit: waits for it, THEN sends (b) — no doomed round trip', async () => {
      const pendingCharEvent = mkEvent(
        'character.campaign_joined',
        { campaignId: CAMPAIGN_ID },
        undefined,
        'pending-a',
      );
      const charPort = makePort([pendingCharEvent]);
      const campPort = makePort();
      const params = baseParams({ characterPort: charPort.port, campaignPort: campPort.port });

      const retryPromise = retryCampaignLinkStepB(params);
      // (b) must not be sent while (a) is still pending.
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(campPort.appendTx).not.toHaveBeenCalled();

      settle(charPort.state, 'pending-a', 1);

      await waitFor(() => {
        expect(
          campPort.state().find((ev) => ev.type === 'campaign.character_joined'),
        ).toBeDefined();
      });
      settle(
        campPort.state,
        campPort.state().find((ev) => ev.type === 'campaign.character_joined')!.id,
        1,
      );

      const result = await retryPromise;
      expect(result).toMatchObject({ step: 'campaign', outcome: 'committed' });
      expect(charPort.appendTx).not.toHaveBeenCalled(); // (a) was never RE-sent, only awaited
    });

    it('a still-PENDING (a) that ends up REJECTED: returns the character-step result and never sends (b) at all', async () => {
      const pendingCharEvent = mkEvent(
        'character.campaign_joined',
        { campaignId: CAMPAIGN_ID },
        undefined,
        'pending-a-2',
      );
      const charPort = makePort([pendingCharEvent]);
      const campPort = makePort();
      const params = baseParams({ characterPort: charPort.port, campaignPort: campPort.port });

      const retryPromise = retryCampaignLinkStepB(params);
      await new Promise((resolve) => setTimeout(resolve, 10));
      reject(charPort.state, 'pending-a-2');

      const result = await retryPromise;
      expect(result).toMatchObject({ step: 'character', outcome: 'rejected' });
      expect(campPort.appendTx).not.toHaveBeenCalled();
    });

    it('an ALREADY-committed (a) proceeds straight to (b) with no wait at all', async () => {
      const committedCharEvent = mkEvent(
        'character.campaign_joined',
        { campaignId: CAMPAIGN_ID },
        1,
        'committed-a',
      );
      const charPort = makePort([committedCharEvent]);
      const campPort = makePort();
      const params = baseParams({ characterPort: charPort.port, campaignPort: campPort.port });

      const retryPromise = retryCampaignLinkStepB(params);
      await waitFor(() => {
        expect(campPort.appendTx).toHaveBeenCalledTimes(1);
      });
      settle(
        campPort.state,
        campPort.state().find((ev) => ev.type === 'campaign.character_joined')!.id,
        1,
      );

      const result = await retryPromise;
      expect(result).toMatchObject({ step: 'campaign', outcome: 'committed' });
    });
  });
});
