import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePack } from '@hk/protocol';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { collectTranslatableStrings, runI18nExtract } from '../src/commands/i18n-extract.ts';
import { readJson } from '../src/io.ts';

const fixtures = fileURLToPath(new URL('../../protocol/test/fixtures/packs/', import.meta.url));

describe('i18n extract', () => {
  it('collects names, descriptions, prompts and effect texts', () => {
    const r = parsePack(readJson(join(fixtures, 'core-mini.json')));
    if (!r.ok) throw new Error();
    const s = collectTranslatableStrings(r.pack);
    expect(s['spell/fireball']).toEqual({ name: 'Fireball', description: 'A bright streak flashes.' });
    expect(s['class/fighter@1/fighting-style']).toEqual({ prompt: 'Fighting Style' });
    expect(s['feature/action-surge']).toMatchObject({
      'effects.0.name': 'Action Surge',
      'effects.0.description': 'Take one additional action.',
    });
    expect(s['feature/second-wind']).toMatchObject({ 'effects.0.name': 'Second Wind' });
    expect(s['system/mini@0/ability-scores']).toEqual({ prompt: 'Ability scores' });
  });

  it('writes a YAML skeleton that validates as a translation pack', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-i18n-'));
    const out = join(dir, 'core-mini-uk.yaml');
    const r = runI18nExtract({
      path: join(fixtures, 'core-mini.json'),
      locale: 'uk',
      out,
    });
    expect(r.exitCode, r.lines.join('\n')).toBe(0);
    const text = readFileSync(out, 'utf8');
    expect(text).toMatch(/# en: Fireball\n\s+"name": ""/);
    const parsed = parsePack(parseYaml(text));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack).toMatchObject({
      kind: 'translation',
      locale: 'uk',
      translates: { id: 'core-mini', range: '^1' },
      id: 'core-mini-uk',
    });
  });

  it('exits 2 with malformed JSON file (no throw)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hk-i18n-'));
    const malformed = join(dir, 'bad.json');
    writeFileSync(malformed, '{not json');
    const r = runI18nExtract({ path: malformed, locale: 'uk' });
    expect(r.exitCode).toBe(2);
    expect(r.lines.join('\n')).toMatch(/cannot read/);
  });
});
