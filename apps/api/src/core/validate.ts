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
import { type Event, parseEvent } from '@hk/protocol';

/** doc-08 §Quotas "Event payload" row: 16 KB per event. */
export const EVENT_BYTES_MAX = 16 * 1024;

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
 * type-specific payload schema keyed by `(type, v)`), then the 16 KB size cap. Both failure
 * modes map to reject code `invalid` at the call site (`stream-actor.ts`) — this module doesn't
 * know about `RejectCode` (that's a sync-protocol concept; keeping it out here means this file
 * has no reason to import `@hk/protocol`'s sync module at all, only the event one).
 */
export function validateEvent(input: unknown): ValidateEventResult {
  const parsed = parseEvent(input);
  if (!parsed.ok) {
    const detail = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    return { ok: false, message: `event.invalid: ${detail}` };
  }
  const bytes = measureEventBytes(parsed.event);
  if (bytes > EVENT_BYTES_MAX) {
    return { ok: false, message: `event.tooLarge: ${bytes} bytes exceeds the ${EVENT_BYTES_MAX}-byte cap` };
  }
  return { ok: true, event: parsed.event };
}
