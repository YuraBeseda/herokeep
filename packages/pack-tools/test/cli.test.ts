import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

describe('cli', () => {
  it('returns exit code 2 for unknown flags with usage text', () => {
    const r = main(['validate', 'x.json', '--bogus']);
    expect(r.exitCode).toBe(2);
    const text = r.lines.join('\n');
    expect(text).toMatch(/herokeep-pack/);
  });

  it('build --zip writes the .hkpack and validate reads it by its extension', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-cli-'));
    writeFileSync(
      join(dir, 'pack.json'),
      JSON.stringify({
        format: 1,
        id: 'cli-pack',
        version: '0.2.0',
        kind: 'content',
        system: 'mini',
        name: 'CLI pack',
        dependencies: [{ id: 'core-mini', range: '^1' }],
      }),
    );
    mkdirSync(join(dir, 'entities'));
    writeFileSync(
      join(dir, 'entities', 'a.json'),
      JSON.stringify({ id: 'cli-pack:feature/a', type: 'feature', name: 'A' }),
    );
    const built = main(['build', dir, '--zip', '--packs', fixtures]);
    expect(built.exitCode, built.lines.join('\n')).toBe(0);
    const zip = join(dir, 'dist', 'cli-pack-0.2.0.hkpack');
    expect(existsSync(zip)).toBe(true);
    expect(built.lines.join('\n')).toContain(zip);

    const checked = main(['validate', zip, '--packs', fixtures]);
    expect(checked.exitCode, checked.lines.join('\n')).toBe(0);
    expect(checked.lines.at(-1)).toMatch(/OK: cli-pack@0\.2\.0/);
    expect(main(['help']).lines.join('\n')).toMatch(/build <dir> .*--zip/);
  });
});
