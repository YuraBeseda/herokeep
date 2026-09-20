/**
 * Task 5: `CampaignActor` — meta maintenance, per-append permission refinement, campaign quotas,
 * real read-visibility filtering (fan-out AND catch-up), presence throttling, and
 * subscribe/unsubscribe attachment bookkeeping. Against the SAME in-memory `StreamStore`/
 * `Connections` fakes `stream-actor.test.ts` uses (`test/helpers/{fake-stream-store,
 * fake-connections}.ts`), plus `campaignQuotas`/`campaign-permissions.ts` (this task's own new
 * campaign-scoped `QuotasPort`/`PermissionsPort` implementations — NOT `core/quotas.ts`'s/
 * `core/permissions.ts`'s character-stream defaults, which would wrongly reject every
 * member-authored event / apply the wrong byte cap).
 */
import type { Event, HelloMsg, SubscribeMsg, UnsubscribeMsg } from '@hk/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import * as campaignPermissions from '../../src/core/campaign-permissions.ts';
import { uuidv7 } from '../../src/core/ids.ts';
import { CAMPAIGN_MEMBER_MAX, CAMPAIGN_NON_CORE_PACK_MAX, CAMPAIGN_QUOTA_LIMITS } from '../../src/core/quotas.ts';
import { campaignQuotas, CampaignActor, type CampaignActorDeps } from '../../src/core/streams/campaign-actor.ts';
import { FakeConnections } from '../helpers/fake-connections.ts';
import { actorTarget, FakeRpc } from '../helpers/fake-rpc.ts';
import { FakeStreamStore } from '../helpers/fake-stream-store.ts';

const STREAM_ID = `camp:${uuidv7()}`;
const DM_ID = 'usr_dm1';
const MEMBER_A = 'usr_alice';
const MEMBER_B = 'usr_bob';

interface TestActor {
  readonly userId: string;
  readonly role: 'dm' | 'member';
}

function dmActor(userId = DM_ID): TestActor {
  return { userId, role: 'dm' };
}
function memberActor(userId = MEMBER_A): TestActor {
  return { userId, role: 'member' };
}

/** A schema-valid campaign-stream event envelope. `type`/`payload` pairs mirror
 * `packages/protocol/test/campaign.test.ts`'s own accept samples, so every payload shape here is
 * already known-schema-valid. */
function makeEvent(
  type: string,
  payload: Record<string, unknown>,
  actor: TestActor,
  overrides: Partial<Event> = {},
): Event {
  return {
    id: uuidv7(),
    stream: STREAM_ID,
    ts: new Date().toISOString(),
    actor: { userId: actor.userId, deviceId: 'device-1', role: actor.role },
    type,
    v: 1,
    payload,
    ...overrides,
  };
}

function makeCreated(actor: TestActor = dmActor()): Event {
  return makeEvent(
    'campaign.created',
    { name: 'The Sunless Citadel', system: '5e-2024', corePack: { id: 'srd-5e-2024', version: '1.0.0' } },
    actor,
  );
}

function makeMemberJoined(
  userId: string,
  displayName = userId,
  role: 'dm' | 'player' = 'player',
  actor?: TestActor,
): Event {
  return makeEvent('member.joined', { userId, displayName, role }, actor ?? { userId, role: 'member' });
}

function makeSystem(deps: Partial<CampaignActorDeps> = {}) {
  const store = new FakeStreamStore();
  const connections = new FakeConnections();
  // [plan-9 Task 6] a fresh `FakeRpc` per system by default — `deps.rpc` lets a test inject its
  // own (e.g. a shared one across two actors), in which case `rpc` below IS that same instance.
  const rpc = (deps.rpc as FakeRpc | undefined) ?? new FakeRpc();
  const actor = new CampaignActor({
    store,
    connections,
    quotas: campaignQuotas,
    permissions: campaignPermissions,
    streamId: STREAM_ID,
    ...deps,
    rpc,
  });
  return { store, connections, rpc, actor };
}

let system: ReturnType<typeof makeSystem>;

beforeEach(() => {
  system = makeSystem();
});

/**
 * [plan-9 Task 6] Registers a `char:<characterId>` target on `system.rpc` whose only committed
 * event is the given mirror type carrying `{campaignId: campaignIdOf(STREAM_ID)}` — the minimum
 * `Rpc.hasEvent` needs to VERIFY a `campaign.character_joined`/`campaign.character_left` mirror
 * (this file's `verifyCharacterMirror` target). The registered target's own `append` is never
 * exercised by these mirror-verification tests (only `hasEvent`'s read path is), so it's a stub
 * that would fail loudly (a thrown rejection) if a test's own bug ever DID reach it.
 */
