import { z } from 'zod';
import { PackSchema } from './pack.ts';

export const PACK_SCHEMA_ID = 'https://herokeep.app/schema/pack-v1.json';

export function toPackJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(PackSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    cycles: 'ref',
    reused: 'ref',
  }) as Record<string, unknown>;
  return { $id: PACK_SCHEMA_ID, ...schema };
}
