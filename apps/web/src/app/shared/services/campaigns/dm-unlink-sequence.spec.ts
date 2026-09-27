import { signal, type WritableSignal } from '@angular/core';
import type { Event } from '@hk/protocol';
import type { DraftEvent } from '../../stores/character.store';
import type { AckOrReject } from '../../stores/campaign.store';
import { runDmUnlinkSequence, type DmUnlinkParams } from './dm-unlink-sequence';

const CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000a1';
const CHARACTER_ID = '00000000-0000-4000-8000-0000000000c1';
const OWNER_ID = 'usr_owner1';
const DM_ID = 'usr_dm1';

let nextId = 1;
function freshId(): string {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
}

function mkEvent(type: string, payload: unknown, seq?: number): Event {
  return {
    id: freshId(),
    stream: `camp:${CAMPAIGN_ID}`,
    ts: '2026-09-26T00:00:00.000Z',
    actor: { userId: DM_ID, deviceId: 'dev_dm', role: 'dm' },
    type,
    v: 1,
    payload,
    ...(seq !== undefined ? { seq } : {}),
  };
}

type AppendTxMock = ReturnType<typeof vi.fn<(drafts: DraftEvent[]) => Promise<void>>>;
type GatewayAppendMock = ReturnType<
  typeof vi.fn<(characterId: string, drafts: unknown[]) => Promise<AckOrReject>>
>;

/** A campaign `AppendablePort` stand-in that instantly commits every appended draft (step (b)). */
function instantCommitCampaignPort(): {
  events: WritableSignal<Event[]>;
  appendTx: AppendTxMock;
} {
  const events = signal<Event[]>([]);
  let seq = 1;
  const appendTx = vi.fn<(drafts: DraftEvent[]) => Promise<void>>((drafts) => {
    const draft = drafts[0];
    events.set([...events(), mkEvent(draft.type, draft.payload, seq++)]);
    return Promise.resolve();
  });
  return { events, appendTx };
}

function okGatewayAppend(): GatewayAppendMock {
  return vi
    .fn<(characterId: string, drafts: unknown[]) => Promise<AckOrReject>>()
    .mockResolvedValue({ acked: [{ id: 'x', seq: 1 }], rejected: [] });
}

function baseParams(overrides: Partial<DmUnlinkParams> = {}): DmUnlinkParams {
  const campaignPort = instantCommitCampaignPort();
  return {
    campaignPort,
    gatewayAppend: okGatewayAppend(),
    campaignId: CAMPAIGN_ID,
    characterId: CHARACTER_ID,
    ownerId: OWNER_ID,
    characterName: 'Aria',
    ...overrides,
  };
}

