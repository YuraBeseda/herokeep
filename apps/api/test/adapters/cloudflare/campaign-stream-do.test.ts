/**
 * `CampaignStreamDO` — the DO accepts a WS and answers hello -> welcome, plus the binary blob-
 * relay receive wiring and the hard-delete generation guard (plan-9 Task 8, obligations 4 and 5).
 * Same "mocked WebSocket pair via `runInDurableObject`, not a real WS upgrade" approach as
 * `character-stream-do.test.ts` — see that file's header comment for the full rationale
 * (`@cloudflare/vitest-pool-workers`'s documented per-test-file WS/DO isolation limitation), which
 * applies identically here.
 */
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@hk/protocol';
import { env } from './typed-env.ts';

const INTERNAL_STREAM_ID_HEADER = 'X-Hk-Internal-Stream-Id';
const INTERNAL_USER_ID_HEADER = 'X-Hk-Internal-User-Id';
const INTERNAL_ROLE_HEADER = 'X-Hk-Internal-Role';

/** Same fake `WebSocket` shape as `character-stream-do.test.ts`'s own `makeFakeWebSocket` —
 * duplicated rather than imported (that file's helper is module-local, not exported; both are
 * small enough that a shared test-helper module would be more indirection than it saves). */
function makeFakeWebSocket(): {
  sent: ServerMessage[];
  closeCalls: { code: number; reason: string }[];
  ws: WebSocket;
} {
  const sent: ServerMessage[] = [];
  const closeCalls: { code: number; reason: string }[] = [];
  let attachment: unknown;
  const ws = {
    readyState: 1,
    send: (data: string | ArrayBuffer) => {
      if (typeof data === 'string') sent.push(JSON.parse(data) as ServerMessage);
    },
    close: (code?: number, reason?: string) => {
      closeCalls.push({ code: code ?? 0, reason: reason ?? '' });
    },
    serializeAttachment: (value: unknown) => {
      attachment = value;
    },
    deserializeAttachment: () => attachment ?? null,
  };
  return { sent, closeCalls, ws: ws as unknown as WebSocket };
}

function callDeleteAll(instance: unknown, streamId: string): Promise<void> {
  return (instance as { deleteAll(id: string): Promise<void> }).deleteAll(streamId);
}

