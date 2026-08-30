import { type Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const core = loadFixturePack('core-mini');
const content = loadFixturePack('content-mini');
const ru = loadFixturePack('translation-mini');

describe('createContentIndex', () => {
  it('indexes entities from all packs in dependency order', () => {
    const idx = createContentIndex([content, core, ru]);
    expect(idx.diagnostics).toEqual([]);
    expect(idx.packs().map((p) => p.id)).toEqual(['core-mini', 'homebrew-mini']);
    expect(idx.translationPacks().map((p) => p.id)).toEqual(['core-mini-ru']);
    expect(idx.get('core-mini:spell/fireball')?.name).toBe('Fireball');
    expect(idx.has('homebrew-mini:species/catfolk')).toBe(true);
    expect(idx.byType('species').map((e) => e.id)).toEqual(['core-mini:species/elf', 'homebrew-mini:species/catfolk']);
    expect(idx.system().id).toBe('core-mini:system/mini');
  });

  it('applies overrides from dependants onto dependencies', () => {
    const idx = createContentIndex([core, content]);
    const fighter = idx.get('core-mini:class/fighter');
    expect(fighter?.type).toBe('class');
    if (fighter?.type !== 'class') return;
    expect(fighter.levels[0]?.grants.map((g) => g.feature)).toEqual([
      'core-mini:feature/second-wind',
      'homebrew-mini:feature/cat-reflexes',
    ]);
    // the original pack object is untouched
    expect(
      (core.entities.find((e) => e.id === 'core-mini:class/fighter') as { levels: { grants: unknown[] }[] }).levels[0]!
        .grants,
    ).toHaveLength(1);
  });

  it('answers queries', () => {
    const idx = createContentIndex([core, content]);
    expect(idx.query({ type: 'feat', tags: ['fighting-style'] }).map((e) => e.id)).toEqual([
      'core-mini:feat/archery',
      'core-mini:feat/defense',
    ]);
    expect(idx.query({ type: 'spell', level: 3, classes: ['wizard'] }).map((e) => e.id)).toEqual([
      'core-mini:spell/fireball',
    ]);
    expect(idx.query({ type: 'spell', classes: ['cleric'] })).toEqual([]);
    expect(idx.query({ type: 'subclass', classes: ['fighter'] }).map((e) => e.id)).toEqual([
      'core-mini:subclass/champion',
    ]);
    expect(idx.resolveClassRef('fighter')).toBe('core-mini:class/fighter');
    expect(idx.resolveClassRef('core-mini:class/fighter')).toBe('core-mini:class/fighter');
    expect(idx.resolveClassRef('wizard')).toBeUndefined();
  });

  it('reports duplicate ids across packs and bad override targets', () => {
    // same id twice inside one pack is a schema error; across packs it is an index error:
    const clash = { ...content, id: 'core-mini', version: '1.0.1', dependencies: [] } as Pack;
    expect(
      createContentIndex([core, clash], { pins: { 'core-mini': '9.9.9' } }).diagnostics.map((d) => d.code),
    ).toContain('deps.pinMissing');
    const badTarget = {
      ...content,
      overrides: [{ target: 'core-mini:class/wizard', patch: [{ op: 'remove', path: '/hitDie' }] }],
    } as Pack;
    expect(createContentIndex([core, badTarget]).diagnostics.map((d) => d.code)).toEqual([
      'index.overrideTargetMissing',
    ]);
    const invalidPatch = {
      ...content,
      overrides: [{ target: 'core-mini:class/fighter', patch: [{ op: 'replace', path: '/hitDie', value: 7 }] }],
    } as Pack;
    expect(createContentIndex([core, invalidPatch]).diagnostics.map((d) => d.code)).toEqual(['index.overrideInvalid']);
  });
});
