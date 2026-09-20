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
/** [plan-9 Task 10] The campaign half of `CharacterStreamStub` — `CampaignStreamDO` overrides
 * `webSocketMessage` with the IDENTICAL signature `CharacterStreamDO` does (both extend
 * `DurableObject<Env>`; verified directly against `campaign-stream.do.ts`), so `CloudflareStreamDriver`
 * below treats the two interchangeably at the one call site that matters (`webSocketMessage`) — the
 * `as CharacterStreamStub` cast at each `runInDurableObject` call is therefore a compile-time-only
 * lie (matches this SAME suite's existing casting convention, e.g. `campaign-stream-do.test.ts`'s
 * `callAppend(instance: unknown, ...)`), never a runtime one. */
type CampaignStreamStub = ReturnType<Env['CAMPAIGN_STREAM']['get']>;

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
  private readonly stub: CharacterStreamStub | CampaignStreamStub;

  constructor(stub: CharacterStreamStub | CampaignStreamStub, attachment: ConnAttachment) {
    this.stub = stub;
    this.buffer = new FrameBuffer<ServerMessage>();
    const fake = makeFakeWebSocket(this.buffer);
    this.fakeWs = fake.ws;
    fake.setAttachment(attachment);
  }

  async send(msg: ClientMessage): Promise<void> {
    const ws = this.fakeWs;
    // [plan-9 Task 10] `as CharacterStreamStub` — see this file's `CampaignStreamStub` doc comment:
    // a compile-time-only cast, `webSocketMessage`'s real runtime shape is identical whichever DO
    // class `this.stub` actually points at.
    await runInDurableObject(this.stub as CharacterStreamStub, async (instance) => {
      // Non-null assertion: `DurableObject`'s base class types `webSocketMessage` as OPTIONAL, but
      // both `CharacterStreamDO`/`CampaignStreamDO` always override it (same rationale as
      // `character-stream-do.test.ts`'s own `instance.fetch!`/`instance.webSocketMessage!` calls).
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
    // [plan-9 Task 10] Branches on the stream-id prefix — the campaign half of the SAME `camp:`/
    // `char:` routing `CloudflareStreamHost.get`/`streamNamespaceFor` do in the real Worker
    // (`adapters/cloudflare/worker.ts`), except this driver picks the DO namespace directly rather
    // than going through that real routing helper — the same pre-existing, documented bypass this
    // file's header comment already describes for `char:` (no real `fetch()` upgrade at all).
    async openStream({
      streamId,
      session,
      role,
    }: {
      streamId: string;
      session: Session;
      role?: 'owner' | 'dm' | 'member';
    }) {
      const isCampaign = streamId.startsWith('camp:');
      const stub: CharacterStreamStub | CampaignStreamStub = isCampaign
        ? env.CAMPAIGN_STREAM.get(env.CAMPAIGN_STREAM.idFromName(streamId))
        : env.CHARACTER_STREAM.get(env.CHARACTER_STREAM.idFromName(streamId));
      // Persist `stream_id` the same way a real `fetch()` upgrade would (`character-stream.do.ts`'s/
      // `campaign-stream.do.ts`'s own `ensureActor` doc comment) — this driver bypasses the real
      // WebSocketPair/hibernation accept dance entirely (this file's header comment) but the DO
      // still needs to know which stream it is once a bare `webSocketMessage()` call (no hint)
      // reaches it.
      await runInDurableObject(stub as CharacterStreamStub, async (_instance, state) => {
        await state.storage.put('stream_id', streamId);
      });
      // `char:` keeps the pre-plan-9 default (`role: 'owner'`, no real ownership re-check at this
      // call — `Session`'s doc comment in `scenarios.ts`). `camp:` has NO real WS-upgrade route to
      // resolve `dm`/`member` FROM under this fallback (unlike Node, whose `openStream` drives the
      // REAL `GET /api/campaigns/:id/ws` route) — a campaign scenario MUST pass the role its own
      // HTTP setup actually established (`OpenStreamArgs.role`'s doc comment in `scenarios.ts`).
      const resolvedRole = role ?? (isCampaign ? 'member' : 'owner');
      const attachment: ConnAttachment = { userId: session.userId, role: resolvedRole, subs: [streamId] };
      return new CloudflareStreamDriver(stub, attachment);
    },
  };
}

describe('cross-adapter conformance — Cloudflare', () => {
  for (const scenario of scenarios) {
    // [plan-9 Task 10] `Scenario.adapters` — see `scenarios.ts`'s header comment for exactly why a
    // campaign scenario is restricted to Node only (a documented harness limitation: this runner's
    // mocked WS pair is never registered through the real `ctx.acceptWebSocket()`/tag mechanism, so
    // a scenario needing the actor to push to a DIFFERENT connection than the one that triggered it
    // — live presence, bye — is unobservable here). This is an explicit, named skip, never a
    // silently-failing assertion — the STOP rule is about a REAL cross-adapter divergence (the same
    // scenario producing different OBSERVED outcomes on both), not a harness capability gap that is
    // documented up front and never run at all on the adapter that cannot express it.
    const runsHere = scenario.adapters === undefined || scenario.adapters.includes('cloudflare');
    (runsHere ? it : it.skip)(scenario.name, async () => {
      await scenario.run(makeDriver());
    });
  }
});
