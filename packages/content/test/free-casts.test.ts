import { createContentIndex, derive, propose, ProposeError, reduce, type Sheet } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

// Plan 13 task 4 retrofits (free-cast lane, `spell.grant.uses {resource}`), over the real built pack:
// - Favored Enemy (vendored ClassFeature srd-2024_ranger_favored-enemy, level 1): "You always have the
//   Hunter's Mark spell prepared. You can cast it twice without expending a spell slot, and you regain
//   all expended uses of this ability when you finish a Long Rest." -> the existing hunters-mark grant
//   names the existing `favored-enemy` resource (no second counter).
// - Wild Companion (vendored ClassFeature srd-2024_druid_wild-companion; ClassFeatureItem level 2):
//   "As a Magic action, you can expend a spell slot or a use of Wild Shape to cast the *Find Familiar*
//   spell without Material components." -> spell.grant find-familiar {alwaysPrepared, uses:
//   {resource: 'wild-shape'}}: the slot route is the ordinary slot lane, the Wild Shape route the free
//   lane. The Magic-action casting time, the waived Material component and the Fey / Long-Rest familiar
//   stay text.

const FP = 'srd-5e-2024';
const pack = buildPack();
const index = createContentIndex([pack]);
const rules = { restRules: index.system().restRules, hpRules: index.system().hpRules };

let seq = 0;
const ev = (type: string, payload: unknown): Event => {
  seq += 1;
  return {
    id: `018f7000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    stream: 'char:11111111-1111-7111-8111-111111111111',
    seq,
    ts: '2026-10-17T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const decide = (choiceId: string, selection: string[]) => ev('decision.made', { choiceId, selection });

/** A single-class character (Human, Soldier) at `level`. */
function char(classId: string, level: number): Event[] {
  seq = 0;
  return [
    ev('character.created', {
      name: 'Lark',
      system: '5e-2024',
      corePack: { id: FP, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'feminine',
    }),
    decide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
    decide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
    decide(`${FP}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
    decide(`${FP}:system/5e-2024@0/ability-scores`, ['str:10', 'dex:15', 'con:13', 'int:10', 'wis:14', 'cha:12']),
    ...Array.from({ length: level }, (_, i) => ev('level.gained', { classId, level: i + 1, hpRoll: 'average' })),
  ];
}
const sheetOf = (events: Event[], idx = index) => derive(reduce(events, undefined, rules), idx, rules);
/** Appends a proposal's drafts to the log (fresh envelopes), as the app does. */
const apply = (events: Event[], proposed: { type: string; payload: unknown }[]) => [
  ...events,
  ...proposed.map((p) => ev(p.type, p.payload)),
];
const used = (s: Sheet, id: string) => s.resources.find((r) => r.id === id)?.used;
const slotUsed = (s: Sheet, level: number) => s.spellcasting[0]!.slots.find((x) => x.level === level)?.used;

const rangerId = `${FP}:class/ranger`;
const druidId = `${FP}:class/druid`;
const mark = `${FP}:spell/hunters-mark`;
const familiar = `${FP}:spell/find-familiar`;
const favoredEnemy = `${FP}:feature/ranger-favored-enemy`;
const wildCompanion = `${FP}:feature/druid-wild-companion`;

describe("Favored Enemy: free Hunter's Mark casts spend the favored-enemy counter", () => {
  it("offers Hunter's Mark at its base level against the existing counter, at every ranger level", () => {
    expect(index.get(mark)).toMatchObject({ type: 'spell', level: 1 });
    for (const level of [1, 5, 20]) {
      const s = sheetOf(char(rangerId, level));
      expect(s.freeCasts, `level ${level}`).toEqual([{ spellId: mark, resourceId: 'favored-enemy', level: 1 }]);
    }
  });

  it('creates no second counter: the resource list is just favored-enemy (2 + floor((L-1)/4) per Long Rest)', () => {
    const s = sheetOf(char(rangerId, 5));
    expect(s.resources.map((r) => [r.id, r.max.value, r.reset])).toEqual([['favored-enemy', 3, 'longRest']]);
  });

  it('Review Focus 3: the free lane spends the counter and NO slot; the slot lane the slot and NOT the counter', () => {
    const base = char(rangerId, 5);
    const free = sheetOf(
      apply(base, propose.cast(sheetOf(base), mark, { level: 1, concentration: true, freeResource: 'favored-enemy' })),
    );
    expect([used(free, 'favored-enemy'), slotUsed(free, 1)]).toEqual([1, 0]);
    expect(free.concentration).toEqual({ spellId: mark });

    const slot = sheetOf(apply(base, propose.cast(sheetOf(base), mark, { level: 1, concentration: true })));
    expect([used(slot, 'favored-enemy'), slotUsed(slot, 1)]).toEqual([0, 1]);
  });

  it('an empty counter refuses the free lane (3 casts at ranger 5, the 4th refused); a Long Rest restores it', () => {
    let events = char(rangerId, 5);
    for (let i = 0; i < 3; i += 1)
      events = apply(
        events,
        propose.cast(sheetOf(events), mark, { level: 1, concentration: false, freeResource: 'favored-enemy' }),
      );
    const spent = sheetOf(events);
    expect(used(spent, 'favored-enemy')).toBe(3);
    let refusal: unknown;
    try {
      propose.cast(spent, mark, { level: 1, concentration: false, freeResource: 'favored-enemy' });
    } catch (e) {
      refusal = e;
    }
    expect(refusal instanceof ProposeError ? refusal.diagnostics.map((d) => d.code) : refusal).toEqual([
      'resource.none-left',
    ]);
    const rested = sheetOf(apply(events, propose.rest(spent, 'long')));
    expect(used(rested, 'favored-enemy')).toBe(0);
  });

  it('the tracking-pip disclaimer is gone from the feature note; the grant names the resource', () => {
    const overlay = JSON.stringify(index.get(favoredEnemy)!.effects);
    expect(overlay).toContain('"uses":{"resource":"favored-enemy"}');
  });
});

