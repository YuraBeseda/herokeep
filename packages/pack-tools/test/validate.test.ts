import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runValidate } from '../src/commands/validate.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

describe('validate', () => {
  it('passes a valid core pack', () => {
    const r = runValidate({ path: join(fixtures, 'core-mini.json') });
    expect(r.exitCode).toBe(0);
    expect(r.lines.at(-1)).toMatch(/OK: core-mini@1\.0\.0/);
  });

  it('resolves dependencies from --packs and reports semantic errors', () => {
    expect(runValidate({ path: join(fixtures, 'content-mini.json'), packsDir: fixtures }).exitCode).toBe(0);
    const r = runValidate({ path: join(fixtures, 'content-mini.json') });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/error deps\.missing/);
  });

  it('reports schema issues with paths and exits 1; missing file exits 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ format: 1, id: 'x', version: '1', kind: 'content', name: 'Bad' }));
    const r = runValidate({ path: bad });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/version/);
    expect(runValidate({ path: join(dir, 'nope.json') }).exitCode).toBe(2);
  });

  it('reads YAML packs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-'));
    const y = join(dir, 'p.yaml');
    writeFileSync(
      y,
      [
        'format: 1',
        'id: yaml-mini',
        'version: 1.0.0',
        'kind: content',
        'system: mini',
        'name: Yaml',
        'dependencies:',
        '  - id: core-mini',
        '    range: ^1',
        'entities: []',
      ].join('\n'),
    );
    expect(runValidate({ path: y, packsDir: fixtures }).exitCode).toBe(0);
  });
});