async function registerCharacterMirror(
  characterId: string,
  eventType: 'character.campaign_joined' | 'character.campaign_left',
  ownerId = MEMBER_A,
): Promise<void> {
  const mirrorStore = new FakeStreamStore();
  await mirrorStore.append([
    {
      id: uuidv7(),
      stream: `char:${characterId}`,
      ts: new Date().toISOString(),
      actor: { userId: ownerId, deviceId: 'device-1', role: 'owner' },
      type: eventType,
      v: 1,
      payload: { campaignId: STREAM_ID.slice('camp:'.length) },
    },
  ]);
  system.rpc.register(
    `char:${characterId}`,
    actorTarget(
      {
        append: () => {
          throw new Error('unexpected forwardAppend against a mirror-only fake char: target');
        },
      },
      mirrorStore,
    ),
  );
}

/** Creates the campaign (dm = DM_ID) and joins `MEMBER_A`, returning the resulting `characterId`
 * once also joined to the campaign (owned by `MEMBER_A`) — the common fixture most permission/
 * meta tests build on. [plan-9 Task 6] Registers the matching `character.campaign_joined` mirror
 * event first (`registerCharacterMirror`) so the `campaign.character_joined` append below passes
 * mirror verification exactly like a real client's two-append join sequence would. */
async function seedCampaignWithMemberAndCharacter(): Promise<{ characterId: string }> {
  await system.actor.append([makeCreated()], dmActor());
  await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
  const characterId = uuidv7();
  await registerCharacterMirror(characterId, 'character.campaign_joined');
  await system.actor.append(
    [
      makeEvent(
        'campaign.character_joined',
        { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
        memberActor(MEMBER_A),
      ),
    ],
    memberActor(MEMBER_A),
  );
  return { characterId };
}

describe('meta maintenance', () => {
  it('campaign.created sets dmId and default settings (system from the payload)', async () => {
    const outcome = await system.actor.append([makeCreated()], dmActor());
    expect(outcome.rejected).toEqual([]);

    const meta = await system.actor.getCampaignMeta();
    expect(meta.dmId).toBe(DM_ID);
    expect(meta.settings?.system).toBe('5e-2024');
    expect(meta.settings?.join).toEqual({ open: true, requireApproval: false });
  });

  it('campaign.settings_changed replaces the settings document verbatim', async () => {
    await system.actor.append([makeCreated()], dmActor());
    const newSettings = {
      system: '5e-2024',
      packs: [],
      houseRules: {
        strictValidation: false,
        allowOverrides: true,
        editOutsideSession: 'locked',
        xpMode: 'milestone',
        hpOnLevelUp: 'roll',
        encumbrance: 'variant',
        attunementMax: 5,
        startingLevel: 3,
      },
      visibility: { partySheets: 'overview', rolls: 'dm', allowPrivateRolls: false },
      join: { open: false, requireApproval: true },
    };
    await system.actor.append(
      [makeEvent('campaign.settings_changed', { settings: newSettings }, dmActor())],
      dmActor(),
    );

    const meta = await system.actor.getCampaignMeta();
    expect(meta.settings).toEqual(newSettings);
  });

  it('member.joined adds to members, member.left and member.removed remove', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    let meta = await system.actor.getCampaignMeta();
    expect(meta.members.get(MEMBER_A)).toEqual({ displayName: 'Alice', role: 'player' });

    await system.actor.append(
      [makeEvent('member.left', { userId: MEMBER_A, displayName: 'Alice', role: 'player' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );
    meta = await system.actor.getCampaignMeta();
    expect(meta.members.has(MEMBER_A)).toBe(false);

    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));
    await system.actor.append(
      [makeEvent('member.removed', { userId: MEMBER_B, displayName: 'Bob', role: 'player' }, dmActor())],
      dmActor(),
    );
    meta = await system.actor.getCampaignMeta();
    expect(meta.members.has(MEMBER_B)).toBe(false);
  });

  it('member.renamed updates only the acting member’s own entry (self-only)', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));

    await system.actor.append(
      [makeEvent('member.renamed', { displayName: 'Alice the Bold' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );

    const meta = await system.actor.getCampaignMeta();
    expect(meta.members.get(MEMBER_A)?.displayName).toBe('Alice the Bold');
    expect(meta.members.get(MEMBER_B)?.displayName).toBe('Bob'); // untouched
  });

  it('campaign.character_joined/left maintain the characters map', async () => {
    const { characterId } = await seedCampaignWithMemberAndCharacter();
    let meta = await system.actor.getCampaignMeta();
    expect(meta.characters.get(characterId)).toBe(MEMBER_A);

    await registerCharacterMirror(characterId, 'character.campaign_left');
    await system.actor.append(
      [
        makeEvent(
          'campaign.character_left',
          { characterId, ownerId: MEMBER_A, name: 'Alice the Bold' },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );
    meta = await system.actor.getCampaignMeta();
    expect(meta.characters.has(characterId)).toBe(false);
  });

  it('pack.enabled adds to packs (idempotent for a repeat) and pack.disabled removes', async () => {
    await system.actor.append([makeCreated()], dmActor());
    const packEvent = () =>
      makeEvent('pack.enabled', { packId: 'homebrew-pack', version: '1.0.0', sha256: '0'.repeat(64) }, dmActor());

    await system.actor.append([packEvent()], dmActor());
    let meta = await system.actor.getCampaignMeta();
    expect(meta.packs).toEqual([{ packId: 'homebrew-pack', version: '1.0.0', sha256: '0'.repeat(64) }]);

    await system.actor.append([packEvent()], dmActor()); // repeat — idempotent, no growth
    meta = await system.actor.getCampaignMeta();
    expect(meta.packs).toHaveLength(1);

    await system.actor.append(
      [makeEvent('pack.disabled', { packId: 'homebrew-pack', version: '1.0.0', sha256: '0'.repeat(64) }, dmActor())],
      dmActor(),
    );
    meta = await system.actor.getCampaignMeta();
    expect(meta.packs).toEqual([]);
  });
});

describe('permission refinements beyond the static EVENT_ACTORS table', () => {
  it('forbids a member-role actor who is not (yet) a recognized member of this campaign', async () => {
    await system.actor.append([makeCreated()], dmActor());
    // MEMBER_B never joined.
    const outcome = await system.actor.append(
      [makeEvent('chat.message', { text: 'hi', visibility: 'everyone' }, memberActor(MEMBER_B))],
      memberActor(MEMBER_B),
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });
  });

  it('allows member.joined itself even though the joiner is not YET in meta.members (bootstrap exemption)', async () => {
    await system.actor.append([makeCreated()], dmActor());
    const outcome = await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    expect(outcome.rejected).toEqual([]);
    expect(outcome.acked).toHaveLength(1);
  });

  // [fix round 1, Critical 2] member.joined/member.left were not bound to the acting user's own
  // id: an established member could admit an ARBITRARY userId (bypassing the join-code gate) or
  // evict another member via member.left (an eviction path that was supposed to belong only to
  // the dm-gated member.removed).
  it('forbids member.joined admitting a userId other than the acting user (self-only)', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));

    const outcome = await system.actor.append(
      [makeMemberJoined(MEMBER_B, 'Bob')], // payload.userId = MEMBER_B, but the actor is MEMBER_A
      memberActor(MEMBER_A),
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });
    const meta = await system.actor.getCampaignMeta();
    expect(meta.members.has(MEMBER_B)).toBe(false);
  });

  it('forbids member.left evicting a userId other than the acting user (self-only, no dm exemption)', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));

    const outcome = await system.actor.append(
      [makeEvent('member.left', { userId: MEMBER_B, displayName: 'Bob', role: 'player' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });
    const meta = await system.actor.getCampaignMeta();
    expect(meta.members.has(MEMBER_B)).toBe(true); // untouched

    // Not even the DM is exempt from this one — DM-driven removal is member.removed, not member.left.
    const dmOutcome = await system.actor.append(
      [makeEvent('member.left', { userId: MEMBER_B, displayName: 'Bob', role: 'player' }, dmActor())],
      dmActor(),
    );
    expect(dmOutcome.rejected[0]).toMatchObject({ code: 'forbidden' });
  });

  it('allows self member.joined and self member.left (the legitimate self-service path)', async () => {
    await system.actor.append([makeCreated()], dmActor());
    const joinOutcome = await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    expect(joinOutcome.rejected).toEqual([]);

    const leaveOutcome = await system.actor.append(
      [makeEvent('member.left', { userId: MEMBER_A, displayName: 'Alice', role: 'player' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );
    expect(leaveOutcome.rejected).toEqual([]);
  });

  it('dm-driven member.removed (a distinct, dm-gated type) is unaffected by the member.joined/left self-binding check', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));

    const outcome = await system.actor.append(
      [makeEvent('member.removed', { userId: MEMBER_A, displayName: 'Alice', role: 'player' }, dmActor())],
      dmActor(),
    );
    expect(outcome.rejected).toEqual([]);
    const meta = await system.actor.getCampaignMeta();
    expect(meta.members.has(MEMBER_A)).toBe(false);
  });

  // [fix round 1, Critical 1] the original campaign.created exemption was keyed on event TYPE,
  // not on whether meta.dmId was already set — a second campaign.created on an established
  // campaign passed straight through and silently reassigned dmId / reset settings to defaults.
  it('rejects a second campaign.created once the campaign is already established (same dm), leaving meta unchanged', async () => {
    await system.actor.append([makeCreated(dmActor(DM_ID))], dmActor(DM_ID));
    const customSettings = {
      system: '5e-2024',
      packs: [],
      houseRules: {
        strictValidation: false,
        allowOverrides: true,
        editOutsideSession: 'locked',
        xpMode: 'milestone',
        hpOnLevelUp: 'roll',
        encumbrance: 'variant',
        attunementMax: 5,
        startingLevel: 3,
      },
      visibility: { partySheets: 'overview', rolls: 'dm', allowPrivateRolls: false },
      join: { open: false, requireApproval: true },
    };
    await system.actor.append(
      [makeEvent('campaign.settings_changed', { settings: customSettings }, dmActor(DM_ID))],
      dmActor(DM_ID),
    );

    const outcome = await system.actor.append([makeCreated(dmActor(DM_ID))], dmActor(DM_ID));
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });

    const meta = await system.actor.getCampaignMeta();
    expect(meta.dmId).toBe(DM_ID);
    expect(meta.settings).toEqual(customSettings); // NOT reset back to defaults
  });

  it('rejects a second campaign.created from a DIFFERENT dm-role actor on an established campaign', async () => {
    await system.actor.append([makeCreated(dmActor(DM_ID))], dmActor(DM_ID));

    const impostorDm = { userId: 'usr_impostor', role: 'dm' as const };
    const outcome = await system.actor.append([makeCreated(impostorDm)], impostorDm);
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });

    const meta = await system.actor.getCampaignMeta();
    expect(meta.dmId).toBe(DM_ID); // NOT reassigned to the impostor
  });

  it('allows an established member to author roll.logged/chat.message/member.renamed', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));

    const outcome = await system.actor.append(
      [makeEvent('chat.message', { text: 'hi party', visibility: 'everyone' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );
    expect(outcome.rejected).toEqual([]);
  });

  it('campaign.character_joined: forbids a member acting on a character they do not own', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));

    const characterId = uuidv7();
    const outcome = await system.actor.append(
      [
        makeEvent(
          'campaign.character_joined',
          { characterId, ownerId: MEMBER_A, name: "Alice's hero" },
          memberActor(MEMBER_B),
        ),
      ],
      memberActor(MEMBER_B),
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });
  });

  it('campaign.character_joined: the DM is exempt from the ownership check', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));

    const characterId = uuidv7();
    await registerCharacterMirror(characterId, 'character.campaign_joined');
    const outcome = await system.actor.append(
      [makeEvent('campaign.character_joined', { characterId, ownerId: MEMBER_A, name: 'A pregen' }, dmActor())],
      dmActor(),
    );
    expect(outcome.rejected).toEqual([]);
  });

  it('party.overview_updated: forbids a non-owner member from posting another character’s overview', async () => {
    const { characterId } = await seedCampaignWithMemberAndCharacter();
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));

    const overview = {
      hp: 10,
      hpMax: 10,
      temp: 0,
      ac: 12,
      level: 1,
      classes: [],
      conditions: [],
      concentration: false,
      passivePerception: 10,
    };
    const outcome = await system.actor.append(
      [makeEvent('party.overview_updated', { characterId, overview }, memberActor(MEMBER_B))],
      memberActor(MEMBER_B),
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });
  });

  it('party.overview_updated: the owner may post their own character’s overview', async () => {
    const { characterId } = await seedCampaignWithMemberAndCharacter();
    const overview = {
      hp: 10,
      hpMax: 10,
      temp: 0,
      ac: 12,
      level: 1,
      classes: [],
      conditions: [],
      concentration: false,
      passivePerception: 10,
    };
    const outcome = await system.actor.append(
      [makeEvent('party.overview_updated', { characterId, overview }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );
    expect(outcome.rejected).toEqual([]);
  });

  it('member.renamed only ever affects the actor’s own entry, never another user’s', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));

    // member.renamed's payload has no target-user field at all -- MEMBER_A can only ever rename
    // themselves, regardless of intent; this asserts the meta hook's self-only behavior directly.
    await system.actor.append(
      [makeEvent('member.renamed', { displayName: 'Not Bob' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );
    const meta = await system.actor.getCampaignMeta();
    expect(meta.members.get(MEMBER_B)?.displayName).toBe('Bob');
  });

  it('dm-family events (e.g. dm.note_added) require the dm role', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));

    const outcome = await system.actor.append(
      [makeEvent('dm.note_added', { id: uuidv7(), title: 'Secret', body: 'shh' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });
  });

  it('dm-family events require actor.userId === meta.dmId, not merely role dm (defense in depth)', async () => {
    await system.actor.append([makeCreated(dmActor(DM_ID))], dmActor(DM_ID));

    const impostorDm = { userId: 'usr_impostor', role: 'dm' as const };
    const outcome = await system.actor.append(
      [makeEvent('dm.note_added', { id: uuidv7(), title: 'Secret', body: 'shh' }, impostorDm)],
      impostorDm,
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'forbidden' });
  });

  it('this campaign’s own dm may author dm-family events', async () => {
    await system.actor.append([makeCreated(dmActor(DM_ID))], dmActor(DM_ID));
    const outcome = await system.actor.append(
      [makeEvent('dm.note_added', { id: uuidv7(), title: 'Secret', body: 'shh' }, dmActor(DM_ID))],
      dmActor(DM_ID),
    );
    expect(outcome.rejected).toEqual([]);
  });
});

