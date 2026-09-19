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

/** `runInDurableObject`'s inferred `instance` type resolves to the base `DurableObject |
 * Rpc.DurableObject` union (not the real `CharacterStreamDO` class) in this file — existing calls
 * above only ever touch `fetch`/`webSocketMessage` (both exist ON that union, since they're the
 * Hibernation-API surface every `DurableObject` implementor shares), so the gap was never visible
 * until this helper started calling `deleteAll`, a genuinely `CharacterStreamDO`-only RPC method.
 * A single explicit cast at the point of use (same "cast through a small local interface" pattern
 * `rate-limiter-do.test.ts` uses for its own `tsc`-inference gap) rather than fighting the
 * generic. */
function callDeleteAll(instance: unknown, streamId: string): Promise<void> {
  return (instance as { deleteAll(id: string): Promise<void> }).deleteAll(streamId);
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

/** A syntactically-valid `character.created` event — same shape `test/core/stream-actor.test.ts`/
 * `test/core/characters.test.ts` use for the same purpose. */
function characterCreatedEvent(streamId: string): {
  id: string;
  stream: string;
  ts: string;
  actor: { userId: string; deviceId: string; role: 'owner' };
  type: string;
  v: number;
  payload: Record<string, unknown>;
} {
  return {
    id: crypto.randomUUID(),
    stream: streamId,
    ts: new Date().toISOString(),
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'owner' },
    type: 'character.created',
    v: 1,
    payload: {
      name: 'Aria',
      system: 'srd-5e-2024',
      corePack: { id: 'srd-5e-2024', version: '1.0.0' },
      engineVersion: '1.0.0',
      grammaticalGender: 'feminine',
    },
  };
}

/**
 * Whole-branch RE-REVIEW round 2: fix 3 (closing live sockets on hard delete) introduced a NEW
 * defect — `StreamActor.closed` never resets, and the pre-fix `CharacterStreamDO.deleteAll` left
 * `this.actorPromise` memoized to that now-permanently-closed actor forever, so a character
 * recreated with the SAME id (a real `POST /api/characters` succeeds once the D1 row is gone — no
 * more id collision) reached this SAME DO instance (`idFromName(streamId)` is deterministic on the
 * streamId string) and found every append refused `stream_closed`, permanently. Fixed by resetting
 * `actorPromise`/`storeCache` in `deleteAll` (a fresh actor/store on the next access) PLUS a
 * generation guard in `webSocketMessage` (see that method's own doc comment for why the reset
 * alone isn't enough on THIS adapter: it resolves the actor freshly on EVERY message, unlike
 * Node's accept-time-bound closure).
 */
describe('CharacterStreamDO — recreate after hard delete (whole-branch re-review round 2)', () => {
  it('a fresh connection accepted under the CURRENT generation can hello and append after a hard delete', async () => {
    const streamId = `char:${crypto.randomUUID()}`;
    const id = env.CHARACTER_STREAM.idFromName(streamId);
    const stub = env.CHARACTER_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('stream_id', streamId);

      // The hard delete (`DELETE /api/characters/:id`'s real call path: `StreamHost.get(id)
      // .deleteAll()`, which on Cloudflare is exactly this RPC method).
      await callDeleteAll(instance, streamId);

      // RECREATE with the SAME id: a real `POST /api/characters` after the D1 row is gone succeeds
      // (no collision) and a subsequent `GET /:id/ws` upgrade's real `fetch()` would stamp the
      // CURRENT generation (1, after exactly one prior delete) onto the accepted connection's
      // attachment — reproduced by hand here since this file's mocked-pair approach bypasses the
      // real `fetch()`/`WebSocketPair` accept dance (this file's header comment).
      const { sent, closeCalls, ws } = makeFakeWebSocket();
      ws.serializeAttachment({ userId: 'user-1', role: 'owner', subs: [streamId], gen: 1 });

      await instance.webSocketMessage!(
        ws,
        JSON.stringify({ t: 'hello', rid: 'h1', proto: 1, app: 'recreate-test', streams: [], have: [], pending: [] }),
      );
      const welcome = sent.find((f) => f.t === 'welcome');
      // RED-first against the pre-fix code: `welcome` never arrived at all (the connection was
      // closed 1001/stream_closed by the STALE gen-less/pre-fix `closed`-flag check instead).
      expect(welcome).toBeDefined();
      expect(welcome).toMatchObject({ streams: [{ id: streamId, headSeq: 0 }] });

      const event = characterCreatedEvent(streamId);
      await instance.webSocketMessage!(ws, JSON.stringify({ t: 'append', rid: 'a1', events: [event] }));
      const ack = sent.find((f) => f.t === 'ack');
      const reject = sent.find((f) => f.t === 'reject');
      // The critical assertion: a live append on the recreated stream is ACKED, never rejected
      // `stream_closed` — the actual bug this round fixes.
      expect(reject).toBeUndefined();
      expect(ack).toMatchObject({ results: [{ id: event.id, seq: 1 }] });
      expect(closeCalls).toEqual([]);
    });
  });

  it('a STALE connection from BEFORE the delete (old generation) is refused, never resurrecting the stream (finding-3 protection preserved)', async () => {
    const streamId = `char:${crypto.randomUUID()}`;
    const id = env.CHARACTER_STREAM.idFromName(streamId);
    const stub = env.CHARACTER_STREAM.get(id);

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('stream_id', streamId);

      // A connection accepted BEFORE the delete — a real `fetch()` would have stamped generation 0
      // (never deleted yet).
      const { sent, closeCalls, ws: stale } = makeFakeWebSocket();
      stale.serializeAttachment({ userId: 'user-1', role: 'owner', subs: [streamId], gen: 0 });

      await callDeleteAll(instance, streamId); // bumps the generation to 1, resets the actor/store memo

      // The STALE socket (modeling the narrow in-flight-message race `deleteAll`'s doc comment
      // describes — `actor.deleteAll()` already closed it via `Connections.close`, but this models
      // a message that was already past that point) tries to append anyway.
      const event = characterCreatedEvent(streamId);
      await instance.webSocketMessage!(stale, JSON.stringify({ t: 'append', rid: 'a1', events: [event] }));

      // Refused outright — closed again (harmless double-close) — and CRITICALLY never acked/
      // committed: no seq-1 resurrection.
      expect(sent.some((f) => f.t === 'ack')).toBe(false);
      expect(closeCalls.at(-1)).toEqual({ code: 1001, reason: 'stream_closed' });
    });
  });
});
