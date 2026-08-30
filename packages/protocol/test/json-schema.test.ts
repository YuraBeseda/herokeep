import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toPackJsonSchema } from '../src/pack/json-schema.ts';

describe('pack JSON Schema', () => {
  it('is a draft 2020-12 schema with an $id and object root', () => {
    const s = toPackJsonSchema() as { $schema?: string; $id?: string; type?: string };
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(s.$id).toBe('https://herokeep.app/schema/pack-v1.json');
    expect(s.type).toBe('object');
  });

  it('matches the committed schema/pack-v1.json (run `pnpm --filter @hk/protocol build:schema` after schema changes)', () => {
    const committed = JSON.parse(readFileSync(new URL('../schema/pack-v1.json', import.meta.url), 'utf8')) as unknown;
    expect(committed).toEqual(toPackJsonSchema());
  });
});
