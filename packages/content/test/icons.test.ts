import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

describe('icons map', () => {
  const map = JSON.parse(readFileSync(new URL('../src/icons/icons-map.json', import.meta.url), 'utf8')) as {
    categories: Record<string, string>;
    entities: Record<string, string>;
  };
  it('all values are gi: slugs and all entity keys exist in the pack', () => {
    const pack = buildPack();
    const ids = new Set(pack.entities.map((e) => e.id));
    for (const v of [...Object.values(map.categories), ...Object.values(map.entities)])
      expect(v).toMatch(/^gi:[a-z0-9-]+$/);
    for (const k of Object.keys(map.entities)) expect(ids.has(k), k).toBe(true);
  });
  it('covers the 8 spell schools and all 12 classes', () => {
    const schools = [
      'abjuration',
      'conjuration',
      'divination',
      'enchantment',
      'evocation',
      'illusion',
      'necromancy',
      'transmutation',
    ];
    for (const s of schools) expect(map.categories[`spell-school:${s}`], s).toBeTruthy();
    const classes = Object.keys(map.entities).filter((k) => k.includes(':class/'));
    expect(classes).toHaveLength(12);
  });
});
