/**
 * plan-9 Task 6: `CharacterActor`'s `meta.campaignId` set/clear (`character.campaign_joined`/
 * `character.campaign_left`) and its after-commit campaign-notify hook (`Rpc.notify`, the
 * previously-no-op `ports/infra.ts` port now genuinely called). Against the same in-memory
 * `FakeStreamStore`/`FakeConnections` fakes `characters.test.ts`'s own `CharacterActor` block
 * uses, plus `FakeRpc` (`test/helpers/fake-rpc.ts`) as a REAL (not stubbed) `Rpc` double so
 * `notify`'s exact arguments can be asserted against directly.
 */
import type { Actor, Event } from '@hk/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import * as permissions from '../../src/core/permissions.ts';
import * as quotas from '../../src/core/quotas.ts';
import { CharacterActor } from '../../src/core/streams/character-actor.ts';
import { FakeConnections } from '../helpers/fake-connections.ts';
import { FakeRpc } from '../helpers/fake-rpc.ts';
import { FakeStreamStore } from '../helpers/fake-stream-store.ts';

const CHARACTER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const STREAM_ID = `char:${CHARACTER_ID}`;
const CAMPAIGN_ID = 'b1b2c3d4-0000-4000-8000-000000000002';
const OTHER_CAMPAIGN_ID = 'c1b2c3d4-0000-4000-8000-000000000003';
const OWNER: Actor = { userId: 'usr_owner', role: 'owner' };

let idCounter = 0;
/** A deterministic, distinct-per-call UUID — this file doesn't need `uuidv7`'s real randomness,
 * only ids that are valid UUIDs and never collide within one test. */
function nextId(): string {
  idCounter += 1;
  return `d0000000-0000-4000-8000-${idCounter.toString().padStart(12, '0')}`;
}

function makeSystem() {
  const store = new FakeStreamStore();
  const connections = new FakeConnections();
  const rpc = new FakeRpc();
  const actor = new CharacterActor({ store, connections, quotas, permissions, streamId: STREAM_ID, rpc });
  return { store, connections, rpc, actor };
}

function makeEvent(type: string, payload: Record<string, unknown>, overrides: Partial<Event> = {}): Event {
  return {
    id: nextId(),
    stream: STREAM_ID,
    ts: new Date().toISOString(),
    actor: { userId: OWNER.userId, deviceId: 'device-1', role: 'owner' },
    type,
    v: 1,
    payload,
    ...overrides,
  };
}

function makeCreated(): Event {
  return makeEvent('character.created', {
    name: 'Aria',
    system: 'srd-5e-2024',
    corePack: { id: 'srd-5e-2024', version: '1.0.0' },
    engineVersion: '1.0.0',
    grammaticalGender: 'feminine',
  });
}

let system: ReturnType<typeof makeSystem>;

beforeEach(() => {
  system = makeSystem();
});

describe('meta.campaignId set/clear', () => {
  it('is undefined before any character.campaign_joined', async () => {
    await system.actor.append([makeCreated()], OWNER);
    const meta = await system.actor.getCharacterMeta();
    expect(meta.campaignId).toBeUndefined();
  });

  it('character.campaign_joined sets meta.campaignId from its payload', async () => {
    await system.actor.append([makeCreated()], OWNER);
    await system.actor.append([makeEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID })], OWNER);

    const meta = await system.actor.getCharacterMeta();
    expect(meta.campaignId).toBe(CAMPAIGN_ID);
  });

  it('character.campaign_left clears meta.campaignId back to undefined', async () => {
    await system.actor.append([makeCreated()], OWNER);
    await system.actor.append([makeEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID })], OWNER);
    await system.actor.append([makeEvent('character.campaign_left', { campaignId: CAMPAIGN_ID })], OWNER);

    const meta = await system.actor.getCharacterMeta();
    expect(meta.campaignId).toBeUndefined();
  });

  it('a later character.campaign_joined can re-link to a different campaign (overwrite, no equality check)', async () => {
    await system.actor.append([makeCreated()], OWNER);
    await system.actor.append([makeEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID })], OWNER);
    await system.actor.append([makeEvent('character.campaign_joined', { campaignId: OTHER_CAMPAIGN_ID })], OWNER);

    const meta = await system.actor.getCharacterMeta();
    expect(meta.campaignId).toBe(OTHER_CAMPAIGN_ID);
  });
});

describe('after-commit campaign notify (Rpc.notify)', () => {
  it('never calls rpc.notify when the character has no campaign link at all', async () => {
    await system.actor.append([makeCreated()], OWNER);
    expect(system.rpc.notifyCalls).toEqual([]);
  });

  it('notifies the newly-joined campaign, including the join event itself, the moment character.campaign_joined commits', async () => {
    await system.actor.append([makeCreated()], OWNER);
    const joined = makeEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID });

    await system.actor.append([joined], OWNER);

    expect(system.rpc.notifyCalls).toHaveLength(1);
    expect(system.rpc.notifyCalls[0]).toMatchObject({ toStream: `camp:${CAMPAIGN_ID}`, fromStream: STREAM_ID });
    expect(system.rpc.notifyCalls[0]?.events.map((e) => e.id)).toEqual([joined.id]);
  });

  it('notifies the linked campaign for an ordinary in-play commit once already joined', async () => {
    await system.actor.append([makeCreated()], OWNER);
    await system.actor.append([makeEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID })], OWNER);

    const hpChanged = makeEvent('hp.changed', { delta: -3, kind: 'damage' });
    await system.actor.append([hpChanged], OWNER);

    const lastCall = system.rpc.notifyCalls.at(-1);
    expect(lastCall).toMatchObject({ toStream: `camp:${CAMPAIGN_ID}` });
    expect(lastCall?.events.map((e) => e.id)).toEqual([hpChanged.id]);
  });

  it('still notifies the OLD campaign for a character.campaign_left commit (the formula falls back to beforeCampaignId)', async () => {
    await system.actor.append([makeCreated()], OWNER);
    await system.actor.append([makeEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID })], OWNER);

    const left = makeEvent('character.campaign_left', { campaignId: CAMPAIGN_ID });
    await system.actor.append([left], OWNER);

    const lastCall = system.rpc.notifyCalls.at(-1);
    expect(lastCall).toMatchObject({ toStream: `camp:${CAMPAIGN_ID}` });
    expect(lastCall?.events.map((e) => e.id)).toEqual([left.id]);

    // And now unlinked: a further commit notifies nobody.
    await system.actor.append([makeEvent('hp.changed', { delta: 1, kind: 'heal' })], OWNER);
    expect(system.rpc.notifyCalls).toHaveLength(2); // unchanged from the campaign_left call above
  });

  it('never notifies for a rejected append (nothing acked)', async () => {
    await system.actor.append([makeCreated()], OWNER);
    await system.actor.append([makeEvent('character.campaign_joined', { campaignId: CAMPAIGN_ID })], OWNER);
    const before = system.rpc.notifyCalls.length;

    const memberActor: Actor = { userId: 'usr_intruder', role: 'member' };
    const outcome = await system.actor.append([makeEvent('hp.changed', { delta: -1, kind: 'damage' })], memberActor);

    expect(outcome.rejected).toHaveLength(1);
    expect(system.rpc.notifyCalls.length).toBe(before);
  });
});
