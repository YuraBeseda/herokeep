import { describe, expect, it } from 'vitest';
import { validatePack } from '../../src/content/validate.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const core = loadFixturePack('core-mini');
const content = loadFixturePack('content-mini');
const ru = loadFixturePack('translation-mini');
const codes = (d: { code: string }[]) => d.map((x) => x.code);

describe('validatePack', () => {
  it('passes the fixtures', () => {
    expect(validatePack(core, [])).toEqual([]);
    expect(validatePack(content, [core])).toEqual([]);
    expect(validatePack(ru, [core])).toEqual([]);
  });

  it('reports dangling references with paths', () => {
    const broken = structuredClone(content);
    (broken.entities[1] as { grants: { feature: string }[] }).grants[0]!.feature = 'core-mini:feature/nope';
    const d = validatePack(broken, [core]);
    expect(codes(d)).toEqual(['ref.missing']);
    expect(d[0]?.path).toBe('entities.1.grants.0.feature');
    expect(d[0]?.entityId).toBe('homebrew-mini:species/catfolk');
  });

  it('reports choice id mismatches and class row level mismatches', () => {
    const bad = structuredClone(core);
    const fighter = bad.entities.find((e) => e.id === 'core-mini:class/fighter');
    if (fighter?.type !== 'class') throw new Error();
    fighter.levels[0]!.choices[0]!.id = 'core-mini:class/wizard@1/fighting-style';
    fighter.levels[1]!.choices = [
      {
        ...fighter.levels[0]!.choices[1]!,
        id: 'core-mini:class/fighter@1/dup',
        at: { kind: 'classLevel', class: 'fighter', level: 1 },
      },
    ];
    expect(codes(validatePack(bad, []))).toEqual(['choice.idMismatch', 'class.rowLevelMismatch']);
  });

  it('warns on unknown translation keys and missing deps error', () => {
    const tr = structuredClone(ru);
    tr.strings!['spell/meteor'] = { name: 'x' };
    const d = validatePack(tr, [core]);
    expect(d).toEqual([expect.objectContaining({ severity: 'warning', code: 'i18n.unknownKey' })]);
    expect(codes(validatePack(content, []))).toEqual(['deps.missing']);
  });

  it('flags oversize descriptions and missing assets', () => {
    const big = structuredClone(core);
    big.entities[1]!.description = 'x'.repeat(20 * 1024 + 1);
    expect(codes(validatePack(big, []))).toEqual(['entity.descriptionTooLong']);
    const icon = structuredClone(core);
    icon.entities[1]!.icon = 'sha256:' + 'a'.repeat(64);
    expect(codes(validatePack(icon, []))).toEqual(['asset.missing']);
  });
});
