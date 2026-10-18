import { type Pack, parseEvent } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { type ContentIndex, createContentIndex } from '../../src/content/index.ts';
import { type Pins, pinnedRoots } from '../../src/content/deps.ts';
import { derive } from '../../src/derive/index.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadEngineFixturePack, loadFixturePack } from '../support/fixtures.ts';
import { DIST_PREFIX, FIXTURE_PREFIX, loadDistPack, loadGoldens } from '../support/golden.ts';

/**
 * Plan 15 Review Focus 1: the web app derives each character against `createContentIndex(all
 * installed packs, { pins: facts.pins, roots })` instead of one global index. An installed but
 * UNPINNED content pack must change nothing — every golden character derives byte-identically
 * against the per-character index and against the core-only index it was pinned under.
 *
 * `sample-content.json` is a byte-identical copy of `apps/web/src/testing/fixtures/packs/
 * sample-content.json` (plan 15 fixture single-source ruling; Task 8 asserts the equality).
 */
const sample = loadEngineFixturePack('sample-content');

const packCache = new Map<string, Pack>();
function loadPack(name: string): Pack {
  let pack = packCache.get(name);
  if (!pack) {
    pack = name.startsWith(DIST_PREFIX) ? loadDistPack(name.slice(DIST_PREFIX.length)) : loadFixturePack(name);
    packCache.set(name, pack);
  }
  return pack;
}

const indexCache = new Map<string, ContentIndex>();
function cachedIndex(key: string, build: () => ContentIndex): ContentIndex {
  let index = indexCache.get(key);
  if (!index) {
    index = build();
    indexCache.set(key, index);
  }
  return index;
}

function pinsKey(pins: Pins): string {
  return Object.keys(pins)
    .sort()
    .map((id) => `${id}@${pins[id]}`)
    .join(',');
}

describe('per-character content index (pins + roots)', () => {
  // Core-only goldens: Task 8's content-pack goldens (`fixture:` packs) are excluded — they pin
  // and unpin `sample-content` themselves and the golden suite already derives them against the
  // per-character pinned index.
  const all = loadGoldens();
  const goldens = all.filter((fx) => !fx.packs.some((p) => p.startsWith(FIXTURE_PREFIX)));

  it('covers every core-only golden fixture (never fewer than the 71 pre-plan-15 ones)', () => {
    // Derived, not hardcoded: a new core-only golden is covered without editing this test, and
    // only the content-pack goldens are left out.
    const withFixturePacks = all.filter((fx) => fx.packs.some((p) => p.startsWith(FIXTURE_PREFIX)));
    expect(goldens.length + withFixturePacks.length).toBe(all.length);
    expect(goldens.length).toBeGreaterThanOrEqual(71);
  });

  it.each(goldens.map((fx) => [fx.name, fx] as const))(
    '%s derives identically with an installed-but-unpinned content pack',
    (_name, fx) => {
      const packs = fx.packs.map(loadPack);
      const base = cachedIndex(`base:${fx.packs.join(',')}`, () => createContentIndex(packs));
      const usesDistPack = fx.packs.some((p) => p.startsWith(DIST_PREFIX));
      const rules: SystemRules | undefined = usesDistPack
        ? { restRules: base.system().restRules, hpRules: base.system().hpRules }
        : undefined;
      const events = fx.events.map((e) => {
        const r = parseEvent(e);
        if (!r.ok) throw new Error(`${fx.name}: bad event`);
        return r.event;
      });
      const facts = reduce(events, undefined, rules);
      const all = [...packs, sample];

      // The brief's literal form: roots = the pinned pack ids.
      const literal = cachedIndex(`literal:${fx.packs.join(',')}|${pinsKey(facts.pins)}`, () =>
        createContentIndex(all, { pins: facts.pins, roots: Object.keys(facts.pins) }),
      );
      // What the web app's `EngineFacade.indexFor` uses: pinned ids plus their translations.
      const pinned = cachedIndex(`pinned:${fx.packs.join(',')}|${pinsKey(facts.pins)}`, () =>
        createContentIndex(all, { pins: facts.pins, roots: pinnedRoots(all, facts.pins) }),
      );

      expect(literal.diagnostics).toEqual([]);
      expect(pinned.diagnostics).toEqual([]);
      expect(literal.has(sample.entities[0]!.id)).toBe(false);
      const expected = derive(facts, base, rules);
      expect(derive(facts, literal, rules)).toStrictEqual(expected);
      expect(derive(facts, pinned, rules)).toStrictEqual(expected);
    },
  );

  it('pinning the sample pack does bring its entities in (the replay above is not vacuous)', () => {
    const core = loadDistPack('srd-5e-2024');
    const pins: Pins = { [core.id]: core.version, [sample.id]: sample.version };
    const index = createContentIndex([core, sample], { pins, roots: pinnedRoots([core, sample], pins) });
    expect(index.diagnostics).toEqual([]);
    expect(index.has('sample-content:species/moonkin')).toBe(true);
  });
});

