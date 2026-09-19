import type { PackIssue } from '../pack/pack.ts';
import { type ClientMessage, ClientMessageSchema, type ServerMessage, ServerMessageSchema } from './messages.ts';

export * from './messages.ts';

export type ParseClientMessageResult = { ok: true; message: ClientMessage } | { ok: false; issues: PackIssue[] };

function toIssues(issues: { path: PropertyKey[]; message: string }[]): PackIssue[] {
  return issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message }));
}

export function parseClientMessage(input: unknown): ParseClientMessageResult {
  const r = ClientMessageSchema.safeParse(input);
  if (!r.success) return { ok: false, issues: toIssues(r.error.issues) };
  return { ok: true, message: r.data };
}

export type ParseServerMessageResult = { ok: true; message: ServerMessage } | { ok: false; issues: PackIssue[] };

export function parseServerMessage(input: unknown): ParseServerMessageResult {
  const r = ServerMessageSchema.safeParse(input);
  if (!r.success) return { ok: false, issues: toIssues(r.error.issues) };
  return { ok: true, message: r.data };
}