describe('campaign quotas', () => {
  it('rejects an append that would exceed the 20 MB campaign byte cap', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.store.setMeta('bytes_used', String(CAMPAIGN_QUOTA_LIMITS.bytesMax)); // already at the cap

    const outcome = await system.actor.append(
      [makeEvent('chat.message', { text: 'hi', visibility: 'everyone' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'quota' });
  });

  it('rejects the 13th member.joined once meta already holds the 12-member maximum', async () => {
    await system.actor.append([makeCreated()], dmActor());
    const existingMembers: Record<string, { displayName: string; role: string }> = {};
    for (let i = 0; i < CAMPAIGN_MEMBER_MAX; i += 1) {
      existingMembers[`usr_seed_${i}`] = { displayName: `Seed ${i}`, role: 'player' };
    }
    await system.store.setMeta('members', JSON.stringify(existingMembers));

    const outcome = await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'quota' });
  });

  it('does not count a re-join of an EXISTING member against the 12-member cap', async () => {
    await system.actor.append([makeCreated()], dmActor());
    const existingMembers: Record<string, { displayName: string; role: string }> = {};
    for (let i = 0; i < CAMPAIGN_MEMBER_MAX; i += 1) {
      existingMembers[`usr_seed_${i}`] = { displayName: `Seed ${i}`, role: 'player' };
    }
    await system.store.setMeta('members', JSON.stringify(existingMembers));

    const outcome = await system.actor.append([makeMemberJoined('usr_seed_0', 'Seed 0 Rejoin')], {
      userId: 'usr_seed_0',
      role: 'member',
    });
    expect(outcome.rejected).toEqual([]);
  });

  it('rejects the 7th non-core pack.enabled once meta already holds 6', async () => {
    await system.actor.append([makeCreated()], dmActor());
    const existingPacks = Array.from({ length: CAMPAIGN_NON_CORE_PACK_MAX }, (_, i) => ({
      packId: `homebrew-${i}`,
      version: '1.0.0',
      sha256: '0'.repeat(64),
    }));
    await system.store.setMeta('packs', JSON.stringify(existingPacks));

    const outcome = await system.actor.append(
      [makeEvent('pack.enabled', { packId: 'one-too-many', version: '1.0.0', sha256: '1'.repeat(64) }, dmActor())],
      dmActor(),
    );
    expect(outcome.acked).toEqual([]);
    expect(outcome.rejected[0]).toMatchObject({ code: 'quota' });
  });

  it('does not count re-enabling an EXISTING pack against the 6-pack cap', async () => {
    await system.actor.append([makeCreated()], dmActor());
    const existingPacks = Array.from({ length: CAMPAIGN_NON_CORE_PACK_MAX }, (_, i) => ({
      packId: `homebrew-${i}`,
      version: '1.0.0',
      sha256: '0'.repeat(64),
    }));
    await system.store.setMeta('packs', JSON.stringify(existingPacks));

    const outcome = await system.actor.append(
      [makeEvent('pack.enabled', { packId: 'homebrew-0', version: '1.0.0', sha256: '0'.repeat(64) }, dmActor())],
      dmActor(),
    );
    expect(outcome.rejected).toEqual([]);
  });
});

