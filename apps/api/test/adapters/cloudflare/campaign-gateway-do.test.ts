/**
 * `CampaignStreamDO` <-> `CharacterStreamDO` — the REAL Cloudflare DO-to-DO gateway (plan-9 Task
 * 8, obligation 3's Cloudflare half). Every other Cloudflare test in this suite exercises ONE DO
 * class in isolation (`character-stream-do.test.ts`, `campaign-stream-do.test.ts`); this file is
 * the one place that proves the `Rpc` DO-to-DO wiring (`campaign-stream.do.ts`'s `buildRpc`,
 * `character-stream.do.ts`'s `buildRpc`) genuinely reaches across two SEPARATE DO instances under
 * `@cloudflare/vitest-pool-workers`'s real Miniflare-simulated bindings — not a fake `Rpc`, the
 * same real `env.CHARACTER_STREAM`/`env.CAMPAIGN_STREAM` bindings `worker.ts` itself uses.
 *
 * Calls each DO's own RPC methods directly (`append`/`read`, same "call the class instance inside
 * `runInDurableObject`" pattern `character-stream-do.test.ts` already uses for `deleteAll`) rather
 * than driving it through a real WS upgrade — this is a pool-workers-imposed WS/DO limitation
 * both existing files' header comments already document, not new to this file.
 */
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Actor, Event } from '@hk/protocol';
import { env } from './typed-env.ts';

interface AppendResult {
  readonly firstSeq: number;
  readonly lastSeq: number;
}

function callAppend(instance: unknown, streamId: string, events: Event[], actor: Actor): Promise<AppendResult> {
  return (instance as { append(id: string, e: Event[], a: Actor): Promise<AppendResult> }).append(
    streamId,
    events,
    actor,
  );
}

function callRead(instance: unknown, streamId: string, fromSeq: number, limit: number): Promise<Event[]> {
  return (instance as { read(id: string, from: number, limit: number): Promise<Event[]> }).read(
    streamId,
    fromSeq,
    limit,
  );
}

function characterCreatedEvent(streamId: string, ownerId: string): Event {
  return {
    id: crypto.randomUUID(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: ownerId, deviceId: 'device-1', role: 'owner' },
    type: 'character.created',
    v: 1,
    payload: {
      name: 'Pregen Doe',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
      engineVersion: '1.0.0',
      grammaticalGender: 'feminine',
    },
  };
}

