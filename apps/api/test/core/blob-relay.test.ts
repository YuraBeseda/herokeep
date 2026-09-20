/**
 * Task 7: campaign blob relay (doc-07 §Blob transfer protocol) — holders map, `blob.have`/
 * `blob.request`/`blob.cancel`/`blob.chunk`/`blob.unavailable` dispatch through `CampaignActor`,
 * the 16-byte binary chunk header codec, flow control (one in-flight transfer per requester, at
 * most two concurrent serves per holder), and the hibernation rebuild ask. Against the SAME
 * in-memory fakes `campaign-actor.test.ts` uses (`FakeStreamStore`/`FakeConnections`), plus the
 * Task 7 binary-frame test encoder (`test/helpers/blob-frames.ts`) standing in for a "holder"
 * client — no client transfer code ships in this plan (design ruling 4), so these scripted frames
 * are the only exerciser until plan 10.
 */
import type { BlobPullMsg, HelloMsg, ServerMessage } from '@hk/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import * as campaignPermissions from '../../src/core/campaign-permissions.ts';
import { uuidv7 } from '../../src/core/ids.ts';
import {
  BLOB_CHUNK_HEADER_BYTES,
  BLOB_CHUNK_MAGIC,
  decodeBlobChunkHeader,
  MAX_BLOB_CHUNK_PAYLOAD_BYTES,
  MAX_HASHES_PER_CONNECTION,
} from '../../src/core/streams/blob-relay.ts';
import { campaignQuotas, CampaignActor } from '../../src/core/streams/campaign-actor.ts';
import { buildBlobChunkFrame, hashPrefixOf } from '../helpers/blob-frames.ts';
import { FakeConnections } from '../helpers/fake-connections.ts';
import { FakeStreamStore } from '../helpers/fake-stream-store.ts';

const STREAM_ID = `camp:${uuidv7()}`;
const DM_ID = 'usr_dm1';
const MEMBER_A = 'usr_alice';
const MEMBER_B = 'usr_bob';
const MEMBER_C = 'usr_carol';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

/** A distinct, schema-valid (`sha256:[0-9a-f]{64}`) hash per `n` — used for the per-connection cap
 * boundary test, which needs `MAX_HASHES_PER_CONNECTION + 1` genuinely different hashes. */
function hashN(n: number): string {
  return `sha256:${n.toString(16).padStart(64, '0')}`;
}

function makeSystem() {
  const store = new FakeStreamStore();
  const connections = new FakeConnections();
  const actor = new CampaignActor({
    store,
    connections,
    quotas: campaignQuotas,
    permissions: campaignPermissions,
    streamId: STREAM_ID,
  });
  return { store, connections, actor };
}

function helloMsg(rid: string, have: string[] = []): HelloMsg {
  return { t: 'hello', rid, proto: 1, app: 'test/1.0.0', streams: [], have, pending: [] };
}

/** Narrows a connection's recorded frames down to `blob.pull` ones, in send order. */
function pullsFor(frames: readonly ServerMessage[]): BlobPullMsg[] {
  return frames.filter((f): f is BlobPullMsg => f.t === 'blob.pull');
}

/** The single `blob.pull` frame a holder connection received — throws (failing the test loudly)
 * if there isn't exactly one, so every call site gets a statically-narrowed, non-optional result. */
function onlyPull(frames: readonly ServerMessage[]): BlobPullMsg {
  const pulls = pullsFor(frames);
  if (pulls.length !== 1) throw new Error(`expected exactly one blob.pull frame, got ${pulls.length}`);
  return pulls[0]!;
}

let system: ReturnType<typeof makeSystem>;

beforeEach(() => {
  system = makeSystem();
});