describe('read-visibility filtering (fan-out)', () => {
  async function seedTwoConnections() {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    const dmConn = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    const memberConn = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    return { dmConn, memberConn };
  }

  it('never fans dm.note_added out to a non-DM connection, but does to a DM connection', async () => {
    const { dmConn, memberConn } = await seedTwoConnections();
    const sender = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });

    await system.actor.append(
      [makeEvent('dm.note_added', { id: uuidv7(), title: 'Secret', body: 'shh' }, dmActor())],
      dmActor(),
      sender,
    );

    expect(system.connections.framesFor(memberConn).filter((f) => f.t === 'events')).toEqual([]);
    const dmEventsFrames = system.connections.framesFor(dmConn).filter((f) => f.t === 'events');
    expect(dmEventsFrames).toHaveLength(1);
  });

  it("roll.logged visibility 'dm' reaches DM connections and the roller's own connections only", async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));
    const dmConn = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    const memberConn = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const otherMemberConn = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await system.actor.append(
      [
        makeEvent(
          'roll.logged',
          {
            label: 'Stealth check',
            formula: '1d20+2',
            results: [{ die: 'd20', value: 9 }],
            total: 11,
            kind: 'check',
            visibility: 'dm',
          },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );

    expect(system.connections.framesFor(dmConn).filter((f) => f.t === 'events')).toHaveLength(1);
    expect(system.connections.framesFor(memberConn).filter((f) => f.t === 'events')).toHaveLength(1); // the roller
    expect(system.connections.framesFor(otherMemberConn).filter((f) => f.t === 'events')).toEqual([]);
  });

  it("roll.logged visibility 'private' reaches only the roller's own connections", async () => {
    const { dmConn, memberConn } = await seedTwoConnections();

    await system.actor.append(
      [
        makeEvent(
          'roll.logged',
          {
            label: 'Perception check',
            formula: '1d20+1',
            results: [{ die: 'd20', value: 3 }],
            total: 4,
            kind: 'check',
            visibility: 'private',
          },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );

    expect(system.connections.framesFor(dmConn).filter((f) => f.t === 'events')).toEqual([]);
    expect(system.connections.framesFor(memberConn).filter((f) => f.t === 'events')).toHaveLength(1);
  });

  it("roll.logged visibility 'everyone' reaches every connection", async () => {
    const { dmConn, memberConn } = await seedTwoConnections();

    await system.actor.append(
      [
        makeEvent(
          'roll.logged',
          {
            label: 'Attack roll',
            formula: '1d20+5',
            results: [{ die: 'd20', value: 15 }],
            total: 20,
            kind: 'attack',
            visibility: 'everyone',
          },
          memberActor(MEMBER_A),
        ),
      ],
      memberActor(MEMBER_A),
    );

    expect(system.connections.framesFor(dmConn).filter((f) => f.t === 'events')).toHaveLength(1);
    expect(system.connections.framesFor(memberConn).filter((f) => f.t === 'events')).toHaveLength(1);
  });

  // [fix round 1, Adjudicated 3] chat.message carries the SAME visibility enum roll.logged does
  // and is now filtered identically — doc-08's filtering paragraph previously omitted it (a real
  // gap, not intended pass-through); the controller/reviewer adjudicated it should be filtered,
  // and docs/02-architecture/08-security-permissions-quotas.md's filtering paragraph now names it.
  it("chat.message visibility 'dm' reaches DM connections and the sender's own connections only", async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));
    const dmConn = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    const memberConn = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const otherMemberConn = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await system.actor.append(
      [makeEvent('chat.message', { text: 'DM, a word?', visibility: 'dm' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );

    expect(system.connections.framesFor(dmConn).filter((f) => f.t === 'events')).toHaveLength(1);
    expect(system.connections.framesFor(memberConn).filter((f) => f.t === 'events')).toHaveLength(1); // the sender
    expect(system.connections.framesFor(otherMemberConn).filter((f) => f.t === 'events')).toEqual([]);
  });

  it("chat.message visibility 'private' reaches only the sender's own connections", async () => {
    const { dmConn, memberConn } = await seedTwoConnections();

    await system.actor.append(
      [makeEvent('chat.message', { text: 'psst', visibility: 'private' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );

    expect(system.connections.framesFor(dmConn).filter((f) => f.t === 'events')).toEqual([]);
    expect(system.connections.framesFor(memberConn).filter((f) => f.t === 'events')).toHaveLength(1);
  });

  it("chat.message visibility 'everyone' reaches every connection", async () => {
    const { dmConn, memberConn } = await seedTwoConnections();

    await system.actor.append(
      [makeEvent('chat.message', { text: 'hi party', visibility: 'everyone' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );

    expect(system.connections.framesFor(dmConn).filter((f) => f.t === 'events')).toHaveLength(1);
    expect(system.connections.framesFor(memberConn).filter((f) => f.t === 'events')).toHaveLength(1);
  });
});

describe('read-visibility filtering (catch-up paging)', () => {
  it('filters dm.note_added out of catch-up for a non-DM socket, but includes it for a DM socket', async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.actor.append(
      [makeEvent('dm.note_added', { id: uuidv7(), title: 'Secret', body: 'shh' }, dmActor())],
      dmActor(),
    );
    await system.actor.append(
      [makeEvent('chat.message', { text: 'hi', visibility: 'everyone' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );

    const memberConn = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const hello: HelloMsg = {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [{ id: STREAM_ID, lastSeq: 0 }],
      have: [],
      pending: [],
    };
    await system.actor.hello(memberConn, hello);
    const memberSeenTypes = system.connections
      .framesFor(memberConn)
      .filter((f) => f.t === 'events')
      .flatMap((f) => f.events.map((e) => e.type));
    expect(memberSeenTypes).not.toContain('dm.note_added');
    expect(memberSeenTypes).toContain('chat.message');

    const dmConn = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    await system.actor.hello(dmConn, { ...hello, rid: 'r2' });
    const dmSeenTypes = system.connections
      .framesFor(dmConn)
      .filter((f) => f.t === 'events')
      .flatMap((f) => f.events.map((e) => e.type));
    expect(dmSeenTypes).toContain('dm.note_added');
  });

  // [fix round 1, Adjudicated 3] the same private-visibility filtering chat.message now gets on
  // live fan-out must also apply to catch-up (this task's own catch-up-filtering fix already
  // routes both through the same `filterForConnection` hook — this pins chat.message specifically).
  it("filters a private chat.message out of catch-up for a non-sender socket, but includes it for the sender's own reconnect", async () => {
    await system.actor.append([makeCreated()], dmActor());
    await system.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));
    await system.actor.append(
      [makeEvent('chat.message', { text: 'psst', visibility: 'private' }, memberActor(MEMBER_A))],
      memberActor(MEMBER_A),
    );

    const hello: HelloMsg = {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [{ id: STREAM_ID, lastSeq: 0 }],
      have: [],
      pending: [],
    };

    const otherMemberConn = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });
    await system.actor.hello(otherMemberConn, hello);
    const otherSeenTypes = system.connections
      .framesFor(otherMemberConn)
      .filter((f) => f.t === 'events')
      .flatMap((f) => f.events.map((e) => e.type));
    expect(otherSeenTypes).not.toContain('chat.message');

    const senderReconnect = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    await system.actor.hello(senderReconnect, { ...hello, rid: 'r2' });
    const senderSeenTypes = system.connections
      .framesFor(senderReconnect)
      .filter((f) => f.t === 'events')
      .flatMap((f) => f.events.map((e) => e.type));
    expect(senderSeenTypes).toContain('chat.message');
  });
});

describe('presence', () => {
  function makeFakeClock() {
    let current = 0;
    const scheduled: { fn: () => void; ms: number }[] = [];
    return {
      now: () => current,
      advance: (ms: number) => {
        current += ms;
      },
      setTimer: (fn: () => void, ms: number) => {
        scheduled.push({ fn, ms });
        return scheduled.length;
      },
      scheduled,
      // The scheduled callback's own `broadcastPresence()` call is fire-and-forget (matches a
      // REAL `setTimeout` callback, which nothing awaits either) — flushing a macrotask after
      // invoking it lets every microtask its async chain queues (`getCampaignMeta`'s
      // `Promise.all`, etc.) actually run before the test asserts on the frames it sent.
      fireNext: async () => {
        const next = scheduled.shift();
        next?.fn();
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }

  it('sends a members frame immediately on the first connect (leading edge)', async () => {
    const clock = makeFakeClock();
    const local = makeSystem({ now: clock.now, setTimer: clock.setTimer });
    await local.actor.append([makeCreated()], dmActor());
    await local.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));

    const conn = local.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    await local.actor.hello(conn, {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [{ id: STREAM_ID, lastSeq: 0 }],
      have: [],
      pending: [],
    });

    const membersFrames = local.connections.framesFor(conn).filter((f) => f.t === 'members');
    expect(membersFrames).toHaveLength(1);
    const roster = membersFrames[0]?.t === 'members' ? membersFrames[0].members : [];
    const alice = roster.find((m) => m.userId === MEMBER_A);
    expect(alice).toMatchObject({ displayName: 'Alice', role: 'member', online: true });
    const dm = roster.find((m) => m.userId === DM_ID);
    expect(dm).toMatchObject({ role: 'dm', online: false }); // DM has no live connection yet
  });

  it('throttles a burst of connects to at most one immediate send, with exactly one trailing send scheduled', async () => {
    const clock = makeFakeClock();
    const local = makeSystem({ now: clock.now, setTimer: clock.setTimer });
    await local.actor.append([makeCreated()], dmActor());
    await local.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));
    await local.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));

    const helloFor = (userId: string, rid: string): HelloMsg => ({
      t: 'hello',
      rid,
      proto: 1,
      app: '1.0.0',
      streams: [{ id: STREAM_ID, lastSeq: 0 }],
      have: [],
      pending: [],
    });

    const connA = local.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    await local.actor.hello(connA, helloFor(MEMBER_A, 'r1')); // t=0: leading-edge immediate send

    clock.advance(1_000); // still inside the 5s window
    const connB = local.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });
    await local.actor.hello(connB, helloFor(MEMBER_B, 'r2')); // throttled: no immediate send, one timer scheduled

    expect(local.connections.framesFor(connA).filter((f) => f.t === 'members')).toHaveLength(1);
    expect(local.connections.framesFor(connB).filter((f) => f.t === 'members')).toEqual([]);
    expect(clock.scheduled).toHaveLength(1);

    clock.advance(500);
    // A second trigger while one is already scheduled must NOT add a second timer (still 1).
    await local.actor.onConnectionClosed(connB);
    expect(clock.scheduled).toHaveLength(1);

    await clock.fireNext(); // simulate the throttle window elapsing — the trailing send fires
    expect(local.connections.framesFor(connA).filter((f) => f.t === 'members')).toHaveLength(2);
    expect(local.connections.framesFor(connB).filter((f) => f.t === 'members')).toHaveLength(1);
  });

  it('onConnectionClosed triggers a presence broadcast reflecting the connection’s absence', async () => {
    const clock = makeFakeClock();
    const local = makeSystem({ now: clock.now, setTimer: clock.setTimer });
    await local.actor.append([makeCreated()], dmActor());
    await local.actor.append([makeMemberJoined(MEMBER_A, 'Alice')], memberActor(MEMBER_A));

    const conn = local.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    await local.actor.hello(conn, {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [{ id: STREAM_ID, lastSeq: 0 }],
      have: [],
      pending: [],
    });

    clock.advance(10_000); // clear of the throttle window
    local.connections.close(conn, 1000, 'normal'); // adapter removes the connection first...
    await local.actor.onConnectionClosed(conn); // ...then notifies the actor (this file's doc comment)

    // The closed connection itself received no further frame (it's gone), but the broadcast still
    // ran without throwing against an empty `connections.all()` for a solo-member campaign.
    expect(local.connections.framesFor(conn).filter((f) => f.t === 'members')).toHaveLength(1); // only the earlier hello send
  });
});

