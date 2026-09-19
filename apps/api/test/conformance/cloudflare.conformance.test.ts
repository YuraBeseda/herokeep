/**
 * Cloudflare conformance runner (task-9-brief): drives every scenario in `./scenarios.ts` through a
 * `ConformanceDriver` backed by `SELF.fetch` (the real Worker, under `@cloudflare/vitest-pool-
 * workers`) for HTTP, and a `runInDurableObject` + mocked-WebSocket-pair `StreamDriver` for the
 * append/hello/catch-up surface — the SAME pre-authorized fallback
 * `test/adapters/cloudflare/character-stream-do.test.ts` uses and documents in full: this pool
 * cannot complete a real WebSocket upgrade against a Durable Object under its default per-test
 * storage isolation, so this file calls `CharacterStreamDO.webSocketMessage()` directly against a
 * mocked pair rather than going through a real `fetch()` WS upgrade (see that file's header comment
 * for the complete rationale). Every assertion lives in `scenarios.ts` — this file is driver wiring
 * ONLY (task-9-brief: "runners contain ZERO assertions").
 *
 * `CharacterStreamDO.webSocketMessage`/`ensureActor()` fall back to a PERSISTED `stream_id`
 * (`character-stream.do.ts`'s own doc comment: this is how it recovers its identity after a real
 * hibernation wake-up, which carries no accompanying `fetch()` to re-supply one) — this file relies
 * on exactly that fallback: `openStream` persists `stream_id` once via `state.storage.put(...)`
 * before any `webSocketMessage` call, then every subsequent `send()` opens its OWN short-lived
 * `runInDurableObject` call (rather than holding one open for the whole scenario) — safe specifically
 * BECAUSE the actor already tolerates being freshly reconstructed per call, the same tolerance
 * production hibernation demands of it.
 */
import { runInDurableObject, SELF } from 'cloudflare:test';
import { describe, it } from 'vitest';
import type { ClientMessage, ServerMessage } from '@hk/protocol';
import type { Env } from '../../src/adapters/cloudflare/env.ts';
import type { ConnAttachment } from '../../src/core/streams/stream-actor.ts';
import { env } from '../adapters/cloudflare/typed-env.ts';
import { FrameBuffer } from './frame-buffer.ts';
import { scenarios, type ConformanceDriver, type Session, type StreamDriver } from './scenarios.ts';

const BASE_URL = 'https://herokeep.test';

type CharacterStreamStub = ReturnType<Env['CHARACTER_STREAM']['get']>;

/** A minimal fake `WebSocket` — the same shape `character-stream-do.test.ts`'s own
 * `makeFakeWebSocket` uses (see that file's header comment for the full rationale), except `send`
 * pushes into a shared `FrameBuffer` instead of a plain array, so `StreamDriver.collect`'s stop-
 * condition/timeout contract (`frame-buffer.ts`) behaves identically to the Node runner's real
 * socket. Reused as ONE object across every separate `runInDurableObject` call this driver makes
 * (see this file's header comment on why separate calls are safe) — its `attachment` closure is
 * OUR test's own state, entirely independent of whichever DO instance a given call happens to run
 * against. */
function makeFakeWebSocket(buffer: FrameBuffer<ServerMessage>): {
  ws: WebSocket;
  setAttachment: (value: unknown) => void;
} {
  let attachment: unknown = null;
  const ws = {
    readyState: 1,
    send: (data: string) => buffer.push(JSON.parse(data) as ServerMessage),
    close: () => undefined,
    serializeAttachment: (value: unknown) => {
      attachment = value;
    },
    deserializeAttachment: () => attachment,
  };
  return { ws: ws as unknown as WebSocket, setAttachment: ws.serializeAttachment };
}

class CloudflareStreamDriver implements StreamDriver {
  private readonly buffer: FrameBuffer<ServerMessage>;
  private readonly fakeWs: WebSocket;
  private readonly stub: CharacterStreamStub;

  constructor(stub: CharacterStreamStub, attachment: ConnAttachment) {
    this.stub = stub;
    this.buffer = new FrameBuffer<ServerMessage>();
    const fake = makeFakeWebSocket(this.buffer);
    this.fakeWs = fake.ws;
    fake.setAttachment(attachment);
  }

  async send(msg: ClientMessage): Promise<void> {
    const ws = this.fakeWs;
    await runInDurableObject(this.stub, async (instance) => {
      // Non-null assertion: `DurableObject`'s base class types `webSocketMessage` as OPTIONAL, but
      // `CharacterStreamDO` always overrides it (same rationale as `character-stream-do.test.ts`'s
      // own `instance.fetch!`/`instance.webSocketMessage!` calls).
      await instance.webSocketMessage!(ws, JSON.stringify(msg));
    });
  }

  collect(stop: (frames: readonly ServerMessage[]) => boolean, timeoutMs?: number): Promise<readonly ServerMessage[]> {
    return this.buffer.collect(stop, timeoutMs);
  }

  close(): void {
    // No real socket exists under the mocked-pair fallback (this file's header comment) — nothing
    // to close.
  }
}

function makeDriver(): ConformanceDriver {
  return {
    fetch(path, init) {
      return SELF.fetch(new URL(path, BASE_URL).toString(), init);
    },
    async openStream({ streamId, session }: { streamId: string; session: Session }) {
      const id = env.CHARACTER_STREAM.idFromName(streamId);
      const stub = env.CHARACTER_STREAM.get(id);
      // Persist `stream_id` the same way a real `fetch()` upgrade would (`character-stream.do.ts`'s
      // `ensureActor` doc comment) — this driver bypasses the real WebSocketPair/hibernation accept
      // dance entirely (this file's header comment) but the DO still needs to know which stream it
      // is once a bare `webSocketMessage()` call (no hint) reaches it.
      await runInDurableObject(stub, async (_instance, state) => {
        await state.storage.put('stream_id', streamId);
      });
      // Stamped with the SAME `{userId, role: 'owner'}` a real WS upgrade would have resolved from
      // this exact session (see `Session`'s doc comment in `scenarios.ts` for the documented
      // limitation this sidesteps: no real ownership re-check happens at THIS call).
      const attachment: ConnAttachment = { userId: session.userId, role: 'owner', subs: [streamId] };
      return new CloudflareStreamDriver(stub, attachment);
    },
  };
}

describe('cross-adapter conformance — Cloudflare', () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      await scenario.run(makeDriver());
    });
  }
});