describe('binary chunk header codec', () => {
  it('round-trips a valid header through encode/decode', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = buildBlobChunkFrame({ index: 2, total: 5, to: 42, hashPrefix: hashPrefixOf(HASH_A), payload });
    const decoded = decodeBlobChunkHeader(frame);
    expect(decoded).toBeDefined();
    expect(decoded?.index).toBe(2);
    expect(decoded?.total).toBe(5);
    expect(decoded?.to).toBe(42);
    expect(decoded?.hashPrefix).toEqual(hashPrefixOf(HASH_A));
    expect(decoded?.payload).toEqual(payload);
  });

  it('rejects a frame shorter than the 16-byte header', () => {
    const short = new Uint8Array(BLOB_CHUNK_HEADER_BYTES - 1);
    short.set(BLOB_CHUNK_MAGIC, 0);
    expect(decodeBlobChunkHeader(short)).toBeUndefined();
  });

  it('rejects a frame with the wrong magic', () => {
    const frame = buildBlobChunkFrame({ index: 0, total: 1, to: 1 });
    frame[0] = frame[0] === 0 ? 1 : 0; // corrupt the first magic byte
    expect(decodeBlobChunkHeader(frame)).toBeUndefined();
  });

  it('rejects a frame whose payload exceeds the 64KB cap', () => {
    const oversized = new Uint8Array(MAX_BLOB_CHUNK_PAYLOAD_BYTES + 1);
    const frame = buildBlobChunkFrame({ index: 0, total: 1, to: 1, payload: oversized });
    expect(decodeBlobChunkHeader(frame)).toBeUndefined();
  });
});

describe('blob.have / blob.request / blob.unavailable', () => {
  it('routes blob.pull to the sole announced holder, naming the requester as `to`', async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const requester = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await system.actor.handleMessage(holder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: HASH_A });

    const pull = onlyPull(system.connections.framesFor(holder));
    expect(pull.hash).toBe(HASH_A);
    expect(typeof pull.to).toBe('string');
    expect(system.connections.framesFor(requester).some((f) => f.t === 'blob.unavailable')).toBe(false);
  });

  it('replies blob.unavailable when no holder has announced the hash', async () => {
    const requester = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: HASH_A });
    expect(system.connections.framesFor(requester)).toContainEqual({ t: 'blob.unavailable', hash: HASH_A });
  });

  it('prefers the first announcer over a later-announcing DM (uploader-priority proxy)', async () => {
    const firstAnnouncer = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const dmHolder = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    const requester = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await system.actor.handleMessage(firstAnnouncer, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(dmHolder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: HASH_A });

    expect(pullsFor(system.connections.framesFor(firstAnnouncer))).toHaveLength(1);
    expect(pullsFor(system.connections.framesFor(dmHolder))).toHaveLength(0);
  });

  it('falls back to the DM among remaining eligible holders once the first announcer is at capacity', async () => {
    const firstAnnouncer = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const dmHolder = system.connections.accept({}, { userId: DM_ID, role: 'dm', subs: [] });
    const plainHolder = system.connections.accept({}, { userId: MEMBER_C, role: 'member', subs: [] });
    const req1 = system.connections.accept({}, { userId: 'usr_req1', role: 'member', subs: [] });
    const req2 = system.connections.accept({}, { userId: 'usr_req2', role: 'member', subs: [] });
    const req3 = system.connections.accept({}, { userId: 'usr_req3', role: 'member', subs: [] });

    // firstAnnouncer holds two unrelated hashes so two other requests can fill its 2-slot capacity.
    await system.actor.handleMessage(firstAnnouncer, { t: 'blob.have', hashes: [HASH_A, HASH_B] });
    await system.actor.handleMessage(dmHolder, { t: 'blob.have', hashes: [HASH_B] });
    await system.actor.handleMessage(plainHolder, { t: 'blob.have', hashes: [HASH_B] });

    await system.actor.handleMessage(req1, { t: 'blob.request', rid: 'r1', hash: HASH_A });
    await system.actor.handleMessage(req2, { t: 'blob.request', rid: 'r2', hash: HASH_A });

    // firstAnnouncer is now serving 2 requesters (req1, req2) for HASH_A — at capacity for ANY hash.
    await system.actor.handleMessage(req3, { t: 'blob.request', rid: 'r3', hash: HASH_B });

    expect(pullsFor(system.connections.framesFor(dmHolder))).toHaveLength(1);
    expect(pullsFor(system.connections.framesFor(plainHolder))).toHaveLength(0);
  });
});

