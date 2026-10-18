import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HKPACK_LIMITS } from '@hk/protocol';
import { strToU8, zipSync } from 'fflate';
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

// ── plan 15 task 8: `validate` accepts a `.hkpack` (unzip with the HKPACK_LIMITS caps + entry filter) ──

const ICON_HEX = '86be52bdb7547413cafb3ed175a806a798c65de98b40849e0b974c47d187de65';
const icon = readFileSync(
  fileURLToPath(new URL('../../../apps/web/src/testing/fixtures/packs/sample-icon.webp', import.meta.url)),
);
const zipPackJson = JSON.stringify({
  format: 1,
  id: 'zip-pack',
  version: '1.0.0',
  kind: 'content',
  system: 'mini',
  name: 'Zip pack',
  dependencies: [{ id: 'core-mini', range: '^1' }],
  entities: [{ id: 'zip-pack:feature/a', type: 'feature', name: 'A', icon: `sha256:${ICON_HEX}` }],
  assets: [{ hash: `sha256:${ICON_HEX}`, kind: 'icon', mime: 'image/webp', size: 34 }],
});

function writeHkpack(entries: Record<string, Uint8Array>): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hk-')), 'p.hkpack');
  writeFileSync(path, zipSync(entries, { level: 0 }));
  return path;
}

describe('validate .hkpack', () => {
  it('accepts a well-formed .hkpack and validates its pack.json against --packs', () => {
    const path = writeHkpack({ 'pack.json': strToU8(zipPackJson), [`assets/${ICON_HEX}`]: new Uint8Array(icon) });
    const r = runValidate({ path, packsDir: fixtures });
    expect(r.exitCode, r.lines.join('\n')).toBe(0);
    expect(r.lines.at(-1)).toMatch(/OK: zip-pack@1\.0\.0 \(1 entities/);
    // Same semantic validation as a bare pack.json: without the dependency it fails.
    expect(runValidate({ path }).lines.join('\n')).toMatch(/error deps\.missing/);
  });

  it('reports tampered asset bytes as a hash error (exit 1)', () => {
    const tampered = new Uint8Array(icon);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    const path = writeHkpack({ 'pack.json': strToU8(zipPackJson), [`assets/${ICON_HEX}`]: tampered });
    const r = runValidate({ path, packsDir: fixtures });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain(`error asset.hash [sha256:${ICON_HEX}]`);
    expect(r.lines.at(-1)).toMatch(/FAILED: zip-pack@1\.0\.0/);
  });

  it('reports a listed asset with no entry as missing (exit 1)', () => {
    const path = writeHkpack({ 'pack.json': strToU8(zipPackJson) });
    const r = runValidate({ path, packsDir: fixtures });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain(`error asset.missing [sha256:${ICON_HEX}]`);
  });

  it('refuses a zip over the entry cap before reading it, and a zip without pack.json', () => {
    const many: Record<string, Uint8Array> = { 'pack.json': strToU8(zipPackJson) };
    for (let i = 0; i < HKPACK_LIMITS.maxEntries; i++) many[`junk/${i}`] = new Uint8Array(0);
    const r = runValidate({ path: writeHkpack(many), packsDir: fixtures });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/error hkpack\.entries/);

    const none = runValidate({ path: writeHkpack({ 'other.json': strToU8('{}') }), packsDir: fixtures });
    expect(none.exitCode).toBe(1);
    expect(none.lines.join('\n')).toMatch(/error hkpack\.missingPackJson/);
  });

  it('exits 2 on bytes that are not a zip', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'hk-')), 'bad.hkpack');
    writeFileSync(path, 'definitely not a zip');
    expect(runValidate({ path }).exitCode).toBe(2);
  });
});
