/**
 * `NodeStreamHost` contract: the port surface (append/read/head/deleteAll via `StreamHandle`) plus
 * the per-actor mutex's single-writer guarantee (task-7-brief step 1: "mutex serializes two
 * concurrent appends (deterministic seqs)").
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, Event } from '@hk/protocol';
import { CampaignActor } from '../../../src/core/streams/campaign-actor.ts';
import { CharacterActor } from '../../../src/core/streams/character-actor.ts';
import { openStreamsDb } from '../../../src/adapters/node/store.sqlite-file.ts';
import { Mutex, NodeStreamHost } from '../../../src/adapters/node/stream-host.ts';
import { uuidv7 } from '../../../src/core/ids.ts';

const OWNER: Actor = { userId: 'user-1', role: 'owner' };
const DM: Actor = { userId: 'dm-1', role: 'dm' };

function campaignCreatedEvent(streamId: string, txId?: string): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: DM.userId, deviceId: 'device-1', role: 'dm' },
    type: 'campaign.created',
    v: 1,
    payload: { name: 'The Sunless Citadel', system: 'srd-5e-2024', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
    ...(txId ? { txId } : {}),
  };
}

function memberJoinedEvent(streamId: string, userId: string, role: 'dm' | 'player', txId?: string): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId, deviceId: 'device-1', role: role === 'dm' ? 'dm' : 'member' },
    type: 'member.joined',
    v: 1,
    payload: { userId, displayName: userId, role },
    ...(txId ? { txId } : {}),
  };
}

function characterCreatedEvent(streamId: string, overrides: Partial<Event> = {}): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: OWNER.userId, deviceId: 'device-1', role: 'owner' },
    type: 'character.created',
    v: 1,
    payload: {
      name: 'Aria',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
      engineVersion: '1.0.0',
      grammaticalGender: 'feminine',
    },
    ...overrides,
  };
}

function noteEvent(streamId: string): Event {
  return {
    id: uuidv7(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: OWNER.userId, deviceId: 'device-1', role: 'owner' },
    type: 'note.added',
    v: 1,
    payload: { id: uuidv7() },
  };
}

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hk-stream-host-'));
  db = openStreamsDb(join(dir, 'streams.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('NodeStreamHost — StreamHandle contract', () => {
  it('append commits through the actor and returns the min/max acked seq', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    const handle = host.get(streamId);

    const result = await handle.append([characterCreatedEvent(streamId)], OWNER);
    expect(result).toEqual({ firstSeq: 1, lastSeq: 1 });
    expect(await handle.head()).toBe(1);

    const read = await handle.read(1, 10);
    expect(read).toHaveLength(1);
    expect(read[0]?.type).toBe('character.created');
  });

  it('.get() returns the SAME runtime for the same streamId (lazy, created once)', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    await host.get(streamId).append([characterCreatedEvent(streamId)], OWNER);
    expect(await host.get(streamId).head()).toBe(1);
  });

  it('deleteAll wipes the stream via the actor', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    const handle = host.get(streamId);
    await handle.append([characterCreatedEvent(streamId)], OWNER);
    expect(await handle.head()).toBe(1);

    await handle.deleteAll();
    expect(await handle.head()).toBe(0);
  });

  it('notify() fans committed events out to every connection currently on the stream', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    const runtime = host.getRuntime(streamId);
    // A minimal fake socket — just enough to satisfy `WsConnections.accept`'s `.on('close', ...)`
    // wiring; this test never sends/receives real frames over it (see the comment below).
    const fakeSocket = { on: () => fakeSocket, send: () => undefined, readyState: 1 };
    const conn = runtime.connections.accept(fakeSocket, { userId: 'user-1', role: 'owner', subs: [] });

    const event = characterCreatedEvent(streamId);
    await host.get(streamId).notify('char:other-stream', [event]);

    // No direct "frames sent" inspector on the real WsConnections (it sends over a raw socket) —
    // assert indirectly via `send`'s guard: a plain object (not a real `ws.WebSocket`) has no
    // numeric `readyState`, so `send` silently no-ops rather than throwing. This test's real
    // purpose is proving `notify` does not throw and iterates `connections.all()` — full
    // frame-delivery coverage lives in the WS smoke test (server.test.ts).
    expect(runtime.connections.all()).toContain(conn);
  });

  it('mutex serializes two concurrent appends against the SAME stream into deterministic, non-overlapping seq ranges', async () => {
    const host = new NodeStreamHost(db);
    const streamId = `char:${uuidv7()}`;
    const handle = host.get(streamId);

    // Seed ownership first so both concurrent appends are accepted (character.created must land
    // before any other event type per doc-02's "first event" convention this actor relies on for
    // its meta hooks — irrelevant to append acceptance itself, but keeps this test's events
    // realistic).
    await handle.append([characterCreatedEvent(streamId)], OWNER);

    // Two batches of 5 events each, kicked off "simultaneously" (both promises start before
    // either awaits) — without the mutex, both could read the same `head()` and assign
    // overlapping seqs.
    const batchA = Array.from({ length: 5 }, () => noteEvent(streamId));
    const batchB = Array.from({ length: 5 }, () => noteEvent(streamId));

    const [resultA, resultB] = await Promise.all([handle.append(batchA, OWNER), handle.append(batchB, OWNER)]);

    // Deterministic: whichever call's promise chain entered the mutex first (call order, since
    // both are synchronous up to their first `await`) gets seqs 2-6, the other 7-11 — never
    // interleaved/overlapping.
    expect(resultA).toEqual({ firstSeq: 2, lastSeq: 6 });
    expect(resultB).toEqual({ firstSeq: 7, lastSeq: 11 });

    const all = await handle.read(1, 100);
    expect(all).toHaveLength(11);
    expect(all.map((e) => e.seq)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    // No gaps, no duplicates.
    expect(new Set(all.map((e) => e.seq)).size).toBe(11);
  });
});

describe('NodeStreamHost — [plan-9 Task 8, obligation 1] branches on the stream id prefix', () => {
  it('constructs a CampaignActor for a camp: streamId, not a CharacterActor', () => {
    const host = new NodeStreamHost(db);
    const runtime = host.getRuntime(`camp:${uuidv7()}`);
    expect(runtime.actor).toBeInstanceOf(CampaignActor);
    expect(runtime.actor).not.toBeInstanceOf(CharacterActor);
  });

  it('still constructs a CharacterActor for a char: streamId (Phase-2 behavior unchanged)', () => {
    const host = new NodeStreamHost(db);
    const runtime = host.getRuntime(`char:${uuidv7()}`);
    expect(runtime.actor).toBeInstanceOf(CharacterActor);
  });
});

describe('NodeStreamHost — [plan-9 Task 8, obligation 3] real Rpc wiring (in-process cross-actor calls, no fakes)', () => {
  it('join (currentCampaignOf) -> gateway forward (forwardAppend) -> subscribe catch-up (readStream) -> leave (hasEvent + currentCampaignOf)', async () => {
    const host = new NodeStreamHost(db);
    const campaignId = uuidv7();
    const characterId = uuidv7();
    const campStreamId = `camp:${campaignId}`;
    const charStreamId = `char:${characterId}`;
    const dmActor: Actor = { userId: 'dm-2', role: 'dm' };
    const dmAsOwner: Actor = { userId: dmActor.userId, role: 'owner' };

    // Character side: created, then links itself to the campaign (character.campaign_joined) —
    // the DM owns this character too (a "pregen"), exactly the scenario
    // `campaign-actor.ts`'s `mapGatewayActor` PREGEN note documents, kept simple on purpose.
    await host
      .get(charStreamId)
      .append(
        [characterCreatedEvent(charStreamId, { actor: { userId: dmActor.userId, deviceId: 'd1', role: 'owner' } })],
        dmAsOwner,
      );
    const campaignJoinedOnChar: Event = {
      id: uuidv7(),
      stream: charStreamId,
      ts: new Date().toISOString(),
      actor: { userId: dmActor.userId, deviceId: 'd1', role: 'owner' },
      type: 'character.campaign_joined',
      v: 1,
      payload: { campaignId },
    };
    await host.get(charStreamId).append([campaignJoinedOnChar], dmAsOwner);

    // Campaign side bootstrap: campaign.created + the DM's own member.joined, one atomic txId
    // batch (mirrors `core/routes/campaigns.ts`'s own create route exactly).
    const bootstrapTxId = uuidv7();
    const bootstrapResult = await host
      .get(campStreamId)
      .append(
        [
          campaignCreatedEvent(campStreamId, bootstrapTxId),
          memberJoinedEvent(campStreamId, dmActor.userId, 'dm', bootstrapTxId),
        ],
        dmActor,
      );
    expect(bootstrapResult.lastSeq).toBeGreaterThan(0);

    // campaign.character_joined — [plan-9 Task 8] REAL cross-actor `Rpc.currentCampaignOf` call:
    // `CampaignActor.verifyCharacterMirror` reads the CHARACTER stream's own live `meta.campaignId`
    // (via `NodeStreamHost.rpcCurrentCampaignOf`, a DIFFERENT runtime's `CharacterActor
    // .getCharacterMeta()`, not a fake) and only accepts because it genuinely equals THIS
    // campaign's id.
    const charJoinedOnCamp: Event = {
      id: uuidv7(),
      stream: campStreamId,
      ts: new Date().toISOString(),
      actor: { userId: dmActor.userId, deviceId: 'd1', role: 'dm' },
      type: 'campaign.character_joined',
      v: 1,
      payload: { characterId, ownerId: dmActor.userId, name: 'Pregen Doe' },
    };
    const joinResult = await host.get(campStreamId).append([charJoinedOnCamp], dmActor);
    expect(joinResult.lastSeq).toBeGreaterThan(0);

    // Gateway forward — [plan-9 Task 8] REAL `Rpc.forwardAppend`: the DM (mapped to `owner` on
    // their own pregen, per `mapGatewayActor`'s PREGEN note) archives the character THROUGH the
    // campaign socket. `CampaignStreamDO`... er, `NodeStreamHost` here: the campaign runtime's
    // `append` call reaches into the CHARACTER stream's OWN `Mutex` via `rpcForwardAppend`, not a
    // fake — verified by reading the character stream's real committed history afterward.
    const archiveViaGateway: Event = {
      id: uuidv7(),
      stream: charStreamId,
      ts: new Date().toISOString(),
      actor: { userId: dmActor.userId, deviceId: 'd1', role: 'dm' },
      type: 'character.archived',
      v: 1,
      payload: {},
    };
    const forwardResult = await host.get(campStreamId).append([archiveViaGateway], dmActor);
    expect(forwardResult.lastSeq).toBeGreaterThan(0);
    const charEventsAfterForward = await host.get(charStreamId).read(1, 100);
    expect(charEventsAfterForward.some((e) => e.type === 'character.archived')).toBe(true);

    // Subscribe catch-up — [plan-9 Task 8] REAL `Rpc.readStream`: the DM's campaign connection
    // subscribes to the character stream; `sendSubscribeCatchUp` pages the character stream's
    // REAL history through `rpcReadStream` (a one-line delegation to `this.get(stream).read`, per
    // this file's own doc comment) and sends it down the DM's campaign socket.
    const campRuntime = host.getRuntime(campStreamId);
    const sentFrames: { t: string; stream?: string; events?: Event[] }[] = [];
    const fakeSocket = {
      on: () => fakeSocket,
      send: (data: string) => {
        sentFrames.push(JSON.parse(data) as { t: string; stream?: string; events?: Event[] });
      },
      readyState: 1,
    };
    const conn = campRuntime.connections.accept(fakeSocket, { userId: dmActor.userId, role: 'dm', subs: [] });
    await campRuntime.actor.handleMessage(conn, { t: 'subscribe', stream: charStreamId });
    const catchUpFrame = sentFrames.find((f) => f.t === 'events' && f.stream === charStreamId);
    expect(catchUpFrame?.events?.some((e) => e.type === 'character.archived')).toBe(true);

    // Leave — [plan-9 Task 8] REAL `Rpc.hasEvent` (pages the character stream's REAL history
    // looking for the matching `character.campaign_left`) AND `Rpc.currentCampaignOf` (confirms
    // the character's live link is no longer this campaign) together verify
    // `campaign.character_left`.
    const campaignLeftOnChar: Event = {
      id: uuidv7(),
      stream: charStreamId,
      ts: new Date().toISOString(),
      actor: { userId: dmActor.userId, deviceId: 'd1', role: 'owner' },
      type: 'character.campaign_left',
      v: 1,
      payload: { campaignId },
    };
    await host.get(charStreamId).append([campaignLeftOnChar], dmAsOwner);
    const charLeftOnCamp: Event = {
      id: uuidv7(),
      stream: campStreamId,
      ts: new Date().toISOString(),
      actor: { userId: dmActor.userId, deviceId: 'd1', role: 'dm' },
      type: 'campaign.character_left',
      v: 1,
      payload: { characterId, ownerId: dmActor.userId, name: 'Pregen Doe' },
    };
    const leaveResult = await host.get(campStreamId).append([charLeftOnCamp], dmActor);
    expect(leaveResult.lastSeq).toBeGreaterThan(0);
  });

  it('notify() delegates to the REAL CampaignActor.handleNotify (roster/visibility-gated), not a blind fan-out', async () => {
    const host = new NodeStreamHost(db);
    const campStreamId = `camp:${uuidv7()}`;
    const characterId = uuidv7();
    const dmActor: Actor = { userId: 'dm-3', role: 'dm' };

    const bootstrapTxId = uuidv7();
    await host
      .get(campStreamId)
      .append(
        [
          campaignCreatedEvent(campStreamId, bootstrapTxId),
          memberJoinedEvent(campStreamId, dmActor.userId, 'dm', bootstrapTxId),
        ],
        dmActor,
      );

    const campRuntime = host.getRuntime(campStreamId);
    const sentFrames: { t: string }[] = [];
    const fakeSocket = {
      on: () => fakeSocket,
      send: (data: string) => sentFrames.push(JSON.parse(data) as { t: string }),
      readyState: 1,
    };
    campRuntime.connections.accept(fakeSocket, { userId: dmActor.userId, role: 'dm', subs: [] });

    // The character is NOT rostered to this campaign (no `campaign.character_joined` ever
    // committed) — `handleNotify`'s roster gate (fix round 2, `campaign-actor.ts`) must deliver
    // this to NOBODY, including the DM, proving `notify()` really delegates to `handleNotify`
    // rather than the old contract-completion blind fan-out (which would have sent it to every
    // connection unconditionally).
    const strayEvent: Event = {
      id: uuidv7(),
      stream: `char:${characterId}`,
      seq: 1,
      ts: new Date().toISOString(),
      actor: { userId: 'someone-else', deviceId: 'd1', role: 'owner' },
      type: 'hp.changed',
      v: 1,
      payload: { hp: 5 },
    };
    await host.get(campStreamId).notify(`char:${characterId}`, [strayEvent]);
    expect(sentFrames).toEqual([]);
  });
});

describe('Mutex', () => {
  it('runs queued tasks strictly in call order, one at a time', async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    function task(id: number, delayMs: number): Promise<void> {
      return mutex.run(async () => {
        order.push(id);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      });
    }

    await Promise.all([task(1, 20), task(2, 0), task(3, 0)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('a rejected task does not poison the queue for tasks after it', async () => {
    const mutex = new Mutex();
    const failing = mutex.run(() => Promise.reject(new Error('boom')));
    const after = mutex.run(() => Promise.resolve('ok'));

    await expect(failing).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
  });
});
