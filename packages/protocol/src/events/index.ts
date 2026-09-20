import type { ZodType } from 'zod';
import type { PackIssue } from '../pack/pack.ts';
import { CAMPAIGN_EVENT_ACTORS, CAMPAIGN_EVENT_PAYLOADS } from './campaign.ts';
import { EVENT_ACTORS as CHARACTER_EVENT_ACTORS, EVENT_PAYLOADS as CHARACTER_EVENT_PAYLOADS } from './character.ts';
import { type ActorRole, type Event, EventEnvelopeSchema } from './envelope.ts';

export * from './envelope.ts';
export * from './character.ts';
export * from './campaign.ts';

/**
 * The combined event-type→payload-schema / allowed-actors registries across BOTH streams
 * (character + campaign). These two `export const`s deliberately shadow the same-named ones
 * re-exported above via `export * from './character.ts'` — an explicit local export always wins
 * over an ambiguous star-re-export of the same name (ECMAScript module resolution), so
 * `@hk/protocol`'s public `EVENT_PAYLOADS`/`EVENT_ACTORS` (what `parseEvent` below AND apps/api's
 * `permissions.ts` both import) resolve to these MERGED maps, not character.ts's character-only
 * ones. Every consumer that needs "is this type known, and who may author it" needs one flat
 * table covering every stream, not two separate ones to remember to check — a campaign-stream
 * type reaching a character-stream-only lookup (or vice versa) would silently read as
 * "unknown type" instead of the real answer.
 */
export const EVENT_PAYLOADS: Record<string, ZodType> = {
  ...CHARACTER_EVENT_PAYLOADS,
  ...CAMPAIGN_EVENT_PAYLOADS,
};
export const EVENT_ACTORS: Record<string, ActorRole[]> = {
  ...CHARACTER_EVENT_ACTORS,
  ...CAMPAIGN_EVENT_ACTORS,
};

/**
 * Which stream KIND (`char:*` vs `camp:*`, `@hk/protocol`'s `StreamIdSchema` prefixes) an event
 * `type` is registered for — plan-9 Task 2's T2 obligation (b), "stream-prefix ↔ event-family
 * binding check". Derived directly from which registry (`character.ts`'s `EVENT_PAYLOADS` vs
 * `campaign.ts`'s `CAMPAIGN_EVENT_PAYLOADS`) a type's key lives in, so it can never drift from
 * the two source-of-truth catalogs the way a hand-maintained third list could. Keyed by the bare
 * `type` (not `type@v`, matching `EVENT_ACTORS`'s own key shape) — every versioned payload
 * schema for a given type name is registered from the same file, so the kind is stable across
 * versions. Consumed by `apps/api`'s `core/validate.ts`, BEFORE permission evaluation, to reject
 * a campaign-only type appended to a `char:` stream (or vice versa) with code `invalid` — this
 * closes a gap `permissions.ts`'s `allowed()` cannot close on its own, because `EVENT_ACTORS` is
 * the MERGED table above and a type like `roll.logged` (campaign-only) legitimately grants
 * `'member'`, which is meaningless read in isolation on a character stream but not rejected by a
 * role check alone.
 */
export const EVENT_STREAM_KIND: Record<string, 'char' | 'camp'> = {
  ...Object.fromEntries(
    Object.keys(CHARACTER_EVENT_PAYLOADS).map((key) => [key.slice(0, key.lastIndexOf('@')), 'char' as const]),
  ),
  ...Object.fromEntries(
    Object.keys(CAMPAIGN_EVENT_PAYLOADS).map((key) => [key.slice(0, key.lastIndexOf('@')), 'camp' as const]),
  ),
};

export type ParseEventResult = { ok: true; event: Event } | { ok: false; issues: PackIssue[] };

export function parseEvent(input: unknown): ParseEventResult {
  const env = EventEnvelopeSchema.safeParse(input);
  if (!env.success)
    return {
      ok: false,
      issues: env.error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message })),
    };
  const key = `${env.data.type}@${env.data.v}`;
  const payloadSchema = EVENT_PAYLOADS[key];
  if (!payloadSchema) return { ok: false, issues: [{ path: 'type', message: `event.unknownType: ${key}` }] };
  const payload = payloadSchema.safeParse(env.data.payload);
  if (!payload.success)
    return {
      ok: false,
      issues: payload.error.issues.map((i) => ({
        path: i.path.length ? 'payload.' + i.path.map(String).join('.') : 'payload',
        message: i.message,
      })),
    };
  return { ok: true, event: { ...env.data, payload: payload.data } };
}
