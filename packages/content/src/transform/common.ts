import type { FixtureRecord } from '../upstream.ts';

export const SOURCE = { book: 'SRD 5.2.1' };

interface BaseEntityFields {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  source: { book: string };
  prerequisites: [];
  effects: [];
  grants: [];
  choices: [];
}

/**
 * The six base fields every glossary entity shares: `description` is the trimmed `desc`,
 * omitted entirely when empty (the schema requires a non-empty string when present).
 */
export function baseEntity(id: string, name: string, desc: string | undefined, tags: string[] = []): BaseEntityFields {
  const description = desc?.trim();
  return {
    id,
    name,
    ...(description ? { description } : {}),
    tags,
    source: SOURCE,
    prerequisites: [],
    effects: [],
    grants: [],
    choices: [],
  };
}

/** All vendored open5e fixtures use string pks; this narrows the shared `string | number` pk type. */
export function pkStr(pk: FixtureRecord['pk']): string {
  if (typeof pk !== 'string') {
    throw new Error(`fixture: expected a string pk, got ${typeof pk} (${String(pk)})`);
  }
  return pk;
}

export function fieldStr(fields: Record<string, unknown>, key: string, pk: FixtureRecord['pk']): string {
  const value = fields[key];
  if (typeof value !== 'string') {
    throw new Error(`fixture: "${String(pk)}" is missing a string field "${key}"`);
  }
  return value;
}

export function fieldNum(fields: Record<string, unknown>, key: string, pk: FixtureRecord['pk']): number {
  const value = fields[key];
  if (typeof value !== 'number') {
    throw new Error(`fixture: "${String(pk)}" is missing a numeric field "${key}"`);
  }
  return value;
}

export function fieldBool(fields: Record<string, unknown>, key: string, pk: FixtureRecord['pk']): boolean {
  const value = fields[key];
  if (typeof value !== 'boolean') {
    throw new Error(`fixture: "${String(pk)}" is missing a boolean field "${key}"`);
  }
  return value;
}

export function fieldStrArray(fields: Record<string, unknown>, key: string, pk: FixtureRecord['pk']): string[] {
  const value = fields[key];
  if (!Array.isArray(value)) {
    throw new Error(`fixture: "${String(pk)}" is missing an array field "${key}"`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`fixture: "${String(pk)}" has a non-string entry in "${key}"`);
    }
    return entry;
  });
}

/** `null` becomes `undefined`; a present string is trimmed and blank strings become `undefined`. */
export function fieldOptionalStr(
  fields: Record<string, unknown>,
  key: string,
  pk: FixtureRecord['pk'],
): string | undefined {
  const value = fields[key];
  if (value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`fixture: "${String(pk)}" has a non-string, non-null field "${key}"`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
