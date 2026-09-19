/**
 * `CharacterStreamDO` — the DO accepts a WS and answers hello -> welcome (task-8-brief step 1),
 * exercised directly against the DO CLASS via `cloudflare:test`'s `runInDurableObject` rather than
 * a full `SELF.fetch` WS upgrade through the Worker/core routing layer (register -> login ->
 * create-character -> `GET /api/characters/:id/ws`, which `test/adapters/node/server.test.ts`
 * exercises end-to-end for the Node adapter).
 *
 * Why: `@cloudflare/vitest-pool-workers`'s own documented limitation — WebSockets against Durable
 * Objects are not supported under this pool's default PER-TEST-FILE storage isolation (the
 * documented workaround is running the whole suite under `--no-isolate`/single-worker mode, which
 * would weaken isolation for every OTHER test in this directory just to accommodate this one file).
 * Rather than risk a flaky/CI-breaking real end-to-end WS test for the sake of also re-proving the
 * Worker-level routing/auth plumbing that `auth-roundtrip.test.ts` and the Node adapter's own
 * `server.test.ts` already cover, this file calls the DO's `fetch()` (the WS-upgrade entry point,
 * `character-stream.do.ts`) and `webSocketMessage()` (the Hibernation API handler) DIRECTLY —
 * `runInDurableObject` hands back the live DO instance and its `DurableObjectState`, so this is
 * the REAL `CharacterStreamDO` code path (real `DoSqlStreamStore`, real `CharacterActor`, real
 * `HibernatingConnections`), just invoked without going through the Worker's own routing/session
 * layer — task-8-brief's explicitly pre-authorized fallback ("cover the DO's message handling by
 * invoking the DO class directly with a mocked WebSocket pair") for exactly this situation, chosen
 * here deliberately rather than after a flaky run, and documented honestly rather than shipped as
 * a silently-different test than the brief describes.
 *
 * The "mocked WebSocket pair" is a minimal object satisfying the three methods
 * `HibernatingConnections`/`CharacterStreamDO` actually call on it (`serializeAttachment`,
 * `deserializeAttachment`, `send`, `readyState`) — not a real `WebSocketPair` (which needs the
 * Hibernation API's `acceptWebSocket`/`getWebSockets` machinery this test deliberately bypasses).
 */
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@hk/protocol';
import { env } from './typed-env.ts';

const INTERNAL_STREAM_ID_HEADER = 'X-Hk-Internal-Stream-Id';
const INTERNAL_USER_ID_HEADER = 'X-Hk-Internal-User-Id';
const INTERNAL_ROLE_HEADER = 'X-Hk-Internal-Role';

/** A fake `WebSocket` carrying just enough surface for `HibernatingConnections`
 * (`connections.do.ts`) to accept/attach/send against it, and for this test to read back what was
 * sent. Not a real Hibernation-API socket — `acceptWebSocket`/`getWebSockets` are bypassed
 * entirely (this file's header comment explains why). */
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
    send: (data: string) => {
      sent.push(JSON.parse(data) as ServerMessage);
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

describe('CharacterStreamDO — WS message handling (obligations (c) and (d))', () => {
  it('fetch() refuses an internal request missing the trust-boundary headers', async () => {
    const id = env.CHARACTER_STREAM.idFromName(`char:${crypto.randomUUID()}`);
    const stub = env.CHARACTER_STREAM.get(id);

    await runInDurableObject(stub, async (instance) => {
      // Non-null assertion: `DurableObject`'s base class types `fetch` as OPTIONAL (not every DO
      // implements it), but `CharacterStreamDO` always overrides it (`character-stream.do.ts`) —
      // `runInDurableObject`'s inferred `instance` type doesn't narrow that back to required.
      const res = await instance.fetch!(new Request('https://internal.test/', { headers: { Upgrade: 'websocket' } }));
      expect(res.status).toBe(400);
    });
  });

  it('fetch() with the internal headers but no Upgrade header answers 426', async () => {
    const streamId = `char:${crypto.randomUUID()}`;
    const id = env.CHARACTER_STREAM.idFromName(streamId);
    const stub = env.CHARACTER_STREAM.get(id);

    await runInDurableObject(stub, async (instance) => {
      const res = await instance.fetch!(
        new Request('https://internal.test/', {
          headers: {
            [INTERNAL_STREAM_ID_HEADER]: streamId,
            [INTERNAL_USER_ID_HEADER]: 'user-1',
            [INTERNAL_ROLE_HEADER]: 'owner',
          },
        }),
      );
      expect(res.status).toBe(426);
    });
  });

  it('accepts a connection (mocked WebSocket pair) and answers hello -> welcome via webSocketMessage', async () => {
    const streamId = `char:${crypto.randomUUID()}`;
    const id = env.CHARACTER_STREAM.idFromName(streamId);
    const stub = env.CHARACTER_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      // Persist `stream_id` the same way a real `fetch()` upgrade would (character-stream.do.ts's
      // `ensureActor` doc comment) — this test bypasses the real WebSocketPair/hibernation accept
      // dance (this file's header comment) but still needs the DO to know which stream it is.
      await state.storage.put('stream_id', streamId);

      const { sent, ws } = makeFakeWebSocket();
      ws.serializeAttachment({ userId: 'user-1', role: 'owner', subs: [streamId] });

      // Non-null assertion: same rationale as the `fetch!` calls above.
      await instance.webSocketMessage!(
        ws,
        JSON.stringify({
          t: 'hello',
          rid: 'hello-1',
          proto: 1,
          app: 'do-smoke-test',
          streams: [],
          have: [],
          pending: [],
        }),
      );

      expect(sent).toHaveLength(1);
      const welcome = sent[0];
      expect(welcome?.t).toBe('welcome');
      expect(typeof (welcome as { serverTime?: unknown } | undefined)?.serverTime).toBe('string');
      expect(welcome).toMatchObject({
        t: 'welcome',
        rid: 'hello-1',
        streams: [{ id: streamId, headSeq: 0, quota: { bytesUsed: 0, bytesMax: 2 * 1024 * 1024, eventCount: 0 } }],
      });
    });
  });

  it('an oversized message (> 128 KB, whole-branch review finding 1) closes 1009 without ever reaching the actor', async () => {
    const streamId = `char:${crypto.randomUUID()}`;
    const id = env.CHARACTER_STREAM.idFromName(streamId);
    const stub = env.CHARACTER_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('stream_id', streamId);

      const { sent, closeCalls, ws } = makeFakeWebSocket();
      ws.serializeAttachment({ userId: 'user-1', role: 'owner', subs: [streamId] });

      // RED-first against the pre-fix `webSocketMessage`, which parsed unconditionally regardless
      // of size: a 200 KB raw string, well over doc-08's 128 KB cap (`core/validate.ts`'s
      // `WS_MESSAGE_BYTES_MAX`) — not even valid JSON, which must not matter, since the length
      // guard has to run and close the connection BEFORE any `JSON.parse`/actor dispatch at all.
      await instance.webSocketMessage!(ws, 'x'.repeat(200_000));

      expect(closeCalls).toEqual([{ code: 1009, reason: 'message too large' }]);
      // Never reached the actor: no `welcome`/`ack`/`reject`/anything was ever sent.
      expect(sent).toEqual([]);
    });
  });
});
