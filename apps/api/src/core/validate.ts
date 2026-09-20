/**
 * Event validation glue used by `StreamActor`'s append pipeline (doc-10 §StreamActor: "validate
 * each event (schema by `(type, v)`, size)"). Schema validation is `@hk/protocol`'s `parseEvent`
 * (Task 1); this module adds the 16 KB per-event size cap (doc-08 §Quotas "Event payload" row,
 * enforced by the DO with reject code `invalid`) on top of it, as ONE combined check so
 * `StreamActor` has a single call for "is this event well-formed and small enough to store".
 * Permission (`permissions.allowed`) and dedupe (`StreamStore.findByIds`) checks need `actor`/
 * store state this module doesn't have, so they stay in `stream-actor.ts` — doc-10's pipeline
 * order is parse → size → permission → dedupe, and this file only ever covers the first two.
 */
import { EVENT_STREAM_KIND, type Event, parseEvent } from '@hk/protocol';

/** doc-08 §Quotas "Event payload" row: 16 KB per event. */
export const EVENT_BYTES_MAX = 16 * 1024;

/**
 * doc-08 §Quotas "WS message" row: 128 KB per WS FRAME (distinct from `EVENT_BYTES_MAX` above,
 * which caps one event's own size — an `append`/`hello.pending` frame can batch up to 50 events,
 * so this cap exists independently to bound the whole message, not just each event inside it).
 * Whole-branch review finding 1: this constant lives in core (not duplicated per adapter) so both
 * adapters enforce the SAME number — Node's `adapters/node/server.ts` passes it as `ws`'s own
 * `maxPayload` option (that library close(1009)s a connection sending an oversized frame itself);
 * Cloudflare's `adapters/cloudflare/character-stream.do.ts` measures the decoded message's byte
 * length in `webSocketMessage` and closes 1009 before ever parsing it, since the Hibernation API
 * has no `maxPayload`-equivalent option of its own to enforce this at the transport layer.
 */
export const WS_MESSAGE_BYTES_MAX = 128 * 1024;

/**
 * Measures an event's serialized size the same way it is actually stored and transmitted: the
 * UTF-8 byte length of `JSON.stringify(event)`. This is the canonical measurement rule for the
 * 16 KB cap. doc-08 doesn't specify how "16 KB" is measured, so the rule here is: measure the
 * thing that is actually persisted and put on the wire (one JSON-encoded event, matching a row
 * in the doc-02 `events` table and the payload of one entry in an `events`/`append` frame's
 * array) — NOT the in-memory JS object (meaningless size, engine-dependent), and NOT the whole
 * WS message/frame (which may batch up to 50 events under one `append` and is covered
 * separately by doc-08's 128 KB "WS message" cap, not this per-event one).
 */
export function measureEventBytes(event: Event): number {
  return new TextEncoder().encode(JSON.stringify(event)).length;
}

export type ValidateEventResult =
  { readonly ok: true; readonly event: Event } | { readonly ok: false; readonly message: string };

/**
 * Full per-event structural validation: `@hk/protocol`'s `parseEvent` (envelope shape + the
 * type-specific payload schema keyed by `(type, v)`), then the 16 KB size cap, then the
 * stream-binding guard below. All three failure modes map to reject code `invalid` at the call
 * site (`stream-actor.ts`) — this module doesn't know about `RejectCode` (that's a sync-protocol
 * concept; keeping it out here means this file has no reason to import `@hk/protocol`'s sync
 * module at all, only the event one).
 *
 * `streamId` is the actor's OWN stream (`StreamActor.streamId`, `char:<uuid>` / `camp:<uuid>`) —
 * not read from the event's own `stream` field, which is untrusted/redundant client input the
 * caller already scopes the whole append call to.
 *
 * Stream-binding guard (plan-9 Task 2, T2 obligation (b) — "stream-prefix ↔ event-family binding
 * check", doc-02's two disjoint catalogs, "Event catalog — character stream" vs "Event catalog —
 * campaign stream", read together with doc-03 §Gateway: forwarded character events travel over a
 * campaign SOCKET but land on a CHARACTER stream via `Rpc`, not the other way around — nothing in
 * doc-02/doc-03 describes a campaign-only type ever being valid on a `char:` stream or vice
 * versa): `@hk/protocol`'s `EVENT_STREAM_KIND` maps every registered type to the one stream kind
 * it was cataloged for. Checked here — BEFORE `stream-actor.ts`'s `permissions.allowed` call —
 * because `permissions.ts`'s role check alone cannot catch this: `EVENT_ACTORS` (what `allowed`
 * consults) is the MERGED character+campaign table, so a campaign-only type like `roll.logged`
 * has a real, non-empty actor list (`['dm','member']`) that a role check would happily pass for a
 * `dm` actor even on a `char:` stream. An event whose type isn't in `EVENT_STREAM_KIND` at all
 * cannot reach this branch — `parseEvent` above already rejected it as `event.unknownType`.
 */
export function validateEvent(input: unknown, streamId: string): ValidateEventResult {
  const parsed = parseEvent(input);
  if (!parsed.ok) {
    const detail = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    return { ok: false, message: `event.invalid: ${detail}` };
  }
  const bytes = measureEventBytes(parsed.event);
  if (bytes > EVENT_BYTES_MAX) {
    return { ok: false, message: `event.tooLarge: ${bytes} bytes exceeds the ${EVENT_BYTES_MAX}-byte cap` };
  }
  const streamKind = streamId.startsWith('camp:') ? 'camp' : 'char';
  const expectedKind = EVENT_STREAM_KIND[parsed.event.type];
  if (expectedKind !== undefined && expectedKind !== streamKind) {
    return {
      ok: false,
      message: `event.invalid: type ${parsed.event.type} is registered for ${expectedKind}: streams, not ${streamKind}: streams`,
    };
  }
  return { ok: true, event: parsed.event };
}