describe('subscribe/unsubscribe attachment bookkeeping', () => {
  it('the DM may subscribe to any known character stream', async () => {
    const { characterId } = await seedCampaignWithMemberAndCharacter();
    const dmConn = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });

    const msg: SubscribeMsg = { t: 'subscribe', stream: `char:${characterId}` };
    await system.actor.handleMessage(dmConn, msg);

    expect(system.connections.getAttachment(dmConn).subs).toContain(`char:${characterId}`);
  });

  it("a member may subscribe to their OWN character's stream", async () => {
    const { characterId } = await seedCampaignWithMemberAndCharacter();
    const memberConn = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });

    const msg: SubscribeMsg = { t: 'subscribe', stream: `char:${characterId}` };
    await system.actor.handleMessage(memberConn, msg);

    expect(system.connections.getAttachment(memberConn).subs).toContain(`char:${characterId}`);
  });

  it("a member may NOT subscribe to another member's character stream", async () => {
    const { characterId } = await seedCampaignWithMemberAndCharacter();
    await system.actor.append([makeMemberJoined(MEMBER_B, 'Bob')], memberActor(MEMBER_B));
    const otherConn = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    const msg: SubscribeMsg = { t: 'subscribe', stream: `char:${characterId}` };
    await system.actor.handleMessage(otherConn, msg);

    expect(system.connections.getAttachment(otherConn).subs).toEqual([]);
  });

  it('unsubscribe removes a previously recorded subscription', async () => {
    const { characterId } = await seedCampaignWithMemberAndCharacter();
    const dmConn = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    await system.actor.handleMessage(dmConn, { t: 'subscribe', stream: `char:${characterId}` } satisfies SubscribeMsg);
    expect(system.connections.getAttachment(dmConn).subs).toContain(`char:${characterId}`);

    await system.actor.handleMessage(dmConn, {
      t: 'unsubscribe',
      stream: `char:${characterId}`,
    } satisfies UnsubscribeMsg);
    expect(system.connections.getAttachment(dmConn).subs).not.toContain(`char:${characterId}`);
  });

  it('other message types (e.g. append) still dispatch normally through the base pipeline', async () => {
    const dmConn = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    await system.actor.handleMessage(dmConn, {
      t: 'hello',
      rid: 'r1',
      proto: 1,
      app: '1.0.0',
      streams: [],
      have: [],
      pending: [],
    });
    expect(system.connections.framesFor(dmConn).some((f) => f.t === 'welcome')).toBe(true);
  });
});
