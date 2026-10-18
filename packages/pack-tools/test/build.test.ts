import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { canonicalJson } from '../src/canonical.ts';
import { runBuild } from '../src/commands/build.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hk-build-'));
  writeFileSync(
    join(dir, 'pack.yaml'),
    [
      'format: 1',
      'id: yaml-pack',
      'version: 0.1.0',
      'kind: content',
      'system: mini',
      'name: Yaml pack',
      'dependencies:',
      '  - id: core-mini',
      '    range: ^1',
    ].join('\n'),
  );
  mkdirSync(join(dir, 'entities', 'feats'), { recursive: true });
  writeFileSync(
    join(dir, 'entities', 'feats', 'lucky.yaml'),
    [
      'id: yaml-pack:feat/lucky',
      'type: feat',
      'name: Lucky',
      'category: origin',
      'effects:',
      '  - type: tag.grant',
      '    tag: lucky',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'entities', 'features.json'),
    JSON.stringify([
      { id: 'yaml-pack:feature/a', type: 'feature', name: 'A' },
      { id: 'yaml-pack:feature/b', type: 'feature', name: 'B', grants: [{ feature: 'core-mini:feature/darkvision' }] },
    ]),
  );
  return dir;
}

describe('build', () => {
  it('merges manifest and entity files into a validated pack.json', () => {
    const dir = scaffold();
    const r = runBuild({ dir, packsDir: fixtures });
    expect(r.exitCode, r.lines.join('\n')).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'dist', 'pack.json'), 'utf8')) as { entities: { id: string }[] };
    expect(out.entities.map((e) => e.id)).toEqual([
      'yaml-pack:feat/lucky',
      'yaml-pack:feature/a',
      'yaml-pack:feature/b',
    ]);
  });

  it('does not write output when validation fails', () => {
    const dir = scaffold();
    writeFileSync(
      join(dir, 'entities', 'broken.yaml'),
      ['id: yaml-pack:feature/c', 'type: feature', 'name: C', 'grants:', '  - feature: core-mini:feature/nope'].join(
        '\n',
      ),
    );
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

// ── plan 15 task 8: `build --zip` → deterministic `.hkpack` (doc-04 §Distribution / §Authoring) ──

const iconPath = fileURLToPath(
  new URL('../../../apps/web/src/testing/fixtures/packs/sample-icon.webp', import.meta.url),
);
const ICON_HEX = '86be52bdb7547413cafb3ed175a806a798c65de98b40849e0b974c47d187de65';

/** A content pack (on core-mini) that lists the 34-byte sample icon and ships it under `assets/`. */
function scaffoldWithAsset(entityOrder: 'ab' | 'ba' = 'ab'): string {
  const dir = mkdtempSync(join(tmpdir(), 'hk-zip-'));
  writeFileSync(
    join(dir, 'pack.json'),
    JSON.stringify({
      format: 1,
      id: 'zip-pack',
      version: '1.2.3',
      kind: 'content',
      system: 'mini',
      name: 'Zip pack',
      dependencies: [{ id: 'core-mini', range: '^1' }],
      assets: [{ hash: `sha256:${ICON_HEX}`, kind: 'icon', mime: 'image/webp', size: 34 }],
    }),
  );
  mkdirSync(join(dir, 'entities'), { recursive: true });
  const a = { id: 'zip-pack:feature/a', type: 'feature', name: 'A', icon: `sha256:${ICON_HEX}` };
  const b = { id: 'zip-pack:feature/b', type: 'feature', name: 'B' };
  // Same content either way; the source key order differs to prove the output does not depend on it.
  const order = (o: Record<string, string>) =>
    entityOrder === 'ab' ? o : Object.fromEntries(Object.entries(o).reverse());
  writeFileSync(join(dir, 'entities', '1-a.json'), JSON.stringify(order(a)));
  writeFileSync(join(dir, 'entities', '2-b.json'), JSON.stringify(order(b)));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'sample-icon.webp'), readFileSync(iconPath));
  return dir;
}

