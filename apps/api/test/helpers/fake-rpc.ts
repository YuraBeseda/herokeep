/**
 * A REAL in-process `Rpc` test double (plan-9 task-6-brief: "a REAL in-process Rpc test double
 * implementing the extended port", read together with the brief's "two-actor harness" instruction)
 * — not a mock that records calls and returns canned data. It holds a registry of live stream
 * TARGETS (an actor's own `append`/`handleNotify` surface, plus the `FakeStreamStore` behind it for
 * reads) and genuinely calls through to them, mirroring what the Node adapter's real `Rpc`
 * implementation (plan-9 Task 8) will do via `StreamHost`. This is what lets a test wire a real
 * `CampaignActor` and a real `CharacterActor` TOGETHER and observe genuinely end-to-end behavior —
 * a forwarded append really commits on the target's own store and re-checks its own permissions; a
 * mirror-verify really reads the target's own committed events — instead of asserting against a
 * hand-stubbed response that could silently drift from what the real actors actually do.
 */
import type { Actor, Event } from '@hk/protocol';
import type { Rpc, RpcAppendOutcome, RpcEventMatch } from '../../src/ports/infra.ts';

/** One stream this double can route calls to — `append`/`read` are the SAME shapes
 * `CampaignActor.append`/`FakeStreamStore.read` already expose, so `registerActor` below is a
 * near-zero-adaptation wrapper, not a parallel reimplementation. */
export interface RpcTarget {
  append(events: Event[], actor: Actor): Promise<RpcAppendOutcome>;
  read(fromSeq: number, limit: number): Promise<Event[]>;
  /** Only a `CampaignActor` target ever receives this in this plan (nothing forwards TO a
   * character stream's notify — only character-originated commits notify a CAMPAIGN stream) —
   * optional so a `char:` target registered via `registerActor` doesn't need to supply one. */
  handleNotify?(fromStream: string, events: Event[]): Promise<void>;
}

export class FakeRpc implements Rpc {
  private readonly targets = new Map<string, RpcTarget>();

  /** Registers `streamId`'s live target. Call this with the SAME `CampaignActor`/`CharacterActor`
   * instance (and its backing `FakeStreamStore`) a test also drives directly, so calls this double
   * routes and calls the test makes directly against that actor observe the SAME underlying state. */
  register(streamId: string, target: RpcTarget): void {
    this.targets.set(streamId, target);
  }

  /** Test-only inspection: every `notify` call this double has routed, in call order — lets a
   * test assert a `CharacterActor`'s after-commit hook targeted the right stream with the right
   * events without needing the receiving `CampaignActor`'s own fan-out to be the only observable. */
  readonly notifyCalls: { readonly toStream: string; readonly fromStream: string; readonly events: Event[] }[] = [];

  async notify(toStream: string, fromStream: string, events: Event[]): Promise<void> {
    this.notifyCalls.push({ toStream, fromStream, events });
    const target = this.targets.get(toStream);
    // No live target registered (the adapter isn't wired for this stream, or it's a stream this
    // test never registered) — a real adapter's equivalent case is "no DO instance to deliver to
    // right now"; silently dropping (not throwing) matches `ports/stream.ts`'s own `notify` doc
    // comment, which describes this as a best-effort fan-out, not a guaranteed-delivery call.
    if (!target?.handleNotify) return;
    await target.handleNotify(fromStream, events);
  }

  async forwardAppend(toStream: string, events: Event[], actor: Actor): Promise<RpcAppendOutcome> {
    const target = this.targets.get(toStream);
    if (!target) {
      return {
        acked: [],
        rejected: events.map((event) => ({
          id: event.id,
          code: 'invalid',
          message: `rpc.unknownStream: no target registered for ${toStream}`,
        })),
      };
    }
    return target.append(events, actor);
  }

  async hasEvent(stream: string, match: RpcEventMatch): Promise<boolean> {
    const target = this.targets.get(stream);
    if (!target) return false;
    const events = await target.read(1, Number.MAX_SAFE_INTEGER);
    return events.some(
      (event) =>
        event.type === match.type &&
        (event.payload as { campaignId?: unknown } | undefined)?.campaignId === match.campaignId,
    );
  }

  async readStream(stream: string, fromSeq: number, limit: number): Promise<Event[]> {
    const target = this.targets.get(stream);
    if (!target) return [];
    return target.read(fromSeq, limit);
  }
}

/** Wraps a real actor + its backing `FakeStreamStore` (or any store implementing just `read`) as
 * an `RpcTarget` — the common case `FakeRpc.register` is built for. */
export function actorTarget(
  actor: { append(events: Event[], actorArg: Actor): Promise<RpcAppendOutcome> },
  store: { read(fromSeq: number, limit: number): Promise<Event[]> },
  handleNotify?: (fromStream: string, events: Event[]) => Promise<void>,
): RpcTarget {
  return {
    append: (events, actorArg) => actor.append(events, actorArg),
    read: (fromSeq, limit) => store.read(fromSeq, limit),
    handleNotify,
  };
}