describe('blob.chunk forwarding', () => {
  it('forwards a binary chunk byte-for-byte from holder to the requester named in blob.pull', async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const requester = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await system.actor.handleMessage(holder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: HASH_A });

    const pull = onlyPull(system.connections.framesFor(holder));
    const frame = buildBlobChunkFrame({
      index: 0,
      total: 1,
      to: Number(pull.to),
      hashPrefix: hashPrefixOf(HASH_A),
      payload: new Uint8Array([9, 8, 7]),
    });

    system.actor.handleBinaryMessage(holder, frame);

    const forwarded = system.connections.binaryFramesFor(requester);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toEqual(frame);
    expect(system.connections.binaryFramesFor(holder)).toHaveLength(0);
  });

  it('drops a chunk whose `to` field names no known connection', () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const frame = buildBlobChunkFrame({ index: 0, total: 1, to: 999_999 });
    expect(() => system.actor.handleBinaryMessage(holder, frame)).not.toThrow();
  });

  it('frees the holder/requester flow-control slots on the last chunk (index === total - 1)', async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const req1 = system.connections.accept({}, { userId: 'usr_req1', role: 'member', subs: [] });
    const req2 = system.connections.accept({}, { userId: 'usr_req2', role: 'member', subs: [] });

    await system.actor.handleMessage(holder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(req1, { t: 'blob.request', rid: 'r1', hash: HASH_A });
    await system.actor.handleMessage(req2, { t: 'blob.request', rid: 'r2', hash: HASH_A });
    // holder now serving 2/2 — a third requester must get blob.unavailable.
    const req3 = system.connections.accept({}, { userId: 'usr_req3', role: 'member', subs: [] });
    await system.actor.handleMessage(req3, { t: 'blob.request', rid: 'r3', hash: HASH_A });
    expect(system.connections.framesFor(req3)).toContainEqual({ t: 'blob.unavailable', hash: HASH_A });

    // Complete req1's transfer (last chunk) — frees one of holder's two serving slots.
    const pull1 = pullsFor(system.connections.framesFor(holder))[0];
    if (!pull1) throw new Error('expected a blob.pull frame for req1');
    const lastChunk = buildBlobChunkFrame({ index: 0, total: 1, to: Number(pull1.to) });
    system.actor.handleBinaryMessage(holder, lastChunk);

    // req3 retries and now succeeds.
    await system.actor.handleMessage(req3, { t: 'blob.request', rid: 'r4', hash: HASH_A });
    const pullTargets = pullsFor(system.connections.framesFor(holder)).map((f) => f.to);
    expect(pullTargets).toContain(pull1.to); // sanity: original pull is still recorded
    expect(system.connections.framesFor(req3).filter((f) => f.t === 'blob.unavailable')).toHaveLength(1); // no SECOND unavailable
  });
});

