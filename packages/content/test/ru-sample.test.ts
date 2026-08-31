import { readFileSync } from 'node:fs';
import { createContentIndex, createLocalizer, validatePack } from '@hk/engine';
import { parsePack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

describe('srd-5e-2024-ru-sample', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../translations/srd-5e-2024-ru-sample.json', import.meta.url), 'utf8'),
  ) as unknown;
  const parsed = parsePack(raw);
  const core = buildPack();

  it('parses and validates against the built core pack', () => {
    expect(parsed.ok, JSON.stringify(parsed.ok ? '' : parsed.issues.slice(0, 3))).toBe(true);
    if (!parsed.ok) return;
    expect(validatePack(parsed.pack, [core])).toEqual([]);
    expect(Object.keys(parsed.pack.strings ?? {}).length).toBeGreaterThanOrEqual(20);
  });

  it('localizes names with per-field fallback', () => {
    if (!parsed.ok) return;
    const index = createContentIndex([core, parsed.pack]);
    const ru = createLocalizer(index, 'ru');
    expect(ru.name('srd-5e-2024:spell/fireball')).toBe('Огненный шар');
    expect(ru.text('srd-5e-2024:spell/fireball', 'description').isFallback).toBe(false);
    expect(ru.name('srd-5e-2024:class/fighter')).toBe('Воин');
    // untranslated spell falls back to English:
    expect(ru.text('srd-5e-2024:spell/acid-arrow', 'name')).toMatchObject({ isFallback: true });
    expect(ru.choicePrompt('srd-5e-2024:system/5e-2024@0/ability-scores').text).toBe('Значения характеристик');
  });
});
