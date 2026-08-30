import { existsSync } from 'node:fs';
import { type Entity, type Pack, formatIssues, parsePack } from '@hk/protocol';
import { canonicalJson } from '../canonical.ts';
import { readPackFile } from '../io.ts';
import type { CommandResult } from '../result.ts';

export interface PackDiff {
  version: [string, string];
  added: string[];
  removed: string[];
  changed: { id: string; fields: string[] }[];
  dependencies: { added: string[]; removed: string[]; changed: string[] };
}

function changedFields(a: Entity, b: Entity): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => canonicalJson((a as Record<string, unknown>)[k]) !== canonicalJson((b as Record<string, unknown>)[k])).sort();
}

export function diffPacks(a: Pack, b: Pack): PackDiff {
  const ea = new Map(a.entities.map((e) => [e.id, e]));
  const eb = new Map(b.entities.map((e) => [e.id, e]));
  const added = [...eb.keys()].filter((id) => !ea.has(id)).sort();
  const removed = [...ea.keys()].filter((id) => !eb.has(id)).sort();
  const changed = [...ea.keys()]
    .filter((id) => eb.has(id))
    .map((id) => ({ id, fields: changedFields(ea.get(id)!, eb.get(id)!) }))
    .filter((c) => c.fields.length > 0)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  const da = new Map(a.dependencies.map((d) => [d.id, d.range]));
  const db = new Map(b.dependencies.map((d) => [d.id, d.range]));
  return {
    version: [a.version, b.version],
    added,
    removed,
    changed,
    dependencies: {
      added: [...db.keys()].filter((id) => !da.has(id)).map((id) => `${id} ${db.get(id)}`),
      removed: [...da.keys()].filter((id) => !db.has(id)).map((id) => `${id} ${da.get(id)}`),
      changed: [...da.keys()].filter((id) => db.has(id) && db.get(id) !== da.get(id)).map((id) => `${id} ${da.get(id)} → ${db.get(id)}`),
    },
  };
}

export function runDiff(opts: { a: string; b: string }): CommandResult {
  const load = (p: string): Pack | string => {
    if (!existsSync(p)) return `file not found: ${p}`;
    const r = parsePack(readPackFile(p));
    return r.ok ? r.pack : `${p}: ${formatIssues(r.issues)[0]}`;
  };
  const a = load(opts.a);
  const b = load(opts.b);
  if (typeof a === 'string' || typeof b === 'string') return { exitCode: 2, lines: [typeof a === 'string' ? a : (b as string)] };
  const d = diffPacks(a, b);
  const lines = [
    `${a.id}: version: ${d.version[0]} → ${d.version[1]}`,
    ...d.dependencies.added.map((x) => `dependency added: ${x}`),
    ...d.dependencies.removed.map((x) => `dependency removed: ${x}`),
    ...d.dependencies.changed.map((x) => `dependency changed: ${x}`),
    ...d.added.map((id) => `+ ${id}`),
    ...d.removed.map((id) => `- ${id}`),
    ...d.changed.map((c) => `~ ${c.id} (${c.fields.join(', ')})`),
    `${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed`,
  ];
  return { exitCode: 0, lines };
}
