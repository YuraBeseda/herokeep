import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonical.ts';
import { runDiff } from '../src/commands/diff.ts';
import { readJson } from '../src/io.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

describe('canonicalJson', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }));
  });
});

describe('diff', () => {
  it('lists added, removed and changed entities and version/dependency changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-diff-'));
    const a = readJson(join(fixtures, 'content-mini.json')) as {
      version: string;
      entities: Record<string, unknown>[];
      dependencies: { range: string }[];
    };
    const b = structuredClone(a);
    b.version = '1.3.0';
    b.dependencies[0]!.range = '^1.1';
    b.entities[0]!['description'] = 'Bonus to initiative (changed).';
    b.entities.push({ id: 'homebrew-mini:feature/new', type: 'feature', name: 'New' });
    b.entities.splice(1, 1); // remove catfolk
    writeFileSync(join(dir, 'a.json'), JSON.stringify(a));
    writeFileSync(join(dir, 'b.json'), JSON.stringify(b));
    const r = runDiff({ a: join(dir, 'a.json'), b: join(dir, 'b.json') });
    expect(r.exitCode).toBe(0);
    const text = r.lines.join('\n');
    expect(text).toMatch(/version: 1\.2\.0 → 1\.3\.0/);
    expect(text).toMatch(/\+ homebrew-mini:feature\/new/);
    expect(text).toMatch(/- homebrew-mini:species\/catfolk/);
    expect(text).toMatch(/~ homebrew-mini:feature\/cat-reflexes \(description\)/);
    expect(text).toMatch(/dependency changed: core-mini \^1 → \^1\.1/);
  });

  it('exits 2 with malformed JSON file (no throw)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-diff-'));
    const malformed = join(dir, 'bad.json');
    writeFileSync(malformed, '{not json');
    const r = runDiff({ a: malformed, b: join(fixtures, 'core-mini.json') });
    expect(r.exitCode).toBe(2);
    expect(r.lines.join('\n')).toMatch(/cannot read/);
  });

  it('exits 1 with schema-invalid pack', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-diff-'));
    const invalid = join(dir, 'invalid.json');
    writeFileSync(
      invalid,
      JSON.stringify({
        format: 1,
        id: 'x',
        version: '1',
        kind: 'content',
        name: 'Bad',
      }),
    );
    const r = runDiff({ a: invalid, b: join(fixtures, 'core-mini.json') });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/schema errors/);
  });
});