describe('pinnedRoots', () => {
  const coreMini = loadFixturePack('core-mini');
  const coreMiniRu = loadFixturePack('translation-mini');
  const homebrew = loadFixturePack('content-mini');

  it('verify finding: a translation pack is NOT attached when roots list only the pinned content id', () => {
    const index = createContentIndex([coreMini, coreMiniRu], {
      pins: { [coreMini.id]: coreMini.version },
      roots: [coreMini.id],
    });
    expect(index.translationPacks()).toEqual([]);
  });

  it('adds the translation packs of the pinned packs, so the core translation attaches with roots = [core]', () => {
    const pins: Pins = { [coreMini.id]: coreMini.version };
    const roots = pinnedRoots([coreMini, coreMiniRu], pins);
    expect(roots).toEqual([coreMini.id, coreMiniRu.id]);
    const index = createContentIndex([coreMini, coreMiniRu], { pins, roots });
    expect(index.diagnostics).toEqual([]);
    expect(index.translationPacks().map((p) => p.id)).toEqual([coreMiniRu.id]);
  });

  it('follows dependencies of the pinned packs when attaching translations', () => {
    const pins: Pins = { [homebrew.id]: homebrew.version };
    expect(pinnedRoots([coreMini, coreMiniRu, homebrew], pins)).toEqual([homebrew.id, coreMiniRu.id]);
  });

  it('leaves out translations of installed packs that are neither pinned nor depended on', () => {
    const sampleRu = { ...coreMiniRu, id: 'sample-ru', translates: { id: sample.id, range: '^1' } } as Pack;
    const pins: Pins = { [coreMini.id]: coreMini.version };
    expect(pinnedRoots([coreMini, coreMiniRu, sample, sampleRu], pins)).toEqual([coreMini.id, coreMiniRu.id]);
  });

  it('orders the pinned ids by id, so the index never depends on pin insertion order', () => {
    const a = pinnedRoots([coreMini, coreMiniRu, homebrew], {
      [homebrew.id]: homebrew.version,
      [coreMini.id]: coreMini.version,
    });
    const b = pinnedRoots([coreMini, coreMiniRu, homebrew], {
      [coreMini.id]: coreMini.version,
      [homebrew.id]: homebrew.version,
    });
    expect(a).toEqual([coreMini.id, homebrew.id, coreMiniRu.id]);
    expect(b).toEqual(a);
  });

  it('keeps a pin to a pack that is not installed as a root (the index reports it as missing)', () => {
    const pins: Pins = { [coreMini.id]: coreMini.version, gone: '1.0.0' };
    const roots = pinnedRoots([coreMini], pins);
    expect(roots).toEqual([coreMini.id, 'gone']);
    const index = createContentIndex([coreMini], { pins, roots });
    expect(index.diagnostics.map((d) => d.code)).toEqual(['deps.missing']);
    expect(index.has(coreMini.entities[0]!.id)).toBe(true);
  });
});
