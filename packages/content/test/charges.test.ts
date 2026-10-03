import { createContentIndex, derive, propose, reduce } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';
import { parseAttunementBy, parseCharges } from '../src/transform/charges.ts';
import { pkSlug, readFixture } from '../src/upstream.ts';
import { fieldStr, pkStr } from '../src/transform/common.ts';

/**
 * Plan 12 task 6 (rulings 7 + 8): magic-item charges and `attunement.by` are parsed from vendored
 * free text by CONSERVATIVE regexes — a wrong max is worse than none. Every spot-check below was
 * hand-verified against `packages/content/upstream/open5e-srd-2024/MagicItem.json` (pks cited).
 */
const records = readFixture('MagicItem');
const descOf = (slug: string): string => {
  const rec = records.find((r) => pkSlug(pkStr(r.pk)) === slug);
  if (!rec) throw new Error(`no vendored magic item "${slug}"`);
  return fieldStr(rec.fields, 'desc', pkStr(rec.pk));
};

describe('parseCharges: hand-verified charged staples', () => {
  // [slug, max, reset, regain]  — pk = srd-2024_<slug>
  const staples: [string, number, 'dawn' | 'never', string | null][] = [
    ['wand-of-magic-missiles', 7, 'dawn', '1d6 + 1'], // "This wand has 7 charges … regains 1d6 + 1 expended charges daily at dawn"
    ['wand-of-fireballs', 7, 'dawn', '1d6 + 1'],
    ['wand-of-lightning-bolts', 7, 'dawn', '1d6 + 1'],
    ['wand-of-paralysis', 7, 'dawn', '1d6 + 1'],
    ['wand-of-polymorph', 7, 'dawn', '1d6 + 1'],
    ['wand-of-secrets', 3, 'dawn', '1d3'],
    ['wand-of-magic-detection', 3, 'dawn', '1d3'],
    ['staff-of-fire', 10, 'dawn', '1d6 + 4'],
    ['staff-of-healing', 10, 'dawn', '1d6 + 4'],
    ['staff-of-power', 20, 'dawn', '2d8 + 4'],
    ['staff-of-the-magi', 50, 'dawn', '4d6 + 2'],
    ['ring-of-evasion', 3, 'dawn', '1d3'],
    ['ring-of-the-ram', 3, 'dawn', '1d3'],
    ['winged-boots', 4, 'dawn', '1d4'],
    ['eyes-of-charming', 3, 'dawn', 'all'], // "The lenses regain all expended charges daily at dawn"
    ['scarab-of-protection', 12, 'never', null], // "has 12 charges", no regain text at all
    ['gem-of-brightness', 50, 'never', null],
    ['talisman-of-pure-good', 7, 'never', null],
  ];
  it.each(staples)('%s -> max %i, reset %s', (slug, max, reset, regain) => {
    expect(parseCharges(descOf(slug))).toEqual({ max, reset, regain });
  });
});

describe('parseCharges: charge-prose items that must stay unmechanized', () => {
  const unmechanized: [string, string][] = [
    ['luck-blade-longsword', 'dice max ("has 1d3 charges")'],
    ['nine-lives-stealer-dagger', 'dice max ("has 1d8 + 1 charges")'],
    ['cube-of-force', '"starts with 10 charges" is not the ruling-7 phrasing'],
    ['figurine-of-wondrous-power-ivory-goats', 'regains charges after 7 days, not at dawn'],
    ['ring-of-three-wishes', '"1 of its 3 charges" is not the ruling-7 phrasing'],
    ['manual-of-bodily-health', 'prose only (no charges)'],
    ['tome-of-clear-thought', 'prose only (no charges)'],
  ];
  it.each(unmechanized)('%s stays unmechanized: %s', (slug) => {
    expect(parseCharges(descOf(slug))).toBeUndefined();
  });

  it('rejects ambiguous synthetic text', () => {
    expect(parseCharges('The rod has 3 charges and has 5 charges.')).toBeUndefined();
    expect(parseCharges('It has 4 charges. It regains 1d4 charges at midnight.')).toBeUndefined();
    expect(parseCharges('It has 4 charges and regains 1d4 expended charges daily at dawn.')).toEqual({
      max: 4,
      reset: 'dawn',
      regain: '1d4',
    });
    expect(parseCharges('Regains 2 expended charges daily at dawn.')).toBeUndefined(); // no max
  });
});

/**
 * THE LOUD-DIFF MANIFEST: the parser run over ALL 757 vendored descs. Any regex change that alters a
 * single item (added, dropped, or changed max/reset/regain) fails here. Each row is
 * `slug|max|reset|regain`; reviewed by hand against the vendored text (see task-6-report.md).
 * Deliberately NOT parsed (ledger): wand-of-web (vendored desc states no max), cube-of-force
 * ("starts with"), ring-of-three-wishes ("1 of its 3 charges"), figurine ivory goats (7-day regain),
 * luck-blade-* and nine-lives-stealer-* (dice max), the 6 manual/tome items (no charges at all).
 */
