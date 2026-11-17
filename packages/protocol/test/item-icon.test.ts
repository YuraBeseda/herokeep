import { describe, expect, it } from 'vitest';
import { ItemIconRefSchema } from '../src/index.ts';

const hash = `sha256:${'a'.repeat(64)}`;

describe('ItemIconRefSchema', () => {
  it('accepts a game-icons id and a blob hash', () => {
    expect(ItemIconRefSchema.safeParse({ kind: 'gi', id: 'rope-coil' }).success).toBe(true);
    expect(ItemIconRefSchema.safeParse({ kind: 'blob', hash }).success).toBe(true);
  });

  it('rejects a bad id, a bad hash, an unknown kind and extra keys', () => {
    expect(ItemIconRefSchema.safeParse({ kind: 'gi', id: 'Rope Coil' }).success).toBe(false);
    expect(ItemIconRefSchema.safeParse({ kind: 'gi', id: 'gi:rope' }).success).toBe(false);
    expect(ItemIconRefSchema.safeParse({ kind: 'blob', hash: 'sha256:abc' }).success).toBe(false);
    expect(ItemIconRefSchema.safeParse({ kind: 'url', id: 'x' }).success).toBe(false);
    expect(ItemIconRefSchema.safeParse({ kind: 'gi', id: 'rope', extra: 1 }).success).toBe(false);
  });
});
