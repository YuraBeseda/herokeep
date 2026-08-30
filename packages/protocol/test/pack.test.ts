import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PackSchema, formatIssues, parsePack } from '../src/pack/pack.ts';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/packs/${name}.json`, import.meta.url), 'utf8'));

describe('PackSchema', () => {
  it('accepts the three fixture packs', () => {
    for (const name of ['core-mini', 'content-mini', 'translation-mini']) {
      const r = parsePack(load(name));
      expect(r.ok, name + ': ' + (r.ok ? '' : formatIssues(r.issues).join('\n'))).toBe(true);
    }
  });

  it('applies defaults', () => {
    const r = parsePack(load('core-mini'));
    if (!r.ok) throw new Error('unexpected');
    expect(r.pack.dependencies).toEqual([]);
    expect(r.pack.overrides).toEqual([]);
    expect(r.pack.assets).toEqual([]);
    expect(r.pack.i18n).toEqual({});
  });

  it('rejects entities outside the pack namespace', () => {
    const pack = load('content-mini') as { entities: { id: string }[] };
    pack.entities[0]!.id = 'core-mini:feature/cat-reflexes';
    const r = parsePack(pack);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(formatIssues(r.issues).join('\n')).toMatch(/namespace/);
  });

  it('rejects duplicate entity ids', () => {
    const pack = load('core-mini') as { entities: { id: string }[] };
    pack.entities.push({ ...(pack.entities[1] as object) } as { id: string });
    expect(parsePack(pack).ok).toBe(false);
  });

  it('enforces kind-specific rules', () => {
    const core = load('core-mini') as Record<string, unknown>;
    expect(parsePack({ ...core, kind: 'content' }).ok).toBe(false); // content must not define a system entity
    expect(parsePack({ ...core, system: undefined }).ok).toBe(false); // core needs system
    const tr = load('translation-mini') as Record<string, unknown>;
    expect(parsePack({ ...tr, translates: undefined }).ok).toBe(false);
    expect(parsePack({ ...tr, locale: 'en' }).ok).toBe(false);
    const content = load('content-mini') as Record<string, unknown>;
    expect(
      parsePack({
        ...content,
        overrides: [{ target: 'homebrew-mini:species/catfolk', patch: [{ op: 'remove', path: '/speed' }] }],
      }).ok,
    ).toBe(false); // own entities are edited directly
  });

  it('rejects unknown format versions and bad semver', () => {
    const core = load('core-mini') as Record<string, unknown>;
    expect(PackSchema.safeParse({ ...core, format: 2 }).success).toBe(false);
    expect(PackSchema.safeParse({ ...core, version: '1.0' }).success).toBe(false);
  });
});