const MANIFEST = [
  'cubic-gate|3|dawn|1d3',
  'dragon-orb|7|dawn|1d4 + 3',
  'eyes-of-charming|3|dawn|all',
  'gem-of-brightness|50|never|null',
  'gem-of-seeing|3|dawn|1d3',
  'hammer-of-thunderbolts-maul|5|dawn|1d4 + 1',
  'hammer-of-thunderbolts-warhammer|5|dawn|1d4 + 1',
  'helm-of-teleportation|3|dawn|1d3',
  'mace-of-terror|3|dawn|1d3',
  'medallion-of-thoughts|5|dawn|1d4',
  'pipes-of-haunting|3|dawn|1d3',
  'pipes-of-the-sewers|3|dawn|1d3',
  'ring-of-animal-influence|3|dawn|1d3',
  'ring-of-elemental-command|5|dawn|1d4 + 1',
  'ring-of-evasion|3|dawn|1d3',
  'ring-of-shooting-stars|6|dawn|1d6',
  'ring-of-the-ram|3|dawn|1d3',
  'robe-of-scintillating-colors|3|dawn|1d3',
  'scarab-of-protection|12|never|null',
  'staff-of-charming|10|dawn|1d8 + 2',
  'staff-of-fire|10|dawn|1d6 + 4',
  'staff-of-frost|10|dawn|1d6 + 4',
  'staff-of-healing|10|dawn|1d6 + 4',
  'staff-of-power|20|dawn|2d8 + 4',
  'staff-of-striking|10|dawn|1d6 + 4',
  'staff-of-swarming-insects|10|dawn|1d6 + 4',
  'staff-of-the-magi|50|dawn|4d6 + 2',
  'staff-of-the-woodlands|6|dawn|1d6',
  'staff-of-withering|3|dawn|1d3',
  'talisman-of-pure-good|7|never|null',
  'talisman-of-ultimate-evil|6|never|null',
  'trident-of-fish-command|3|dawn|1d3',
  'wand-of-binding|7|dawn|1d6 + 1',
  'wand-of-enemy-detection|7|dawn|1d6 + 1',
  'wand-of-fireballs|7|dawn|1d6 + 1',
  'wand-of-lightning-bolts|7|dawn|1d6 + 1',
  'wand-of-magic-detection|3|dawn|1d3',
  'wand-of-magic-missiles|7|dawn|1d6 + 1',
  'wand-of-paralysis|7|dawn|1d6 + 1',
  'wand-of-polymorph|7|dawn|1d6 + 1',
  'wand-of-secrets|3|dawn|1d3',
  'wand-of-wonder|7|dawn|1d6 + 1',
  'winged-boots|4|dawn|1d4',
];

describe('parseCharges: full-corpus manifest', () => {
  const parsed = records
    .map((r) => ({ id: pkSlug(pkStr(r.pk)), c: parseCharges(fieldStr(r.fields, 'desc', pkStr(r.pk))) }))
    .filter((r) => r.c !== undefined)
    .map((r) => `${r.id}|${r.c!.max}|${r.c!.reset}|${r.c!.regain}`)
    .sort();

  it('pins the exact parsed list and count (757 scanned)', () => {
    expect(records).toHaveLength(757);
    expect(parsed).toHaveLength(43);
    expect(parsed).toEqual(MANIFEST);
  });

  it('no parsed item states a different "N charges" max than the parsed one', () => {
    for (const r of records) {
      const c = parseCharges(fieldStr(r.fields, 'desc', pkStr(r.pk)));
      if (!c) continue;
      const stated = [...fieldStr(r.fields, 'desc', pkStr(r.pk)).matchAll(/\b(?:has|have)\s+(\d+)\s+charges\b/gi)];
      expect(
        stated.every((m) => Number(m[1]) === c.max),
        pkStr(r.pk),
      ).toBe(true);
    }
  });
});

describe('parseAttunementBy', () => {
  const P = 'srd-5e-2024:class';
  it('single class', () => {
    expect(parseAttunementBy('Requires Attunement by a Paladin')).toEqual({
      kind: 'predicate',
      predicate: { class: `${P}/paladin` },
    });
  });
  it('class list', () => {
    expect(parseAttunementBy('Requires Attunement by a Cleric, Druid, or Paladin')).toEqual({
      kind: 'predicate',
      predicate: { any: [{ class: `${P}/cleric` }, { class: `${P}/druid` }, { class: `${P}/paladin` }] },
    });
    expect(parseAttunementBy('Requires Attunement by a Cleric or Paladin')).toEqual({
      kind: 'predicate',
      predicate: { any: [{ class: `${P}/cleric` }, { class: `${P}/paladin` }] },
    });
  });
  it('spellcaster', () => {
    expect(parseAttunementBy('Requires Attunement by a Spellcaster')).toEqual({
      kind: 'predicate',
      predicate: { spellcaster: true },
    });
  });
  it('non-class forms are inexpressible (attunement.required only)', () => {
    expect(parseAttunementBy('Requires Attunement by a Dwarf or a Creature Attuned to a Belt of Dwarvenkind')).toEqual({
      kind: 'inexpressible',
    });
    expect(parseAttunementBy('Requires Attunement by a Creature of Good Alignment')).toEqual({ kind: 'inexpressible' });
    expect(parseAttunementBy('Requires Attunement by a Cleric or Dwarf')).toEqual({ kind: 'inexpressible' });
    expect(parseAttunementBy('Requires Attunement')).toBeUndefined();
  });
});

