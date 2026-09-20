/**
 * plan-9 Task 6: the campaign GATEWAY (`CampaignActor.append`'s `char:`-forward path via
 * `Rpc.forwardAppend`), cross-stream MIRROR verification (`campaign.character_joined/left` via
 * `Rpc.hasEvent`), the after-commit NOTIFY fan-out (`CampaignActor.handleNotify`, receiving what
 * `CharacterActor`'s own hook sends via `Rpc.notify`), and DM SUBSCRIBE catch-up
 * (`Rpc.readStream`). A genuine TWO-ACTOR harness (task-6-brief: "real actors, fake stores/Rpc") —
 * a real `CampaignActor` and one-or-more real `CharacterActor`s, wired together through one shared
 * `FakeRpc` (`test/helpers/fake-rpc.ts`) that actually calls through to each actor's own append/
 * read/notify surface, so every assertion here observes genuine end-to-end pipeline behavior
 * (target-side permission re-checks, real committed events, real fan-out) rather than a stubbed
 * response.
 */
import type { Event } from '@hk/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import * as campaignPermissions from '../../src/core/campaign-permissions.ts';
import { uuidv7 } from '../../src/core/ids.ts';
import * as permissions from '../../src/core/permissions.ts';
import * as quotas from '../../src/core/quotas.ts';
import { campaignQuotas, CampaignActor } from '../../src/core/streams/campaign-actor.ts';
import { CharacterActor } from '../../src/core/streams/character-actor.ts';
import { FakeConnections } from '../helpers/fake-connections.ts';
import { actorTarget, FakeRpc } from '../helpers/fake-rpc.ts';
import { FakeStreamStore } from '../helpers/fake-stream-store.ts';

const CAMPAIGN_UUID = uuidv7();
const CAMP_STREAM_ID = `camp:${CAMPAIGN_UUID}`;
const DM_ID = 'usr_dm1';
const MEMBER_A = 'usr_alice';
const MEMBER_B = 'usr_bob';

interface TestActor {
  readonly userId: string;
  readonly role: 'owner' | 'dm' | 'member';
}
function dmActor(userId = DM_ID): TestActor {
  return { userId, role: 'dm' };
}
function memberActor(userId: string): TestActor {
  return { userId, role: 'member' };
}
function ownerActor(userId: string): TestActor {
  return { userId, role: 'owner' };
}

function makeCampEvent(
  type: string,
  payload: Record<string, unknown>,
  actor: TestActor,
  overrides: Partial<Event> = {},
): Event {
  return {
    id: uuidv7(),
    stream: CAMP_STREAM_ID,
    ts: new Date().toISOString(),
    actor: { userId: actor.userId, deviceId: 'device-1', role: actor.role },
    type,
    v: 1,
    payload,
    ...overrides,
  };
}

function makeCharEvent(
  characterId: string,
  type: string,
  payload: Record<string, unknown>,
  actor: TestActor,
  overrides: Partial<Event> = {},
): Event {
  return {
    id: uuidv7(),
    stream: `char:${characterId}`,
    ts: new Date().toISOString(),
    actor: { userId: actor.userId, deviceId: 'device-1', role: actor.role },
    type,
    v: 1,
    payload,
    ...overrides,
  };
}