describe('blob.chunk sender authorization (fix round 1, Critical C1)', () => {
  it('drops a chunk whose sender is not the assigned holder — not forwarded to the target', async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const attacker = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });
    const victim = system.connections.accept({}, { userId: MEMBER_C, role: 'member', subs: [] });

    await system.actor.handleMessage(holder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(victim, { t: 'blob.request', rid: 'r1', hash: HASH_A });

    const pull = onlyPull(system.connections.framesFor(holder));
    // `attacker` is an ordinary admitted member — never announced HASH_A, never received a
    // blob.pull for it — but crafts a well-formed chunk frame naming the victim's connId as `to`.
    const forged = buildBlobChunkFrame({ index: 0, total: 1, to: Number(pull.to), payload: new Uint8Array([1, 2, 3]) });

    system.actor.handleBinaryMessage(attacker, forged);

    expect(system.connections.binaryFramesFor(victim)).toHaveLength(0);
  });

  it("a forged completion frame from a non-holder sender does not free the real holder's serving slot", async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const attacker = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });
    const req1 = system.connections.accept({}, { userId: 'usr_req1', role: 'member', subs: [] });
    const req2 = system.connections.accept({}, { userId: 'usr_req2', role: 'member', subs: [] });
    const req3 = system.connections.accept({}, { userId: 'usr_req3', role: 'member', subs: [] });

    await system.actor.handleMessage(holder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(req1, { t: 'blob.request', rid: 'r1', hash: HASH_A });
    await system.actor.handleMessage(req2, { t: 'blob.request', rid: 'r2', hash: HASH_A });
    // holder is now at its 2-serve cap.

    const pull1 = pullsFor(system.connections.framesFor(holder))[0];
    if (!pull1) throw new Error('expected a blob.pull frame for req1');

    // Attacker forges a "completion" chunk (index === total - 1) claiming to be from the holder,
    // targeting req1's connId — attempting to trick the relay into releasing the real holder's slot.
    const forgedCompletion = buildBlobChunkFrame({ index: 0, total: 1, to: Number(pull1.to) });
    system.actor.handleBinaryMessage(attacker, forgedCompletion);

    // Not forwarded to req1, and the holder's slot was NOT released: a third request still finds
    // the holder at capacity.
    expect(system.connections.binaryFramesFor(req1)).toHaveLength(0);
    await system.actor.handleMessage(req3, { t: 'blob.request', rid: 'r3', hash: HASH_A });
    expect(system.connections.framesFor(req3)).toContainEqual({ t: 'blob.unavailable', hash: HASH_A });

    // The REAL holder's own completion chunk for req1 still works normally afterward, freeing the
    // slot for real.
    const realCompletion = buildBlobChunkFrame({ index: 0, total: 1, to: Number(pull1.to) });
    system.actor.handleBinaryMessage(holder, realCompletion);
    expect(system.connections.binaryFramesFor(req1)).toHaveLength(1);

    await system.actor.handleMessage(req3, { t: 'blob.request', rid: 'r4', hash: HASH_A });
    expect(pullsFor(system.connections.framesFor(holder))).toHaveLength(3); // req1, req2, and now req3
  });
});

describe('flow control: one in-flight transfer per requester', () => {
  it('silently drops a second blob.request from the same requester while one is in flight', async () => {
    const holderA = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const holderB = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });
    const requester = system.connections.accept({}, { userId: MEMBER_C, role: 'member', subs: [] });

    await system.actor.handleMessage(holderA, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(holderB, { t: 'blob.have', hashes: [HASH_B] });

    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: HASH_A });
    expect(pullsFor(system.connections.framesFor(holderA))).toHaveLength(1);

    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r2', hash: HASH_B });
    expect(pullsFor(system.connections.framesFor(holderB))).toHaveLength(0);
    expect(system.connections.framesFor(requester).some((f) => f.t === 'blob.unavailable')).toBe(false);
  });

  it('blob.cancel releases the slot so a new request can proceed', async () => {
    const holderA = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const holderB = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });
    const requester = system.connections.accept({}, { userId: MEMBER_C, role: 'member', subs: [] });

    await system.actor.handleMessage(holderA, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(holderB, { t: 'blob.have', hashes: [HASH_B] });

    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: HASH_A });
    await system.actor.handleMessage(requester, { t: 'blob.cancel', hash: HASH_A });
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r2', hash: HASH_B });

    expect(pullsFor(system.connections.framesFor(holderB))).toHaveLength(1);
  });
});

