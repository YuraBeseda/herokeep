import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index.ts';

describe('workspace smoke', () => {
  it('imports the package source with a .ts extension', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