describe('CampaignStreamDO <-> CharacterStreamDO — real DO-to-DO gateway (plan-9 Task 8, obligation 3)', () => {
  it('join (currentCampaignOf) -> gateway forward (forwardAppend/appendForGateway) -> leave (hasEvent + currentCampaignOf)', async () => {
    const campaignId = crypto.randomUUID();
    const characterId = crypto.randomUUID();
    const campStreamId = `camp:${campaignId}`;
    const charStreamId = `char:${characterId}`;
    const dmUserId = 'dm-gateway-1';
    const dmActor: Actor = { userId: dmUserId, role: 'dm' };
    const dmAsOwner: Actor = { userId: dmUserId, role: 'owner' };

    const campStub = env.CAMPAIGN_STREAM.get(env.CAMPAIGN_STREAM.idFromName(campStreamId));
    const charStub = env.CHARACTER_STREAM.get(env.CHARACTER_STREAM.idFromName(charStreamId));

    // Character side: created, then links itself to the campaign — a DM-owned pregen (kept
    // simple: same owner as the DM, matching `campaign-actor.ts`'s PREGEN note this test also
    // exercises via the gateway-forward step below).
    await runInDurableObject(charStub, async (instance) => {
      const created = await callAppend(
        instance,
        charStreamId,
        [characterCreatedEvent(charStreamId, dmUserId)],
        dmAsOwner,
      );
      expect(created.lastSeq).toBeGreaterThan(0);

      const joined: Event = {
        id: crypto.randomUUID(),
        stream: charStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'owner' },
        type: 'character.campaign_joined',
        v: 1,
        payload: { campaignId },
      };
      const joinedResult = await callAppend(instance, charStreamId, [joined], dmAsOwner);
      expect(joinedResult.lastSeq).toBeGreaterThan(created.lastSeq);
    });

    // Campaign side bootstrap (campaign.created + the DM's own member.joined, one atomic txId
    // batch, mirrors `core/routes/campaigns.ts`'s real create route).
    await runInDurableObject(campStub, async (instance) => {
      const txId = crypto.randomUUID();
      const createdEvent: Event = {
        id: crypto.randomUUID(),
        stream: campStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'dm' },
        type: 'campaign.created',
        v: 1,
        payload: {
          name: 'The Sunless Citadel',
          system: 'srd-5e-2024',
          corePack: { id: 'srd-5e-2024', version: '1.0.0' },
        },
        txId,
      };
      const memberJoinedEvent: Event = {
        id: crypto.randomUUID(),
        stream: campStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'dm' },
        type: 'member.joined',
        v: 1,
        payload: { userId: dmUserId, displayName: 'DM', role: 'dm' },
        txId,
      };
      const bootstrap = await callAppend(instance, campStreamId, [createdEvent, memberJoinedEvent], dmActor);
      expect(bootstrap.lastSeq).toBeGreaterThan(0);
    });

    // [Rpc.currentCampaignOf, real DO-to-DO call] campaign.character_joined's mirror verification
    // reads the CHARACTER DO's own LIVE meta.campaignId directly.
    await runInDurableObject(campStub, async (instance) => {
      const charJoinedOnCamp: Event = {
        id: crypto.randomUUID(),
        stream: campStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'dm' },
        type: 'campaign.character_joined',
        v: 1,
        payload: { characterId, ownerId: dmUserId, name: 'Pregen Doe' },
      };
      const joinResult = await callAppend(instance, campStreamId, [charJoinedOnCamp], dmActor);
      // The REAL assertion: this only succeeds (lastSeq > 0, not rejected) if `currentCampaignOf`
      // genuinely reached the CharacterStreamDO instance above and got back THIS campaign's id.
      expect(joinResult.lastSeq).toBeGreaterThan(0);
    });

    // [Rpc.forwardAppend, real DO-to-DO call] the DM (mapped to `owner` on their own pregen)
    // archives the character THROUGH the campaign socket — `appendForGateway` on the character DO
    // is what actually commits it there.
    await runInDurableObject(campStub, async (instance) => {
      const archiveViaGateway: Event = {
        id: crypto.randomUUID(),
        stream: charStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'dm' },
        type: 'character.archived',
        v: 1,
        payload: {},
      };
      const forwardResult = await callAppend(instance, campStreamId, [archiveViaGateway], dmActor);
      expect(forwardResult.lastSeq).toBeGreaterThan(0);
    });

    // Proof the forward genuinely committed on the CHARACTER DO's own storage (not just "didn't
    // throw" on the campaign side).
    await runInDurableObject(charStub, async (instance) => {
      const events = await callRead(instance, charStreamId, 1, 100);
      expect(events.some((e) => e.type === 'character.archived')).toBe(true);
    });

    // Leave flow — [Rpc.hasEvent + Rpc.currentCampaignOf, both real DO-to-DO calls]
    // `campaign.character_left`'s mirror check pages the CHARACTER DO's real history for the
    // matching `character.campaign_left` AND confirms the character's live link is no longer this
    // campaign.
    await runInDurableObject(charStub, async (instance) => {
      const left: Event = {
        id: crypto.randomUUID(),
        stream: charStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'owner' },
        type: 'character.campaign_left',
        v: 1,
        payload: { campaignId },
      };
      const leftResult = await callAppend(instance, charStreamId, [left], dmAsOwner);
      expect(leftResult.lastSeq).toBeGreaterThan(0);
    });

    await runInDurableObject(campStub, async (instance) => {
      const charLeftOnCamp: Event = {
        id: crypto.randomUUID(),
        stream: campStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'dm' },
        type: 'campaign.character_left',
        v: 1,
        payload: { characterId, ownerId: dmUserId, name: 'Pregen Doe' },
      };
      const leaveResult = await callAppend(instance, campStreamId, [charLeftOnCamp], dmActor);
      expect(leaveResult.lastSeq).toBeGreaterThan(0);
    });
  });

  it('a mirror verify that SHOULD fail (character never joined) is genuinely rejected, not silently accepted by a mis-wired Rpc', async () => {
    const campaignId = crypto.randomUUID();
    const characterId = crypto.randomUUID();
    const campStreamId = `camp:${campaignId}`;
    const dmUserId = 'dm-gateway-2';
    const dmActor: Actor = { userId: dmUserId, role: 'dm' };

    const campStub = env.CAMPAIGN_STREAM.get(env.CAMPAIGN_STREAM.idFromName(campStreamId));

    await runInDurableObject(campStub, async (instance) => {
      const txId = crypto.randomUUID();
      const createdEvent: Event = {
        id: crypto.randomUUID(),
        stream: campStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'dm' },
        type: 'campaign.created',
        v: 1,
        payload: { name: 'Empty Hall', system: 'srd-5e-2024', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
        txId,
      };
      const memberJoinedEvent: Event = {
        id: crypto.randomUUID(),
        stream: campStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'dm' },
        type: 'member.joined',
        v: 1,
        payload: { userId: dmUserId, displayName: 'DM', role: 'dm' },
        txId,
      };
      await callAppend(instance, campStreamId, [createdEvent, memberJoinedEvent], dmActor);

      // No `character.campaign_joined` was EVER committed on the character DO for this id — a
      // REAL `currentCampaignOf` call against that (never-touched) DO must return `undefined`,
      // which can never equal this campaign's id, so the mirror verify must fail.
      const charJoinedOnCamp: Event = {
        id: crypto.randomUUID(),
        stream: campStreamId,
        ts: new Date().toISOString(),
        actor: { userId: dmUserId, deviceId: 'd1', role: 'dm' },
        type: 'campaign.character_joined',
        v: 1,
        payload: { characterId, ownerId: dmUserId, name: 'Ghost' },
      };
      const joinResult = await callAppend(instance, campStreamId, [charJoinedOnCamp], dmActor);
      expect(joinResult.lastSeq).toBe(0);
    });
  });
});