describe('connection close cleanup', () => {
  it('frees a dead holder from the holders set — a fresh request for that hash is unavailable', async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const requester = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await system.actor.handleMessage(holder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.onConnectionClosed(holder);
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: HASH_A });

    expect(system.connections.framesFor(requester)).toContainEqual({ t: 'blob.unavailable', hash: HASH_A });
  });

  it('releases a requester in-flight transfer whose holder disconnected, unblocking a retry', async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const requester = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await system.actor.handleMessage(holder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: HASH_A });
    await system.actor.onConnectionClosed(holder);

    // No other holder exists, so the retry correctly resolves to unavailable — the point being it
    // is NOT silently dropped by the (now stale) one-in-flight guard.
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r2', hash: HASH_A });
    expect(system.connections.framesFor(requester)).toContainEqual({ t: 'blob.unavailable', hash: HASH_A });
  });

  it("[fix round 1, Important I1] releases the HOLDER's serving slot when a REQUESTER disconnects without cancelling", async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const req1 = system.connections.accept({}, { userId: 'usr_req1', role: 'member', subs: [] });
    const req2 = system.connections.accept({}, { userId: 'usr_req2', role: 'member', subs: [] });
    const req3 = system.connections.accept({}, { userId: 'usr_req3', role: 'member', subs: [] });

    await system.actor.handleMessage(holder, { t: 'blob.have', hashes: [HASH_A] });
    await system.actor.handleMessage(req1, { t: 'blob.request', rid: 'r1', hash: HASH_A });
    await system.actor.handleMessage(req2, { t: 'blob.request', rid: 'r2', hash: HASH_A });

    // holder is at its 2-serve cap — a third requester is refused.
    await system.actor.handleMessage(req3, { t: 'blob.request', rid: 'r3', hash: HASH_A });
    expect(system.connections.framesFor(req3)).toContainEqual({ t: 'blob.unavailable', hash: HASH_A });

    // req1 disconnects WITHOUT sending blob.cancel first.
    await system.actor.onConnectionClosed(req1);

    // The holder's slot for req1 must be freed by the close handler itself (not only req1's own
    // bookkeeping) — req3 retries and now succeeds.
    await system.actor.handleMessage(req3, { t: 'blob.request', rid: 'r4', hash: HASH_A });
    expect(pullsFor(system.connections.framesFor(holder))).toHaveLength(3); // req1, req2, req3
  });
});

describe('per-connection hash cap (fix round 1, Important I3)', () => {
  it(`drops announcements beyond MAX_HASHES_PER_CONNECTION (${MAX_HASHES_PER_CONNECTION}) for a single connection`, async () => {
    const holder = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const requester = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    const hashes = Array.from({ length: MAX_HASHES_PER_CONNECTION + 1 }, (_, i) => hashN(i));
    await system.actor.handleMessage(holder, { t: 'blob.have', hashes });

    // The (cap + 1)-th distinct hash from this SAME connection was never registered.
    const overflowHash = hashes[MAX_HASHES_PER_CONNECTION];
    if (!overflowHash) throw new Error('test setup error: no overflow hash');
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r1', hash: overflowHash });
    expect(system.connections.framesFor(requester)).toContainEqual({ t: 'blob.unavailable', hash: overflowHash });

    // A hash well within the cap IS registered.
    const withinCapHash = hashes[0];
    if (!withinCapHash) throw new Error('test setup error: no within-cap hash');
    await system.actor.handleMessage(requester, { t: 'blob.request', rid: 'r2', hash: withinCapHash });
    expect(pullsFor(system.connections.framesFor(holder))).toHaveLength(1);
  });
});

describe('hibernation rebuild ask', () => {
  it('broadcasts blob.resend-have to every connected socket on the first hello while the holders map is empty', async () => {
    const connA = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    const connB = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });

    await system.actor.hello(connA, helloMsg('r1', []));

    const notice = { t: 'notice', level: 'info', key: 'blob.resend-have' };
    expect(system.connections.framesFor(connA)).toContainEqual(notice);
    expect(system.connections.framesFor(connB)).toContainEqual(notice);
  });

  it('does not re-ask once the holders map has been populated', async () => {
    const connA = system.connections.accept({}, { userId: MEMBER_A, role: 'member', subs: [] });
    await system.actor.hello(connA, helloMsg('r1', [HASH_A]));

    const connB = system.connections.accept({}, { userId: MEMBER_B, role: 'member', subs: [] });
    await system.actor.hello(connB, helloMsg('r2', []));

    const notice = { t: 'notice', level: 'info', key: 'blob.resend-have' };
    expect(system.connections.framesFor(connB)).not.toContainEqual(notice);
  });
});