function makeCreated(actor: TestActor = dmActor()): Event {
  return makeCampEvent(
    'campaign.created',
    { name: 'The Sunless Citadel', system: '5e-2024', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
    actor,
  );
}

function makeCharCreated(characterId: string, owner: string): Event {
  return makeCharEvent(
    characterId,
    'character.created',
    {
      name: 'Alice the Bold',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
      engineVersion: '1.0.0',
      grammaticalGender: 'feminine',
    },
    ownerActor(owner),
  );
}

interface GatewaySystem {
  readonly rpc: FakeRpc;
  readonly campStore: FakeStreamStore;
  readonly campConnections: FakeConnections;
  readonly campaignActor: CampaignActor;
}

function makeGatewaySystem(): GatewaySystem {
  const rpc = new FakeRpc();
  const campStore = new FakeStreamStore();
  const campConnections = new FakeConnections();
  const campaignActor = new CampaignActor({
    store: campStore,
    connections: campConnections,
    quotas: campaignQuotas,
    permissions: campaignPermissions,
    streamId: CAMP_STREAM_ID,
    rpc,
  });
  rpc.register(
    CAMP_STREAM_ID,
    actorTarget(campaignActor, campStore, (fromStream, events) => campaignActor.handleNotify(fromStream, events)),
  );
  return { rpc, campStore, campConnections, campaignActor };
}

interface CharacterSystem {
  readonly store: FakeStreamStore;
  readonly connections: FakeConnections;
  readonly actor: CharacterActor;
}

/** Builds a real `CharacterActor` sharing `gw`'s `FakeRpc` and registers it as a live `char:`
 * target on that same double — so `gw.campaignActor`'s gateway forward AND this character's own
 * after-commit notify both route through genuine actor calls. [fix round 1] `currentCampaignOf`
 * reads the actor's OWN live `getCharacterMeta().campaignId` — not a canned value — so mirror
 * verification (`CampaignActor.verifyCharacterMirror`'s CURRENCY check, fix round 1 Critical 4)
 * genuinely reflects whatever this character has actually committed so far. */
function registerCharacter(gw: GatewaySystem, characterId: string): CharacterSystem {
  const store = new FakeStreamStore();
  const connections = new FakeConnections();
  const actor = new CharacterActor({
    store,
    connections,
    quotas,
    permissions,
    streamId: `char:${characterId}`,
    rpc: gw.rpc,
  });
  gw.rpc.register(
    `char:${characterId}`,
    actorTarget(actor, store, undefined, () => actor.getCharacterMeta().then((m) => m.campaignId)),
  );
  return { store, connections, actor };
}

/** Full setup shared by most tests: campaign created (DM_ID), MEMBER_A joined, a character
 * created+owned by MEMBER_A, joined to the campaign on BOTH sides (the real client two-append
 * mirror sequence: `character.campaign_joined` direct on the char stream, THEN
 * `campaign.character_joined` on the campaign stream, which mirror-verifies against the first). */
async function seedJoinedCharacter(gw: GatewaySystem): Promise<{ characterId: string; char: CharacterSystem }> {
  await gw.campaignActor.append([makeCreated()], dmActor());
  await gw.campaignActor.append(
    [makeCampEvent('member.joined', { userId: MEMBER_A, displayName: 'Alice', role: 'player' }, memberActor(MEMBER_A))],
    memberActor(MEMBER_A),
  );
  const characterId = uuidv7();
  const char = registerCharacter(gw, characterId);
  await char.actor.append([makeCharCreated(characterId, MEMBER_A)], ownerActor(MEMBER_A));
  await char.actor.append(
    [makeCharEvent(characterId, 'character.campaign_joined', { campaignId: CAMPAIGN_UUID }, ownerActor(MEMBER_A))],
    ownerActor(MEMBER_A),
  );
  await gw.campaignActor.append(
    [
      makeCampEvent(
        'campaign.character_joined',
        { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
        memberActor(MEMBER_A),
      ),
    ],
    memberActor(MEMBER_A),
  );
  return { characterId, char };
}

let gw: GatewaySystem;

beforeEach(() => {
  gw = makeGatewaySystem();
});

describe('gateway forwarding', () => {
  it('DM damage on a member character through the campaign socket: forwarded, committed on the char stream, ack relayed', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    const beforeLength = char.store.length;

    const hpChanged = makeCharEvent(characterId, 'hp.changed', { delta: -5, kind: 'damage' }, dmActor());
    const outcome = await gw.campaignActor.append([hpChanged], dmActor());

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toHaveLength(1);
    expect(outcome.acked[0]?.id).toBe(hpChanged.id);
    expect(char.store.length).toBe(beforeLength + 1);
    const stored = await char.store.findByIds([hpChanged.id]);
    expect(stored[0]).toMatchObject({ type: 'hp.changed', actor: { userId: DM_ID, role: 'dm' } });
  });

  it('a member forwarding an owner-class event on their OWN character: mapped to owner, committed', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);

    const archived = makeCharEvent(characterId, 'character.archived', {}, memberActor(MEMBER_A));
    const outcome = await gw.campaignActor.append([archived], memberActor(MEMBER_A));

    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toHaveLength(1);
    const meta = await char.actor.getCharacterMeta();
    expect(meta.archived).toBe(true);
    const stored = await char.store.findByIds([archived.id]);
    expect(stored[0]).toMatchObject({ actor: { userId: MEMBER_A, role: 'owner' } });
  });

  it('a member forwarding to ANOTHER member’s character: rejected forbidden, nothing forwarded', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    await gw.campaignActor.append(
      [makeCampEvent('member.joined', { userId: MEMBER_B, displayName: 'Bob', role: 'player' }, memberActor(MEMBER_B))],
      memberActor(MEMBER_B),
    );
    const beforeLength = char.store.length;

    const archived = makeCharEvent(characterId, 'character.archived', {}, memberActor(MEMBER_B));
    const outcome = await gw.campaignActor.append([archived], memberActor(MEMBER_B));

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]).toMatchObject({ id: archived.id, code: 'forbidden' });
    expect(char.store.length).toBe(beforeLength); // never forwarded
  });

  it('a txId group spanning both the campaign stream and a char: stream is rejected invalid, entirely, without forwarding', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    const beforeCharLength = char.store.length;
    const beforeCampLength = gw.campStore.length;
    const txId = uuidv7();

    const chat = makeCampEvent('chat.message', { text: 'rolling now', visibility: 'everyone' }, dmActor(), { txId });
    const hpChanged = makeCharEvent(characterId, 'hp.changed', { delta: -1, kind: 'damage' }, dmActor(), { txId });

    const outcome = await gw.campaignActor.append([chat, hpChanged], dmActor());

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected).toHaveLength(2);
    for (const r of outcome.rejected) expect(r.code).toBe('invalid');
    expect(char.store.length).toBe(beforeCharLength);
    expect(gw.campStore.length).toBe(beforeCampLength);
  });

  // [fix round 1, Critical 1] mapGatewayActor's `dm` branch used to map role 'dm' for ANY target
  // characterId, regardless of which campaign (if any) that character had actually joined — any
  // DM in the system could gateway-forward dm-class events to any character anywhere. Fixed by
  // additionally requiring `meta.characters.has(characterId)` on THIS campaign's own meta.
  it("a FOREIGN campaign's DM cannot gateway-forward to a character never joined to THEIR campaign", async () => {
    const { characterId, char } = await seedJoinedCharacter(gw); // joined to gw's campaign only
    const beforeLength = char.store.length;

    const foreignDmId = 'usr_foreign_dm';
    const foreignStore = new FakeStreamStore();
    const foreignConnections = new FakeConnections();
    const foreignStreamId = `camp:${uuidv7()}`;
    const foreignCampaign = new CampaignActor({
      store: foreignStore,
      connections: foreignConnections,
      quotas: campaignQuotas,
      permissions: campaignPermissions,
      streamId: foreignStreamId,
      rpc: gw.rpc,
    });
    gw.rpc.register(
      foreignStreamId,
      actorTarget(foreignCampaign, foreignStore, (fromStream, events) =>
        foreignCampaign.handleNotify(fromStream, events),
      ),
    );
    const foreignCreated = makeCampEvent(
      'campaign.created',
      { name: 'Rival Table', system: '5e-2024', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
      dmActor(foreignDmId),
      { stream: foreignStreamId },
    );
    await foreignCampaign.append([foreignCreated], dmActor(foreignDmId));

    const hpChanged = makeCharEvent(characterId, 'hp.changed', { delta: -1, kind: 'damage' }, dmActor(foreignDmId), {
      stream: `char:${characterId}`,
    });
    const outcome = await foreignCampaign.append([hpChanged], dmActor(foreignDmId));

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ id: hpChanged.id, code: 'forbidden' });
    expect(char.store.length).toBe(beforeLength); // never forwarded
  });

  // [fix round 1, spec'd per review] Ownership is checked BEFORE the `dm` branch in
  // `mapGatewayActor`, so a DM's OWN pregen (joined to this campaign, owned by the DM) maps
  // through the OWNERSHIP path to 'owner' — not 'dm' — which is what grants it owner-class
  // permissions too (dm-class ones already work for an owner acting "solo/self" per doc-08).
  it("a DM's own pregen (joined to this campaign, owned by the DM) maps through ownership to 'owner'", async () => {
    await gw.campaignActor.append([makeCreated()], dmActor());
    await gw.campaignActor.append(
      [makeCampEvent('member.joined', { userId: DM_ID, displayName: 'GM', role: 'dm' }, dmActor())],
      dmActor(),
    );
    const pregenId = uuidv7();
    const pregen = registerCharacter(gw, pregenId);
    await pregen.actor.append([makeCharCreated(pregenId, DM_ID)], ownerActor(DM_ID));
    await pregen.actor.append(
      [makeCharEvent(pregenId, 'character.campaign_joined', { campaignId: CAMPAIGN_UUID }, ownerActor(DM_ID))],
      ownerActor(DM_ID),
    );
    await gw.campaignActor.append(
      [
        makeCampEvent(
          'campaign.character_joined',
          { characterId: pregenId, ownerId: DM_ID, name: 'Pregen Paul' },
          dmActor(),
        ),
      ],
      dmActor(),
    );

    const archived = makeCharEvent(pregenId, 'character.archived', {}, dmActor());
    const outcome = await gw.campaignActor.append([archived], dmActor());

    expect(outcome.rejected).toEqual([]);
    const meta = await pregen.actor.getCharacterMeta();
    expect(meta.archived).toBe(true);
    const stored = await pregen.store.findByIds([archived.id]);
    expect(stored[0]).toMatchObject({ actor: { userId: DM_ID, role: 'owner' } }); // owner, NOT dm
  });
});