describe('build --zip', () => {
  it('writes dist/<id>-<version>.hkpack with exactly pack.json + the listed assets', () => {
    const dir = scaffoldWithAsset();
    const r = runBuild({ dir, packsDir: fixtures, zip: true });
    expect(r.exitCode, r.lines.join('\n')).toBe(0);
    const zipPath = join(dir, 'dist', 'zip-pack-1.2.3.hkpack');
    expect(existsSync(zipPath)).toBe(true);
    const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
    expect(Object.keys(entries)).toEqual([`assets/${ICON_HEX}`, 'pack.json']);
    expect(Buffer.from(entries[`assets/${ICON_HEX}`]!).equals(readFileSync(iconPath))).toBe(true);
    // The zip's pack.json is the canonical (sorted-key) JSON and the same bytes as dist/pack.json.
    const packJson = strFromU8(entries['pack.json']!);
    expect(packJson).toBe(readFileSync(join(dir, 'dist', 'pack.json'), 'utf8'));
    expect(packJson).toBe(canonicalJson(JSON.parse(packJson)));
    expect((JSON.parse(packJson) as { entities: { id: string }[] }).entities.map((e) => e.id)).toEqual([
      'zip-pack:feature/a',
      'zip-pack:feature/b',
    ]);
  });

  it('is deterministic: two builds are byte-identical and every entry carries the fixed 1980-01-01 mtime', () => {
    const one = scaffoldWithAsset('ab');
    const two = scaffoldWithAsset('ba');
    expect(runBuild({ dir: one, packsDir: fixtures, zip: true }).exitCode).toBe(0);
    expect(runBuild({ dir: two, packsDir: fixtures, zip: true }).exitCode).toBe(0);
    const a = readFileSync(join(one, 'dist', 'zip-pack-1.2.3.hkpack'));
    const b = readFileSync(join(two, 'dist', 'zip-pack-1.2.3.hkpack'));
    expect(a.equals(b)).toBe(true);
    // Local file headers: DOS time at +10, DOS date at +12. 1980-01-01 00:00 = time 0, date 0x0021.
    let headers = 0;
    for (let i = 0; i + 30 <= a.length; i++) {
      if (a.readUInt32LE(i) !== 0x04034b50) continue;
      headers++;
      expect(a.readUInt16LE(i + 10)).toBe(0);
      expect(a.readUInt16LE(i + 12)).toBe(0x0021);
      expect(a.readUInt16LE(i + 28)).toBe(0); // no extra field
    }
    expect(headers).toBe(2);
  });

  it('refuses an asset file no assets[] entry lists (exit 1, nothing written)', () => {
    const dir = scaffoldWithAsset();
    writeFileSync(join(dir, 'assets', 'stray.webp'), Buffer.from('not listed'));
    const r = runBuild({ dir, packsDir: fixtures, zip: true });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/error asset\.unlisted \[assets\/stray\.webp\]/);
    expect(existsSync(join(dir, 'dist', 'zip-pack-1.2.3.hkpack'))).toBe(false);
  });

  it('refuses an assets[] entry with no matching file (exit 1, nothing written)', () => {
    const dir = scaffoldWithAsset();
    rmSync(join(dir, 'assets', 'sample-icon.webp'));
    const r = runBuild({ dir, packsDir: fixtures, zip: true });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain(`error asset.missing [sha256:${ICON_HEX}]`);
    expect(existsSync(join(dir, 'dist', 'zip-pack-1.2.3.hkpack'))).toBe(false);
    expect(existsSync(join(dir, 'dist', 'pack.json'))).toBe(false);
  });

  it('without --zip writes no .hkpack and keeps the pretty dist/pack.json', () => {
    const dir = scaffoldWithAsset();
    expect(runBuild({ dir, packsDir: fixtures }).exitCode).toBe(0);
    expect(existsSync(join(dir, 'dist', 'zip-pack-1.2.3.hkpack'))).toBe(false);
    expect(readFileSync(join(dir, 'dist', 'pack.json'), 'utf8')).toMatch(/^\{\n {2}"/);
  });
});
