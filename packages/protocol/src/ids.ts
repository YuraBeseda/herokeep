import { z } from 'zod';

export const ENTITY_TYPES = [
  'system',
  'species',
  'background',
  'class',
  'subclass',
  'feature',
  'feat',
  'spell',
  'item',
  'condition',
  'skill',
  'ability',
  'language',
  'tool',
  'rule',
  'table',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const ENTITY_ID_RE = /^([a-z0-9][a-z0-9-]{2,63}):([a-z]+)\/([a-z0-9][a-z0-9-]*)$/;

export interface ParsedEntityId {
  packId: string;
  type: EntityType;
  slug: string;
}

const ENTITY_TYPE_SET: ReadonlySet<string> = new Set(ENTITY_TYPES);

export function parseEntityId(id: string): ParsedEntityId | null {
  const m = ENTITY_ID_RE.exec(id);
  if (!m) return null;
  const [, packId, type, slug] = m;
  if (packId === undefined || type === undefined || slug === undefined) return null;
  if (!ENTITY_TYPE_SET.has(type)) return null;
  return { packId, type: type as EntityType, slug };
}

export function isEntityId(id: string): boolean {
  return parseEntityId(id) !== null;
}

export function makeEntityId(packId: string, type: EntityType, slug: string): string {
  return `${packId}:${type}/${slug}`;
}

export const PackIdSchema = z.string().regex(PACK_ID_RE, 'Pack id must match ^[a-z0-9][a-z0-9-]{2,63}$');
export const SlugSchema = z.string().regex(SLUG_RE, 'Slug must match ^[a-z0-9][a-z0-9-]*$');
export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export const EntityIdSchema = z
  .string()
  .refine((s) => parseEntityId(s) !== null, { message: 'Expected an entity id of the form <packId>:<type>/<slug>' });