describe('gateway forgery prevention (character.campaign_joined/left forwarded through the gateway)', () => {
  // [fix round 1, Important 3] Combined with Critical 1's fix, this closes the
  // "campaign-A-DM-forges-a-join-into-campaign-B" path: THIS campaign's own DM, forwarding through
  // THIS campaign's own gateway to a character genuinely joined to THIS campaign, could otherwise
  // put an ARBITRARY campaignId in the payload — silently re-pointing the character's link to a
  // campaign this DM has no authority over at all.
  it('a DM cannot use their OWN campaign’s gateway to forge a character.campaign_joined naming a DIFFERENT campaign', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw); // genuinely joined to gw's campaign
    const beforeLength = char.store.length;
    const foreignCampaignId = uuidv7();

    const forged = makeCharEvent(
      characterId,
      'character.campaign_joined',
      { campaignId: foreignCampaignId },
      dmActor(),
    );
    const outcome = await gw.campaignActor.append([forged], dmActor());

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ id: forged.id, code: 'invalid' });
    expect(char.store.length).toBe(beforeLength); // never forwarded/committed
    const meta = await char.actor.getCharacterMeta();
    expect(meta.campaignId).toBe(CAMPAIGN_UUID); // untouched — still genuinely linked to gw's campaign
  });

  it('a DM cannot forge a character.campaign_left naming a different campaign either', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    const beforeLength = char.store.length;
    const foreignCampaignId = uuidv7();

    const forged = makeCharEvent(characterId, 'character.campaign_left', { campaignId: foreignCampaignId }, dmActor());
    const outcome = await gw.campaignActor.append([forged], dmActor());

    expect(outcome.rejected[0]).toMatchObject({ id: forged.id, code: 'invalid' });
    expect(char.store.length).toBe(beforeLength);
    const meta = await char.actor.getCharacterMeta();
    expect(meta.campaignId).toBe(CAMPAIGN_UUID); // untouched
  });
});

