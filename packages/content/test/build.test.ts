import { validatePack } from '@hk/engine';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION } from '../src/static/attribution.ts';
import { buildPack } from '../src/build.ts';

describe('the srd-5e-2024 pack', () => {
  const pack = buildPack();

  it('validates with zero diagnostics', () => {
    const d = validatePack(pack, []);
    expect(d, JSON.stringify(d.slice(0, 5))).toEqual([]);
  });

  it('carries the manifest and exact attribution', () => {
    expect(pack).toMatchObject({
      format: 1,
      id: 'srd-5e-2024',
      version: '0.1.0',
      kind: 'core',
      system: '5e-2024',
      license: 'CC-BY-4.0',
    });
    expect(pack.attribution).toBe(ATTRIBUTION);
  });

  it('has the pinned entity counts by type', () => {
    const byType = new Map<string, number>();
    for (const e of pack.entities) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    expect(byType.get('system')).toBe(1);
    expect(byType.get('spell')).toBe(339);
    expect(byType.get('species')).toBe(9);
    expect(byType.get('background')).toBe(4);
    expect(byType.get('feat')).toBe(17);
    expect(byType.get('class')).toBe(12);
    expect(byType.get('subclass')).toBe(12);
    expect(byType.get('condition')).toBe(15);
    expect(byType.get('skill')).toBe(18);
    expect(byType.get('ability')).toBe(6);
    expect(byType.get('language') ?? 0).toBeGreaterThanOrEqual(16);
    expect(byType.get('item') ?? 0).toBeGreaterThanOrEqual(400);
    expect(byType.get('feature') ?? 0).toBeGreaterThanOrEqual(350);
    expect(pack.entities.length).toBeLessThanOrEqual(5000);
  });

  it('post-overlay spot goldens (SRD truth): fighter saves, system choices, size budget', () => {
    const fighter = pack.entities.find((e) => e.id === 'srd-5e-2024:class/fighter') as { saves?: string[] };
    expect(fighter?.saves).toEqual(['str', 'con']);
    const sys = pack.entities.find((e) => e.type === 'system')!;
    expect(sys.choices.map((c) => c.id)).toContain('srd-5e-2024:system/5e-2024@0/ability-scores');
    const bytes = new TextEncoder().encode(JSON.stringify(pack)).length;
    expect(bytes, 'PACK_LIMITS.maxBytes').toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it('entities are sorted by id (deterministic output)', () => {
    const ids = pack.entities.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
  });
});
