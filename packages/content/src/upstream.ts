import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLUG_RE } from '@hk/protocol';

export interface FixtureRecord {
  model: string;
  pk: string | number;
  fields: Record<string, unknown>;
}

const UPSTREAM_DIR = fileURLToPath(new URL('../upstream/open5e-srd-2024', import.meta.url));
const PK_PREFIX = 'srd-2024_';

const cache = new Map<string, FixtureRecord[]>();

/** Reads and caches a vendored open5e fixture file by its upstream model name (e.g. "Spell"). */
export function readFixture(name: string): FixtureRecord[] {
  const cached = cache.get(name);
  if (cached) return cached;
  const path = join(UPSTREAM_DIR, `${name}.json`);
  const records = JSON.parse(readFileSync(path, 'utf8')) as FixtureRecord[];
  cache.set(name, records);
  return records;
}

/** Strips the `srd-2024_` prefix from an upstream pk and normalizes it to the pack slug charset. */
export function pkSlug(pk: string): string {
  const stripped = pk.startsWith(PK_PREFIX) ? pk.slice(PK_PREFIX.length) : pk;
  const slug = stripped.toLowerCase().replace(/_/g, '-');
  if (!SLUG_RE.test(slug)) {
    throw new Error(`pkSlug: "${pk}" does not normalize to a valid slug (got "${slug}")`);
  }
  return slug;
}
