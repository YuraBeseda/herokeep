import type { OverrideOp } from '@hk/protocol';

export function parsePointer(path: string): string[] {
  if (path === '') return [];
  return path
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

type Json = Record<string, unknown> | unknown[];
type PatchResult<T> = { ok: true; result: T } | { ok: false; error: string; opIndex: number };

function isContainer(v: unknown): v is Json {
  return typeof v === 'object' && v !== null;
}

function walk(root: unknown, segments: string[]): { parent: Json; key: string } | string {
  let cur: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    if (!isContainer(cur)) return `Path segment "${segments[i]}" has no container parent`;
    if (Array.isArray(cur)) {
      cur = cur[Number(segments[i])];
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      cur = (cur as Record<string, unknown>)[segments[i]!];
    }
  }
  if (!isContainer(cur)) return 'Parent is not an object or array';
  return { parent: cur, key: segments[segments.length - 1]! };
}

export function applyPatch<T>(doc: T, ops: OverrideOp[]): PatchResult<T> {
  const result = structuredClone(doc);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const segments = parsePointer(op.path);
    if (segments.length === 0) return { ok: false, error: 'Root replacement is not allowed', opIndex: i };
    const w = walk(result, segments);
    if (typeof w === 'string') return { ok: false, error: w, opIndex: i };
    const { parent, key } = w;
    if (Array.isArray(parent)) {
      const idx = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(idx) || idx < 0) return { ok: false, error: `Bad array index "${key}"`, opIndex: i };
      if (op.op === 'add') {
        if (idx > parent.length) return { ok: false, error: 'Array index out of range', opIndex: i };
        parent.splice(idx, 0, structuredClone(op.value));
      } else {
        if (idx >= parent.length) return { ok: false, error: 'Array index out of range', opIndex: i };
        if (op.op === 'replace') parent[idx] = structuredClone(op.value);
        else parent.splice(idx, 1);
      }
    } else {
      const exists = Object.prototype.hasOwnProperty.call(parent, key);
      if (op.op === 'add') parent[key] = structuredClone(op.value);
      else if (!exists) return { ok: false, error: `Key "${key}" does not exist`, opIndex: i };
      else if (op.op === 'replace') parent[key] = structuredClone(op.value);
      else delete parent[key];
    }
  }
  return { ok: true, result };
}
