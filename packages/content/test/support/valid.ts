import { EntitySchema } from '@hk/protocol';
import { expect } from 'vitest';

/** Asserts every entity validates against `EntitySchema`, reporting the first issue by id. */
export function expectAllValid(entities: { id: string }[]): void {
  for (const e of entities) {
    const r = EntitySchema.safeParse(e);
    expect(r.success, e.id + ': ' + JSON.stringify(r.success ? '' : r.error.issues[0])).toBe(true);
  }
}