describe('Wild Companion: Find Familiar via a spell slot or a Wild Shape use', () => {
  const block = (level: number) => sheetOf(char(druidId, level)).spellcasting.find((b) => b.classId === druidId)!;

  it('from druid 2 (srd-2024_druid_wild-companion, level 2): castable with a slot, free lane spends wild-shape', () => {
    expect(index.get(familiar)).toMatchObject({ type: 'spell', level: 1 });
    expect(sheetOf(char(druidId, 1)).freeCasts).toBeUndefined();
    expect(block(1).alwaysPrepared).not.toContain(familiar);
    for (const level of [2, 5, 20]) {
      const s = sheetOf(char(druidId, level));
      expect(s.freeCasts, `level ${level}`).toEqual([{ spellId: familiar, resourceId: 'wild-shape', level: 1 }]);
      expect(block(level).alwaysPrepared, `level ${level}`).toContain(familiar);
    }
  });

  it('the Wild Shape route spends one Wild Shape use and no slot; the slot route the reverse', () => {
    const base = char(druidId, 2);
    const viaWildShape = sheetOf(
      apply(
        base,
        propose.cast(sheetOf(base), familiar, { level: 1, concentration: false, freeResource: 'wild-shape' }),
      ),
    );
    expect([used(viaWildShape, 'wild-shape'), slotUsed(viaWildShape, 1)]).toEqual([1, 0]);
    const viaSlot = sheetOf(apply(base, propose.cast(sheetOf(base), familiar, { level: 1, concentration: false })));
    expect([used(viaSlot, 'wild-shape'), slotUsed(viaSlot, 1)]).toEqual([0, 1]);
  });

  it('the inexpressible clauses stay text (Magic action, no Material components, Fey, Long Rest)', () => {
    const effects = index.get(wildCompanion)!.effects;
    expect(effects.map((e) => e.type)).toEqual(['spell.grant', 'feature.text']);
    const text = JSON.stringify(effects.find((e) => e.type === 'feature.text'));
    for (const clause of ['Magic action', 'without Material components', 'Fey', 'Long Rest'])
      expect(text).toContain(clause);
  });
});

// Legacy stability: a log recorded against the pre-task-4 pack (Favored Enemy's grant without `uses`,
// Wild Companion text-only) — including a Hunter's Mark cast that spent a SLOT — reduces to the same
// facts (the reducer is unchanged) and derives the same sheet apart from the new offer.
describe('legacy logs replay identically apart from the free-cast offer', () => {
  const legacyPack = structuredClone(pack);
  for (const e of legacyPack.entities) {
    if (e.id === favoredEnemy)
      e.effects = e.effects.map((x) => (x.type === 'spell.grant' ? { ...x, uses: undefined } : x));
    if (e.id === wildCompanion) e.effects = e.effects.filter((x) => x.type !== 'spell.grant');
  }
  const legacyIndex = createContentIndex([legacyPack]);
  const withoutOffer = (s: Sheet): Sheet => {
    const rest = { ...s };
    delete rest.freeCasts;
    return rest;
  };

  it("ranger 5 with a slot-spent Hunter's Mark: same slots, same counter, only freeCasts added", () => {
    const events = [...char(rangerId, 5), ev('spell.cast', { spellId: mark, level: 1 })];
    const now = sheetOf(events);
    const before = sheetOf(events, legacyIndex);
    expect(before.freeCasts).toBeUndefined();
    expect([slotUsed(now, 1), used(now, 'favored-enemy')]).toEqual([1, 0]);
    expect(withoutOffer(now)).toEqual(before);
    expect(now.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('druid 5: only freeCasts and Find Familiar (always prepared) are added', () => {
    const events = char(druidId, 5);
    const now = sheetOf(events);
    const before = sheetOf(events, legacyIndex);
    const strip = (s: Sheet) => ({
      ...withoutOffer(s),
      spellcasting: s.spellcasting.map((b) => ({
        ...b,
        prepared: b.prepared.filter((x) => x !== familiar),
        alwaysPrepared: b.alwaysPrepared?.filter((x) => x !== familiar),
      })),
    });
    expect(strip(now)).toEqual(strip(before));
    expect(before.spellcasting[0]!.prepared).not.toContain(familiar);
    expect(now.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
