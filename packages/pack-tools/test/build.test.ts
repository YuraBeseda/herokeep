import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBuild } from '../src/commands/build.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hk-build-'));
  writeFileSync(join(dir, 'pack.yaml'), ['format: 1', 'id: yaml-pack', 'version: 0.1.0', 'kind: content', 'system: mini', 'name: Yaml pack', 'dependencies:', '  - id: core-mini', '    range: ^1'].join('\n'));
  mkdirSync(join(dir, 'entities', 'feats'), { recursive: true });
  writeFileSync(join(dir, 'entities', 'feats', 'lucky.yaml'), ['id: yaml-pack:feat/lucky', 'type: feat', 'name: Lucky', 'category: origin', 'effects:', '  - type: tag.grant', '    tag: lucky'].join('\n'));
  writeFileSync(join(dir, 'entities', 'features.json'), JSON.stringify([
    { id: 'yaml-pack:feature/a', type: 'feature', name: 'A' },
    { id: 'yaml-pack:feature/b', type: 'feature', name: 'B', grants: [{ feature: 'core-mini:feature/darkvision' }] },
  ]));
  return dir;
}

describe('build', () => {
  it('merges manifest and entity files into a validated pack.json', () => {
    const dir = scaffold();
    const r = runBuild({ dir, packsDir: fixtures });
    expect(r.exitCode, r.lines.join('\n')).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'dist', 'pack.json'), 'utf8')) as { entities: { id: string }[] };
    expect(out.entities.map((e) => e.id)).toEqual(['yaml-pack:feat/lucky', 'yaml-pack:feature/a', 'yaml-pack:feature/b']);
  });

  it('does not write output when validation fails', () => {
    const dir = scaffold();
    writeFileSync(join(dir, 'entities', 'broken.yaml'), ['id: yaml-pack:feature/c', 'type: feature', 'name: C', 'grants:', '  - feature: core-mini:feature/nope'].join('\n'));
    const r = runBuild({ dir, packsDir: fixtures, out: join(dir, 'custom.json') });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/ref\.missing/);
    expect(existsSync(join(dir, 'custom.json'))).toBe(false);
  });

  it('exits 2 without a manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-build-'));
    expect(runBuild({ dir }).exitCode).toBe(2);
  });
});