describe('cross-stream mirror verification', () => {
  it('campaign.character_joined is rejected invalid when no matching character.campaign_joined exists yet', async () => {
    await gw.campaignActor.append([makeCreated()], dmActor());
    await gw.campaignActor.append(
      [
        makeCampEvent(
          'member.joined',
          { userId: MEMBER_A, displayName: 'Alice', role: 'player' },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );
    const characterId = uuidv7();
    registerCharacter(gw, characterId); // registered but NEVER sent character.campaign_joined

    const outcome = await gw.campaignActor.append(
      [
        makeCampEvent(
          'campaign.character_joined',
          { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'invalid' });
    const meta = await gw.campaignActor.getCampaignMeta();
    expect(meta.characters.has(characterId)).toBe(false);
  });

  it('campaign.character_joined is accepted once the matching character.campaign_joined genuinely exists', async () => {
    const { characterId } = await seedJoinedCharacter(gw);
    const meta = await gw.campaignActor.getCampaignMeta();
    expect(meta.characters.get(characterId)).toBe(MEMBER_A);
  });

  it('campaign.character_left is rejected invalid without a matching character.campaign_left', async () => {
    const { characterId } = await seedJoinedCharacter(gw); // joined + mirrored, but never "left" on the char side

    const outcome = await gw.campaignActor.append(
      [
        makeCampEvent(
          'campaign.character_left',
          { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );

    expect(outcome.rejected[0]).toMatchObject({ code: 'invalid' });
    const meta = await gw.campaignActor.getCampaignMeta();
    expect(meta.characters.has(characterId)).toBe(true); // still joined — the left mirror never verified
  });

  // [fix round 1, Critical 4 — mirror CURRENCY, not just historical existence] Before this fix,
  // `verifyCharacterMirror` only checked `Rpc.hasEvent` — whether a MATCHING event exists
  // ANYWHERE in the character's history, which stays true forever once committed. A character
  // that genuinely joined-then-left this campaign still has that OLD `character.campaign_joined`
  // event sitting in its history; replaying the OLD `campaign.character_joined` would therefore
  // still `hasEvent`-verify and incorrectly re-add the character to the roster. Fixed by requiring
  // `Rpc.currentCampaignOf` to equal THIS campaign right now, not merely "matched once, ever".
  it('a replayed campaign.character_joined AFTER the character has genuinely left is rejected (stale history is not enough)', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);

    // A genuine, full leave: char-side clears the link, campaign-side mirror-verifies and removes
    // the character from the roster.
    await char.actor.append(
      [makeCharEvent(characterId, 'character.campaign_left', { campaignId: CAMPAIGN_UUID }, ownerActor(MEMBER_A))],
      ownerActor(MEMBER_A),
    );
    await gw.campaignActor.append(
      [
        makeCampEvent(
          'campaign.character_left',
          { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );
    let meta = await gw.campaignActor.getCampaignMeta();
    expect(meta.characters.has(characterId)).toBe(false);

    // REPLAY the OLD campaign.character_joined (e.g. a stale/duplicated client resend) — the char
    // stream's HISTORY still has the original join event, but the character's CURRENT link is no
    // longer this campaign.
    const replayedJoin = makeCampEvent(
      'campaign.character_joined',
      { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
      memberActor(MEMBER_A),
    );
    const outcome = await gw.campaignActor.append([replayedJoin], memberActor(MEMBER_A));

    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ id: replayedJoin.id, code: 'invalid' });
    meta = await gw.campaignActor.getCampaignMeta();
    expect(meta.characters.has(characterId)).toBe(false); // still not re-added
  });

  // [fix round 1, Critical 4 — LEFT's dual guarantee] A stale campaign.character_left replayed
  // AFTER the character has since REJOINED this SAME campaign must not spuriously de-list an
  // actively-linked character — `currentCampaignOf` must NOT equal this campaign for the left
  // mirror to accept (see `verifyCharacterMirror`'s doc comment for the full LEFT semantics).
  it('a stale campaign.character_left replayed after the character has REJOINED this campaign is rejected', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    await char.actor.append(
      [makeCharEvent(characterId, 'character.campaign_left', { campaignId: CAMPAIGN_UUID }, ownerActor(MEMBER_A))],
      ownerActor(MEMBER_A),
    );
    const staleLeft = makeCampEvent(
      'campaign.character_left',
      { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
      memberActor(MEMBER_A),
    );
    await gw.campaignActor.append([staleLeft], memberActor(MEMBER_A)); // real leave, accepted

    // Rejoin the SAME campaign for real.
    await char.actor.append(
      [makeCharEvent(characterId, 'character.campaign_joined', { campaignId: CAMPAIGN_UUID }, ownerActor(MEMBER_A))],
      ownerActor(MEMBER_A),
    );
    await gw.campaignActor.append(
      [
        makeCampEvent(
          'campaign.character_joined',
          { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );
    let meta = await gw.campaignActor.getCampaignMeta();
    expect(meta.characters.has(characterId)).toBe(true); // actively rejoined

    // REPLAY the earlier (now-stale) campaign.character_left.
    const replayedLeft = makeCampEvent(
      'campaign.character_left',
      { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
      memberActor(MEMBER_A),
    );
    const outcome = await gw.campaignActor.append([replayedLeft], memberActor(MEMBER_A));

    expect(outcome.rejected[0]).toMatchObject({ id: replayedLeft.id, code: 'invalid' });
    meta = await gw.campaignActor.getCampaignMeta();
    expect(meta.characters.has(characterId)).toBe(true); // still actively joined — not spuriously removed
  });
});

describe('after-commit notify fan-out (CampaignActor.handleNotify)', () => {
  async function settingsWithPartySheets(value: 'full' | 'overview' | 'none') {
    const meta = await gw.campaignActor.getCampaignMeta();
    if (!meta.settings) throw new Error('campaign not created yet');
    return { ...meta.settings, visibility: { ...meta.settings.visibility, partySheets: value } };
  }

  it('the DM and the character’s own owner always receive a notified character event; a non-owner member only when partySheets is full (the default)', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    await gw.campaignActor.append(
      [makeCampEvent('member.joined', { userId: MEMBER_B, displayName: 'Bob', role: 'player' }, memberActor(MEMBER_B))],
      memberActor(MEMBER_B),
    );

    const dmConn = gw.campConnections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    const ownerConn = gw.campConnections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const otherMemberConn = gw.campConnections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    const hpChanged = makeCharEvent(characterId, 'hp.changed', { delta: -2, kind: 'damage' }, ownerActor(MEMBER_A));
    await char.actor.append([hpChanged], ownerActor(MEMBER_A));

    for (const conn of [dmConn, ownerConn, otherMemberConn]) {
      const frames = gw.campConnections.framesFor(conn).filter((f) => f.t === 'events');
      expect(frames.some((f) => f.t === 'events' && f.events.some((e) => e.id === hpChanged.id))).toBe(true);
    }
  });

  it('a non-owner member receives NOTHING once partySheets is narrowed below full', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    await gw.campaignActor.append(
      [makeCampEvent('member.joined', { userId: MEMBER_B, displayName: 'Bob', role: 'player' }, memberActor(MEMBER_B))],
      memberActor(MEMBER_B),
    );
    const narrowed = await settingsWithPartySheets('overview');
    await gw.campaignActor.append(
      [makeCampEvent('campaign.settings_changed', { settings: narrowed }, dmActor())],
      dmActor(),
    );

    const dmConn = gw.campConnections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    const ownerConn = gw.campConnections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const otherMemberConn = gw.campConnections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    const hpChanged = makeCharEvent(characterId, 'hp.changed', { delta: -2, kind: 'damage' }, ownerActor(MEMBER_A));
    await char.actor.append([hpChanged], ownerActor(MEMBER_A));

    const dmFrames = gw.campConnections.framesFor(dmConn).filter((f) => f.t === 'events');
    const ownerFrames = gw.campConnections.framesFor(ownerConn).filter((f) => f.t === 'events');
    const otherFrames = gw.campConnections.framesFor(otherMemberConn).filter((f) => f.t === 'events');
    expect(dmFrames.some((f) => f.t === 'events' && f.events.some((e) => e.id === hpChanged.id))).toBe(true);
    expect(ownerFrames.some((f) => f.t === 'events' && f.events.some((e) => e.id === hpChanged.id))).toBe(true);
    expect(otherFrames.some((f) => f.t === 'events' && f.events.some((e) => e.id === hpChanged.id))).toBe(false);
  });

  it('a connection that is neither this campaign’s DM nor an established member receives nothing', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    const strangerConn = gw.campConnections.accept({}, { userId: 'usr_stranger', role: 'member', subs: [] });

    const hpChanged = makeCharEvent(characterId, 'hp.changed', { delta: -1, kind: 'damage' }, ownerActor(MEMBER_A));
    await char.actor.append([hpChanged], ownerActor(MEMBER_A));

    const frames = gw.campConnections.framesFor(strangerConn).filter((f) => f.t === 'events');
    expect(frames).toEqual([]);
  });

  // [fix round 2, Critical] `CharacterActor.meta.campaignId` (what `notifyCampaignIfLinked`
  // targets) is set from `character.campaign_joined`'s payload, authored DIRECTLY by the
  // character's TRUE OWNER on their own socket — with NO campaign-side mirror acceptance required
  // first, and `CharacterActor` has no way to validate the payload's `campaignId` at all (no
  // `Db`/campaign-meta access). A malicious or merely buggy owner client can set `campaignId` to a
  // campaign this character was NEVER actually joined/rostered to. Before this fix, `isDm` and
  // `isVisibleMember` had no roster check (`isOwner` alone did, via `ownerId !== undefined`) —
  // notify from an unrostered character reached every DM connection unconditionally and, since
  // `partySheets: 'full'` is the settings default, every member connection too. `isRostered`
  // (`meta.characters.has(characterId)`) now gates ALL THREE branches.
  it('an UNROSTERED character (owner self-set a stray campaignId, never actually joined this campaign) delivers to NOBODY on notify — dm and member alike', async () => {
    await gw.campaignActor.append([makeCreated()], dmActor());
    await gw.campaignActor.append(
      [
        makeCampEvent(
          'member.joined',
          { userId: MEMBER_A, displayName: 'Alice', role: 'player' },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );
    const characterId = uuidv7();
    const char = registerCharacter(gw, characterId);
    await char.actor.append([makeCharCreated(characterId, MEMBER_A)], ownerActor(MEMBER_A));
    // The owner sets campaignId to THIS campaign directly, WITHOUT ever going through the
    // roster-verified two-append join sequence (no campaign.character_joined mirror was ever sent
    // on the campaign side) — exactly the stray/forged-payload scenario the review named.
    await char.actor.append(
      [makeCharEvent(characterId, 'character.campaign_joined', { campaignId: CAMPAIGN_UUID }, ownerActor(MEMBER_A))],
      ownerActor(MEMBER_A),
    );
    const preMeta = await gw.campaignActor.getCampaignMeta();
    expect(preMeta.characters.has(characterId)).toBe(false); // confirm: genuinely never rostered

    const dmConn = gw.campConnections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    const memberConn = gw.campConnections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });

    const hpChanged = makeCharEvent(characterId, 'hp.changed', { delta: -1, kind: 'damage' }, ownerActor(MEMBER_A));
    await char.actor.append([hpChanged], ownerActor(MEMBER_A));

    for (const conn of [dmConn, memberConn]) {
      const frames = gw.campConnections.framesFor(conn).filter((f) => f.t === 'events');
      expect(frames.some((f) => f.t === 'events' && f.events.some((e) => e.id === hpChanged.id))).toBe(false);
    }
  });
});

describe('DM subscribe: catch-up via Rpc.readStream', () => {
  it('subscribing with lastSeq 0 pages the full character history to the subscriber', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw); // 2 events already committed: created, campaign_joined
    const dmConn = gw.campConnections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });

    await gw.campaignActor.handleMessage(dmConn, { t: 'subscribe', stream: `char:${characterId}`, lastSeq: 0 });

    const frames = gw.campConnections.framesFor(dmConn).filter((f) => f.t === 'events');
    const deliveredIds = frames.flatMap((f) => (f.t === 'events' ? f.events.map((e) => e.id) : []));
    const storedIds = (await char.store.read(1, 1000)).map((e) => e.id);
    expect(deliveredIds).toEqual(storedIds);
    expect(deliveredIds.length).toBe(2);
  });

  it('subscribing again with lastSeq at the current head sends no catch-up frame', async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    const head = await char.store.head();
    const dmConn = gw.campConnections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });

    await gw.campaignActor.handleMessage(dmConn, { t: 'subscribe', stream: `char:${characterId}`, lastSeq: head });

    const frames = gw.campConnections.framesFor(dmConn).filter((f) => f.t === 'events');
    expect(frames).toEqual([]);
  });

  it('an unauthorized subscriber (not this campaign’s dm, not the character’s owner) gets no catch-up either', async () => {
    const { characterId } = await seedJoinedCharacter(gw);
    await gw.campaignActor.append(
      [makeCampEvent('member.joined', { userId: MEMBER_B, displayName: 'Bob', role: 'player' }, memberActor(MEMBER_B))],
      memberActor(MEMBER_B),
    );
    const bobConn = gw.campConnections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await gw.campaignActor.handleMessage(bobConn, { t: 'subscribe', stream: `char:${characterId}`, lastSeq: 0 });

    expect(gw.campConnections.framesFor(bobConn)).toEqual([]);
  });

  // [fix round 1, Critical 2] `handleSubscribe`'s `dm` branch used to be unconditional — ANY DM
  // could subscribe to (and catch up on) ANY character stream in the system merely by knowing its
  // id, with no requirement that the character have anything to do with that DM's own campaign.
  // Fixed by requiring `meta.characters.has(characterId)` (the same live-roster check
  // `mapGatewayActor`'s Critical-1 fix uses for the write side).
  it("this campaign's DM subscribing to a character NEVER joined to this campaign is rejected — no catch-up, no subs entry", async () => {
    await gw.campaignActor.append([makeCreated()], dmActor());
    const unjoinedCharacterId = uuidv7();
    registerCharacter(gw, unjoinedCharacterId); // exists, but never joined to gw's campaign
    const dmConn = gw.campConnections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });

    await gw.campaignActor.handleMessage(dmConn, {
      t: 'subscribe',
      stream: `char:${unjoinedCharacterId}`,
      lastSeq: 0,
    });

    expect(gw.campConnections.framesFor(dmConn)).toEqual([]);
    expect(gw.campConnections.getAttachment(dmConn).subs).toEqual([]);
  });

  it("this campaign's DM subscribing to a character genuinely joined to this campaign still works (the fix doesn't over-reject)", async () => {
    const { characterId, char } = await seedJoinedCharacter(gw);
    const dmConn = gw.campConnections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });

    await gw.campaignActor.handleMessage(dmConn, { t: 'subscribe', stream: `char:${characterId}`, lastSeq: 0 });

    const frames = gw.campConnections.framesFor(dmConn).filter((f) => f.t === 'events');
    const deliveredIds = frames.flatMap((f) => (f.t === 'events' ? f.events.map((e) => e.id) : []));
    const storedIds = (await char.store.read(1, 1000)).map((e) => e.id);
    expect(deliveredIds).toEqual(storedIds);
    expect(gw.campConnections.getAttachment(dmConn).subs).toContain(`char:${characterId}`);
  });
});
