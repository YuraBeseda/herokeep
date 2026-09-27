// packages/content/test/static.test.ts
import { SystemEntitySchema, parseEntityId } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION, packManifest } from '../src/static/attribution.ts';
import { languageEntities } from '../src/static/languages.ts';
import { systemEntity } from '../src/static/system.ts';

describe('system entity', () => {
  const rawSys = systemEntity();
  // Narrowed once, at describe-eval time, so every `it()` below (not just this first one) sees
  // `sys` typed as the `system` entity variant instead of the general `Entity` union — the original
  // per-`it` guard didn't carry the narrowing across sibling `it()` closures.
  if (rawSys.type !== 'system') throw new Error();
  const sys = rawSys;

  it('validates and carries the 2024 shape', () => {
    const r = SystemEntitySchema.safeParse(sys);
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true);
    expect(sys.abilities.map((a) => a.id)).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
    expect(sys.skills).toHaveLength(18);
    expect(sys.skills.find((s) => s.id === 'sleight-of-hand')?.ability).toBe('dex');
    expect(sys.compositionSlots.map((s) => s.id)).toEqual(['species', 'background', 'class']);
    expect(sys.tables.xp).toHaveLength(20);
    expect(sys.tables.xp[4]).toBe(6500);
    expect(sys.tables.xp[19]).toBe(355000);
    expect(sys.tables.proficiency).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]);
    expect(sys.tables.spellSlots.full).toHaveLength(20);
    expect(sys.tables.spellSlots.full?.[0]).toEqual([2]);
    expect(sys.tables.spellSlots.full?.[4]).toEqual([4, 3, 2]);
    expect(sys.tables.spellSlots.full?.[19]).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
    expect(sys.abilityGeneration.standardArray).toEqual([15, 14, 13, 12, 10, 8]);
    expect(sys.abilityGeneration.pointBuy).toEqual({
      budget: 27,
      min: 8,
      max: 15,
      costs: { '8': 0, '9': 1, '10': 2, '11': 3, '12': 4, '13': 5, '14': 7, '15': 9 },
    });
    expect(sys.attunementMax).toBe(3);
    expect(sys.conditions).toHaveLength(15);
  });

  it('carries the real half/third/pact spell-slot tables (phase 4 plan 11 task 7, ruling 2)', () => {
    // Half-caster (Paladin/Ranger): vendored verbatim from ClassFeatureItem.json's
    // `srd-2024_paladin_slots-1st..5th` rows (cross-checked identical to Ranger's own).
    expect(sys.tables.spellSlots.half).toHaveLength(20);
    expect(sys.tables.spellSlots.half?.[0]).toEqual([2]);
    expect(sys.tables.spellSlots.half?.[4]).toEqual([4, 2]);
    expect(sys.tables.spellSlots.half?.[19]).toEqual([4, 3, 3, 3, 2]);

    // Third-caster (Eldritch Knight/Arcane Trickster): OWNER-FLAG, SRD-silent — this vendored SRD
    // 5.2.1 snapshot has neither subclass (Fighter's only subclass here is Champion, Rogue's is
    // Thief; verified via CharacterClass.json's `subclass_of` links), so there is no vendored text
    // to cite. Authored from public SRD/PHB knowledge (unchanged since 2014).
    expect(sys.tables.spellSlots.third).toHaveLength(20);
    expect(sys.tables.spellSlots.third?.[0]).toEqual([]);
    expect(sys.tables.spellSlots.third?.[2]).toEqual([2]);
    expect(sys.tables.spellSlots.third?.[19]).toEqual([4, 3, 3, 1]);

    // Pact Magic (Warlock): vendored verbatim from ClassFeatureItem.json's
    // `srd-2024_warlock_spell-slots` (count) and `srd-2024_warlock_slot-level` (slot level) rows,
    // encoded as sparse rows (T3's convention: exactly one nonzero index = the slot level).
    expect(sys.tables.spellSlots.pact).toHaveLength(20);
    expect(sys.tables.spellSlots.pact?.[0]).toEqual([1]);
    expect(sys.tables.spellSlots.pact?.[1]).toEqual([2]);
    expect(sys.tables.spellSlots.pact?.[2]).toEqual([0, 2]);
    expect(sys.tables.spellSlots.pact?.[4]).toEqual([0, 0, 2]);
    expect(sys.tables.spellSlots.pact?.[16]).toEqual([0, 0, 0, 0, 4]);
    expect(sys.tables.spellSlots.pact?.[19]).toEqual([0, 0, 0, 0, 4]);
  });

  it('multiclassSlots.slots is the real vendored 20-row Multiclass Spellcaster table, identical to full-caster', () => {
    // Cited verbatim from `Rule.json`'s `srd-2024_multiclassing_spellcasting` passage; the vendored
    // table is byte-identical to the single-class full-caster progression, so it reuses the SAME
    // data (not a coincidence — 5e's multiclass table has always mirrored a full caster's own table).
    expect(sys.tables.multiclassSlots?.slots).toEqual(sys.tables.spellSlots.full);
    expect(sys.tables.multiclassSlots?.weights.full).toEqual({ divisor: 1, rounding: 'down' });
    expect(sys.tables.multiclassSlots?.weights.half).toEqual({ divisor: 2, rounding: 'up' });
    // OWNER-FLAG: SRD-silent (see task-1/task-3 reports) — this content pack's own choice, not cited.
    expect(sys.tables.multiclassSlots?.weights.third).toEqual({ divisor: 3, rounding: 'down' });
  });

  it('multiclass.prerequisites covers all 12 classes (ruling 2/T2 carry): single-ability classes cited, dual-ability OWNER-FLAGGED', () => {
    const prereqs = sys.multiclass?.prerequisites;
    expect(prereqs && Object.keys(prereqs)).toHaveLength(12);
    // A variable-keyed lookup (not a string-literal property access) satisfies both tsc's
    // `noPropertyAccessFromIndexSignature` (bracket notation required for an index-signature type)
    // and eslint's `dot-notation` rule (which only flags LITERAL bracket access) at once.
    const at = (slug: string) => prereqs?.[slug];
    // Single primary ability — cited verbatim from Rule.json's `srd-2024_multiclassing_prerequisties`
    // ("a score of at least 13 in the primary ability of the new class") + the PRIMARY_ABILITY table.
    expect(at('wizard')).toEqual({ ability: { int: { gte: 13 } } });
    expect(at('barbarian')).toEqual({ ability: { str: { gte: 13 } } });
    // Dual primary ability — OWNER-FLAG (public SRD/PHB knowledge, not in the vendored passage):
    // Fighter is an OR (either ability qualifies); Monk/Paladin/Ranger are AND (both required).
    expect(at('fighter')).toEqual({
      any: [{ ability: { str: { gte: 13 } } }, { ability: { dex: { gte: 13 } } }],
    });
    expect(at('monk')).toEqual({
      all: [{ ability: { dex: { gte: 13 } } }, { ability: { wis: { gte: 13 } } }],
    });
  });

  it('encumbrance carries standard and variant carry-capacity data (T5 carry, SRD-silent, OWNER-FLAGGED)', () => {
    expect(sys.encumbrance?.standard?.capacity).toBe('score(str) * 15');
    expect(sys.encumbrance?.variant?.capacity).toBe('score(str) * 15');
    expect(sys.encumbrance?.variant?.thresholds).toEqual([
      { capacity: 'score(str) * 5', state: 'encumbered', speedPenalty: 10 },
      { capacity: 'score(str) * 10', state: 'heavilyEncumbered', speedPenalty: 20 },
    ]);
  });
});

describe('languages and manifest', () => {
  it('ships the SRD language list as entities', () => {
    const langs = languageEntities();
    expect(langs.length).toBeGreaterThanOrEqual(16);
    for (const l of langs) expect(parseEntityId(l.id)?.type).toBe('language');
    expect(langs.map((l) => l.name)).toContain('Common');
    expect(langs.map((l) => l.name)).toContain('Draconic');
  });
  it('attribution is the exact SRD 5.2.1 statement', () => {
    expect(ATTRIBUTION.startsWith('This work includes material from the System Reference Document 5.2.1')).toBe(true);
    expect(ATTRIBUTION).toContain('https://www.dndbeyond.com/srd');
    expect(ATTRIBUTION).toContain('https://creativecommons.org/licenses/by/4.0/legalcode');
    expect(packManifest()).toMatchObject({
      format: 1,
      id: 'srd-5e-2024',
      version: '0.1.0',
      kind: 'core',
      system: '5e-2024',
      license: 'CC-BY-4.0',
      locale: 'en',
    });
  });
});