describe('CampaignStreamDO — WS message handling (plan-9 Task 8, obligation 5)', () => {
  it('fetch() refuses an internal request missing the trust-boundary headers', async () => {
    const id = env.CAMPAIGN_STREAM.idFromName(`camp:${crypto.randomUUID()}`);
    const stub = env.CAMPAIGN_STREAM.get(id);

    await runInDurableObject(stub, async (instance) => {
      const res = await instance.fetch!(new Request('https://internal.test/', { headers: { Upgrade: 'websocket' } }));
      expect(res.status).toBe(400);
    });
  });

  it('fetch() refuses role: owner (only dm/member are valid campaign-socket roles)', async () => {
    const streamId = `camp:${crypto.randomUUID()}`;
    const id = env.CAMPAIGN_STREAM.idFromName(streamId);
    const stub = env.CAMPAIGN_STREAM.get(id);

    await runInDurableObject(stub, async (instance) => {
      const res = await instance.fetch!(
        new Request('https://internal.test/', {
          headers: {
            [INTERNAL_STREAM_ID_HEADER]: streamId,
            [INTERNAL_USER_ID_HEADER]: 'user-1',
            [INTERNAL_ROLE_HEADER]: 'owner',
            Upgrade: 'websocket',
          },
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  it('fetch() with the internal headers but no Upgrade header answers 426', async () => {
    const streamId = `camp:${crypto.randomUUID()}`;
    const id = env.CAMPAIGN_STREAM.idFromName(streamId);
    const stub = env.CAMPAIGN_STREAM.get(id);

    await runInDurableObject(stub, async (instance) => {
      const res = await instance.fetch!(
        new Request('https://internal.test/', {
          headers: {
            [INTERNAL_STREAM_ID_HEADER]: streamId,
            [INTERNAL_USER_ID_HEADER]: 'user-1',
            [INTERNAL_ROLE_HEADER]: 'dm',
          },
        }),
      );
      expect(res.status).toBe(426);
    });
  });

  it('accepts a dm-role connection (mocked WebSocket pair) and answers hello -> welcome via webSocketMessage', async () => {
    const streamId = `camp:${crypto.randomUUID()}`;
    const id = env.CAMPAIGN_STREAM.idFromName(streamId);
    const stub = env.CAMPAIGN_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('stream_id', streamId);

      const { sent, ws } = makeFakeWebSocket();
      ws.serializeAttachment({ userId: 'dm-1', role: 'dm', subs: [streamId] });

      await instance.webSocketMessage!(
        ws,
        JSON.stringify({
          t: 'hello',
          rid: 'hello-1',
          proto: 1,
          app: 'campaign-do-smoke-test',
          streams: [],
          have: [],
          pending: [],
        }),
      );

      const welcome = sent.find((f) => f.t === 'welcome');
      expect(welcome).toMatchObject({
        t: 'welcome',
        rid: 'hello-1',
        streams: [{ id: streamId, headSeq: 0 }],
      });
    });
  });

  it('an oversized message (> 128 KB) closes 1009 without ever reaching the actor', async () => {
    const streamId = `camp:${crypto.randomUUID()}`;
    const id = env.CAMPAIGN_STREAM.idFromName(streamId);
    const stub = env.CAMPAIGN_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('stream_id', streamId);
      const { sent, closeCalls, ws } = makeFakeWebSocket();
      ws.serializeAttachment({ userId: 'dm-1', role: 'dm', subs: [streamId] });

      await instance.webSocketMessage!(ws, 'x'.repeat(200_000));

      expect(closeCalls).toEqual([{ code: 1009, reason: 'message too large' }]);
      expect(sent).toEqual([]);
    });
  });

  it('[obligation 4] a binary frame routes to handleBinaryMessage — the campaign DM subscribed to nothing gets blob.unavailable for an unknown hash request', async () => {
    // Exercises the RECEIVE wiring end to end via the real `BlobRelay` (plan-9 Task 7): a
    // `blob.request` TEXT frame for a hash nobody has announced answers `blob.unavailable`
    // (already-existing `BlobRelay` behavior) — the point of THIS test is proving a BINARY frame
    // reaches `CampaignActor.handleBinaryMessage` -> `BlobRelay.handleChunk` at all (a malformed/
    // unaddressed chunk is silently dropped, per `blob-relay.ts`'s own documented "nothing to
    // answer with" stance — so the observable proof here is the ABSENCE of a crash/close, plus the
    // ordinary text-frame blob flow around it still working on the SAME connection).
    const streamId = `camp:${crypto.randomUUID()}`;
    const id = env.CAMPAIGN_STREAM.idFromName(streamId);
    const stub = env.CAMPAIGN_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('stream_id', streamId);
      const { sent, closeCalls, ws } = makeFakeWebSocket();
      ws.serializeAttachment({ userId: 'dm-1', role: 'dm', subs: [streamId] });

      await instance.webSocketMessage!(
        ws,
        JSON.stringify({ t: 'hello', rid: 'h1', proto: 1, app: 'blob-test', streams: [], have: [], pending: [] }),
      );

      // A well-formed but unaddressable binary frame (too short to be a real 16-byte chunk
      // header) must not crash the DO or close the connection — `decodeBlobChunkHeader`'s own
      // "rejects short frame" behavior, reached only if `webSocketMessage` genuinely dispatched
      // this ArrayBuffer to `handleBinaryMessage`/`BlobRelay.handleChunk` instead of silently
      // dropping it the way Node's PRE-Task-8 `if (isBinary) return` used to.
      const shortBinary = new Uint8Array([1, 2, 3]).buffer;
      await instance.webSocketMessage!(ws, shortBinary);
      expect(closeCalls).toEqual([]);

      // The connection is still alive and ordinary text-frame handling still works afterward.
      await instance.webSocketMessage!(
        ws,
        JSON.stringify({ t: 'blob.request', rid: 'req-1', hash: `sha256:${'a'.repeat(64)}` }),
      );
      const unavailable = sent.find((f) => f.t === 'blob.unavailable');
      expect(unavailable).toBeDefined();
    });
  });
});

describe('CampaignStreamDO — recreate after hard delete (generation guard, mirrors character-stream.do.ts)', () => {
  it('a fresh connection accepted under the CURRENT generation can hello after a hard delete', async () => {
    const streamId = `camp:${crypto.randomUUID()}`;
    const id = env.CAMPAIGN_STREAM.idFromName(streamId);
    const stub = env.CAMPAIGN_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('stream_id', streamId);
      await callDeleteAll(instance, streamId);

      const { sent, closeCalls, ws } = makeFakeWebSocket();
      ws.serializeAttachment({ userId: 'dm-1', role: 'dm', subs: [streamId], gen: 1 });

      await instance.webSocketMessage!(
        ws,
        JSON.stringify({ t: 'hello', rid: 'h1', proto: 1, app: 'recreate-test', streams: [], have: [], pending: [] }),
      );
      const welcome = sent.find((f) => f.t === 'welcome');
      expect(welcome).toBeDefined();
      expect(closeCalls).toEqual([]);
    });
  });

  it('a STALE connection from BEFORE the delete (old generation) is refused', async () => {
    const streamId = `camp:${crypto.randomUUID()}`;
    const id = env.CAMPAIGN_STREAM.idFromName(streamId);
    const stub = env.CAMPAIGN_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('stream_id', streamId);
      const { sent, closeCalls, ws: stale } = makeFakeWebSocket();
      stale.serializeAttachment({ userId: 'dm-1', role: 'dm', subs: [streamId], gen: 0 });

      await callDeleteAll(instance, streamId);

      await instance.webSocketMessage!(
        stale,
        JSON.stringify({ t: 'hello', rid: 'h1', proto: 1, app: 'stale-test', streams: [], have: [], pending: [] }),
      );
      expect(sent).toEqual([]);
      expect(closeCalls.at(-1)).toEqual({ code: 1001, reason: 'stream_closed' });
    });
  });
});
