import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';

describe('cli', () => {
  it('returns exit code 2 for unknown flags with usage text', () => {
    const r = main(['validate', 'x.json', '--bogus']);
    expect(r.exitCode).toBe(2);
    const text = r.lines.join('\n');
    expect(text).toMatch(/herokeep-pack/);
  });
});
