import type { PackIssue } from '../pack/pack.ts';
import { EVENT_PAYLOADS } from './character.ts';
import { type Event, EventEnvelopeSchema } from './envelope.ts';

export * from './envelope.ts';
export * from './character.ts';

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