describe('attunement_detail corpus ledger', () => {
  it('every vendored attunement_detail disposes as predicate or inexpressible; counts pinned', () => {
    const rows = records
      .map((r) => ({ slug: pkSlug(pkStr(r.pk)), detail: r.fields['attunement_detail'] }))
      .filter((r): r is { slug: string; detail: string } => typeof r.detail === 'string');
    const out = rows
      .map((r) => ({ slug: r.slug, kind: parseAttunementBy(r.detail)?.kind }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    expect(out.every((o) => o.kind !== undefined)).toBe(true);
    expect(out.filter((o) => o.kind === 'predicate')).toHaveLength(18);
    expect(out.filter((o) => o.kind === 'inexpressible').map((o) => o.slug)).toEqual(['dwarven-thrower']);
  });
});

// ---- derive smoke over the REAL built pack ---------------------------------------------------------

const FP = 'srd-5e-2024';
const pack = buildPack();
const index = createContentIndex([pack]);
const rules = { restRules: index.system().restRules, hpRules: index.system().hpRules };
const WAND = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const HOLY = '22222222-2222-4222-8222-bbbbbbbbbbbb';
let seq = 0;
const ev = (type: string, payload: unknown): Event => {
  seq += 1;
  return {
    id: `018f7000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    stream: 'char:11111111-1111-7111-8111-111111111111',
    seq,
    ts: '2026-09-27T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const sheetFor = (events: Event[]) => derive(reduce(events, undefined, rules), index, rules);
const base = (): Event[] => {
  seq = 0;
  return [
    ev('character.created', {
      name: 'Wanda',
      system: '5e-2024',
      corePack: { id: FP, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'feminine',
    }),
  ];
};

describe('charged items over the real pack (derive smoke)', () => {
  const wandId = `${FP}:item/wand-of-magic-missiles`;
  interface Raw {
    type: string;
    payload: unknown;
  }
  const addWand: Raw = { type: 'item.added', payload: { instanceId: WAND, itemId: wandId, qty: 1 } };
  const build = (extra: Raw[]): Event[] => [...base(), ...[addWand, ...extra].map((e) => ev(e.type, e.payload))];
  const equip: Raw = { type: 'item.equipped', payload: { instanceId: WAND } };

  it('equipped wand materializes item:<uuid> with the parsed max; reset is dawn', () => {
    const s = sheetFor(build([equip]));
    const r = s.resources.find((x) => x.id === `item:${WAND}`);
    expect(r).toMatchObject({ id: `item:${WAND}`, name: 'Wand of Magic Missiles', used: 0, reset: 'dawn' });
    expect(r!.max.value).toBe(7);
  });

  it('inactive (unequipped, unattuned) wand materializes no resource', () => {
    expect(sheetFor(build([])).resources.filter((x) => x.id.startsWith('item:'))).toEqual([]);
  });

  it('spent charges derive as used; a dawn-reset item is NOT swept by rest events; manual restore clears', () => {
    const spent = build([equip, { type: 'resource.spent', payload: { resourceId: `item:${WAND}`, count: 3 } }]);
    const s1 = sheetFor(spent);
    expect(s1.resources.find((x) => x.id === `item:${WAND}`)!.used).toBe(3);

    // A short rest leaves dawn charges alone; a long rest restores them to full (v1: full restore
    // even for rolled-regain items — generous approximation).
    const shortEvents = propose.rest(s1, 'short');
    expect(shortEvents.some((e) => JSON.stringify(e.payload).includes(`item:${WAND}`))).toBe(false);
    const longEvents = propose.rest(s1, 'long');
    const s2 = sheetFor([...spent, ...longEvents.map((e) => ev(e.type, e.payload))]);
    expect(s2.resources.find((x) => x.id === `item:${WAND}`)!.used).toBe(0);

    // 'never' items (e.g. Scarab of Protection) are never swept by a rest.
    const scarab = '33333333-3333-4333-8333-cccccccccccc';
    const s3 = sheetFor([
      ...base(),
      ev('item.added', { instanceId: scarab, itemId: `${FP}:item/scarab-of-protection`, qty: 1 }),
      ev('item.equipped', { instanceId: scarab }),
      ev('resource.spent', { resourceId: `item:${scarab}`, count: 2 }),
    ]);
    expect(propose.rest(s3, 'long').some((e) => JSON.stringify(e.payload).includes(`item:${scarab}`))).toBe(false);
  });

  it('attunement.by resolves against the sheet: Holy Avenger is refused for a non-paladin', () => {
    const s = sheetFor([...base(), ev('item.added', { instanceId: HOLY, itemId: `${FP}:item/holy-avenger`, qty: 1 })]);
    expect(s.inventory.find((i) => i.instanceId === HOLY)?.attunementAllowed).toBe(false);
  });
});
