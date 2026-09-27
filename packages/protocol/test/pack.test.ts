import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PackSchema, formatIssues, parsePack } from '../src/pack/pack.ts';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/packs/${name}.json`, import.meta.url), 'utf8'));

/**
 * Phase 4 (plan 11, task 1) additive-safety net: every phase-4 pack-vocabulary widening must leave
 * pre-existing fixture packs parsing byte-identically. Hashes captured from `parsePack()`'s output
 * BEFORE any phase-4 schema edits (worktree phase-4-plan11-engine-vocabulary, base 676d884); this
 * test must still pass after all of task 1's additions land.
 *
 * `core-mini` re-pinned in task 4 (charges/attunement): the pack's own CONTENT intentionally grew
 * (three new item entities — `wand-of-sparks` with `charges`, `ring-of-the-fighter` and
 * `orb-of-the-mind` with `attunement.by` — added for this task's fixtures), which is a legitimate
 * hash change, not the schema-widening drift this net exists to catch (re-run `pnpm vitest run
 * --project protocol test/pack.test.ts -t byte-identically` after intentionally editing a pinned
 * fixture to get the new value).
 */
const PHASE_4_BASELINE_HASHES: Record<string, string> = {
  'core-mini': '2322ea43676d6818bab3925159bc45f342694aa92260d4fa6416396bd9a55bd7',
  'content-mini': '574a873c2062d0c850a5b20978b0a84b6da7c5bfa2a1bfd9ef1d74ce7d0aa9d9',
  'translation-mini': 'e3326b8e102787ae64a7e0bc814e1a7080b1df0c94911a1970d2e207db03d04e',
  'asi-mini': '5c4640f77bc3b5e211e372bef4ed7be8027b45f41241f5f5cab5fda75aa637a0',
};

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

  it('accepts a bare theme pack and rejects one carrying entities or overrides', () => {
    const core = load('core-mini') as Record<string, unknown>;
    const bareTheme = { ...core, kind: 'theme', entities: [] };
    const r = parsePack(bareTheme);
    expect(r.ok, r.ok ? '' : formatIssues(r.issues).join('\n')).toBe(true);
    expect(parsePack({ ...core, kind: 'theme' }).ok).toBe(false); // core-mini's entities are non-empty
  });

  it('enforces core packs define exactly one correctly-named system entity', () => {
    const noSystem = load('core-mini') as { entities: { type: string }[] };
    noSystem.entities = noSystem.entities.filter((e) => e.type !== 'system');
    expect(parsePack(noSystem).ok).toBe(false); // zero system entities

    const dupeSystem = load('core-mini') as { entities: { type: string }[] };
    dupeSystem.entities = [...dupeSystem.entities, dupeSystem.entities.find((e) => e.type === 'system')!];
    expect(parsePack(dupeSystem).ok).toBe(false); // two system entities

    const renamedSystem = load('core-mini') as { entities: { type: string; id: string }[] };
    const sys = renamedSystem.entities.find((e) => e.type === 'system')!;
    sys.id = 'core-mini:system/other';
    expect(parsePack(renamedSystem).ok).toBe(false); // slug no longer matches pack.system
  });

  it('requires content packs to declare "system"', () => {
    const content = load('content-mini') as Record<string, unknown>;
    expect(parsePack({ ...content, system: undefined }).ok).toBe(false);
  });

  it('requires translation packs to provide "strings" and to carry no entities or overrides', () => {
    const tr = load('translation-mini') as Record<string, unknown>;
    expect(parsePack({ ...tr, strings: undefined }).ok).toBe(false);

    const dummyEntity = { id: 'core-mini-ru:condition/dummy', type: 'condition', name: 'Dummy' };
    expect(parsePack({ ...tr, entities: [dummyEntity] }).ok).toBe(false);

    const dummyOverride = { target: 'core-mini:class/fighter', patch: [{ op: 'remove', path: '/subclassLevel' }] };
    expect(parsePack({ ...tr, overrides: [dummyOverride] }).ok).toBe(false);
  });

  it('rejects unknown format versions and bad semver', () => {
    const core = load('core-mini') as Record<string, unknown>;
    expect(PackSchema.safeParse({ ...core, format: 2 }).success).toBe(false);
    expect(PackSchema.safeParse({ ...core, version: '1.0' }).success).toBe(false);
  });

  it('phase-4 additive-safety net: fixture packs parse byte-identically', () => {
    for (const [name, sha] of Object.entries(PHASE_4_BASELINE_HASHES)) {
      const r = parsePack(load(name));
      if (!r.ok) throw new Error(`${name}: ${formatIssues(r.issues).join('\n')}`);
      const actual = createHash('sha256').update(JSON.stringify(r.pack)).digest('hex');
      expect(actual, `${name} parse output changed`).toBe(sha);
    }
  });
});