describe('runDmUnlinkSequence', () => {
  it('sends step (a) via gatewayAppend (character.campaign_left on char:<id>) BEFORE step (b)', async () => {
    const campaignPort = instantCommitCampaignPort();
    const callOrder: string[] = [];
    const gatewayAppend = vi
      .fn<(characterId: string, drafts: unknown[]) => Promise<AckOrReject>>()
      .mockImplementation(() => {
        callOrder.push('gateway');
        return Promise.resolve({ acked: [{ id: 'x', seq: 1 }], rejected: [] });
      });
    const events = campaignPort.events;
    let seq = 1;
    campaignPort.appendTx.mockImplementation((drafts) => {
      callOrder.push('campaign');
      const draft = drafts[0];
      events.set([...events(), mkEvent(draft.type, draft.payload, seq++)]);
      return Promise.resolve();
    });

    const outcome = await runDmUnlinkSequence(baseParams({ campaignPort, gatewayAppend }));

    expect(callOrder).toEqual(['gateway', 'campaign']);
    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'character.campaign_left', v: 1, payload: { campaignId: CAMPAIGN_ID } },
    ]);
    expect(outcome.ok).toBe(true);
    expect(outcome.steps).toEqual([
      { step: 'character', ok: true },
      { step: 'campaign', ok: true },
    ]);
  });

  it('step (b) payload carries the ROSTER entry ownerId, NOT the acting DM', async () => {
    const campaignPort = instantCommitCampaignPort();
    await runDmUnlinkSequence(baseParams({ campaignPort, ownerId: OWNER_ID }));

    expect(campaignPort.appendTx).toHaveBeenCalledTimes(1);
    const draft = campaignPort.appendTx.mock.calls[0][0][0];
    expect(draft).toEqual({
      type: 'campaign.character_left',
      v: 1,
      payload: { characterId: CHARACTER_ID, ownerId: OWNER_ID, name: 'Aria' },
    });
  });

  it('a rejected step (a) never attempts step (b), and surfaces the reject code/message', async () => {
    const campaignPort = instantCommitCampaignPort();
    const gatewayAppend = vi
      .fn<(characterId: string, drafts: unknown[]) => Promise<AckOrReject>>()
      .mockResolvedValue({
        acked: [],
        rejected: [{ id: 'x', code: 'forbidden', message: 'nope' }],
      });

    const outcome = await runDmUnlinkSequence(baseParams({ campaignPort, gatewayAppend }));

    expect(outcome.ok).toBe(false);
    expect(outcome.steps).toEqual([
      { step: 'character', ok: false, code: 'forbidden', message: 'nope' },
    ]);
    expect(campaignPort.appendTx).not.toHaveBeenCalled();
  });

  it('a THROWN gatewayAppend (e.g. CampaignGatewayUnavailableError) is folded into an ok:false step, not propagated', async () => {
    const gatewayAppend = vi
      .fn<(characterId: string, drafts: unknown[]) => Promise<AckOrReject>>()
      .mockRejectedValue(new Error('no live campaign session'));

    const outcome = await runDmUnlinkSequence(baseParams({ gatewayAppend }));

    expect(outcome.ok).toBe(false);
    expect(outcome.steps).toEqual([
      { step: 'character', ok: false, message: 'no live campaign session' },
    ]);
  });

  it('step (a) committed but step (b) never settles: outcome carries BOTH steps, ok:false', async () => {
    const campaignPort = instantCommitCampaignPort();
    // Writes a PENDING row (no `seq`) that never transitions — `appendAndAwaitAck` must observe a
    // new event to poll at all, so a no-op mock (nothing ever appears) would throw a DIFFERENT,
    // unrelated error ("no new event observed") instead of exercising the timeout path this test
    // targets.
    campaignPort.appendTx.mockImplementation((drafts) => {
      const draft = drafts[0];
      campaignPort.events.set([...campaignPort.events(), mkEvent(draft.type, draft.payload)]);
      return Promise.resolve();
    });

    const outcome = await runDmUnlinkSequence(
      baseParams({ campaignPort, ackOpts: { pollMs: 5, timeoutMs: 30 } }),
    );

    expect(outcome.steps.map((s) => s.step)).toEqual(['character', 'campaign']);
    expect(outcome.ok).toBe(false);
    expect(outcome.steps[1].ok).toBe(false);
  });

  it('a retry after a rejected step (a) simply re-runs the WHOLE sequence (step a is safe to resend)', async () => {
    const campaignPort = instantCommitCampaignPort();
    const gatewayAppend = vi
      .fn<(characterId: string, drafts: unknown[]) => Promise<AckOrReject>>()
      .mockResolvedValueOnce({ acked: [], rejected: [{ id: 'x', code: 'forbidden' }] })
      .mockResolvedValueOnce({ acked: [{ id: 'y', seq: 1 }], rejected: [] });
    const params = baseParams({ campaignPort, gatewayAppend });

    const first = await runDmUnlinkSequence(params);
    expect(first.ok).toBe(false);

    const second = await runDmUnlinkSequence(params);
    expect(second.ok).toBe(true);
    expect(gatewayAppend).toHaveBeenCalledTimes(2);
    expect(campaignPort.appendTx).toHaveBeenCalledTimes(1);
  });
});
