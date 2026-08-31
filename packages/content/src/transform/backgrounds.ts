import type { Entity } from '@hk/protocol';
import { backgroundId, featId } from '../ids.ts';
import { type FixtureRecord, pkSlug, readFixture } from '../upstream.ts';
import { baseEntity, fieldStr, pkStr } from './common.ts';

type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

interface BackgroundRow {
  abilityScores: AbilityKey[];
  skillProficiencies: string[];
  toolProficiency: string;
  originFeat: string;
}

/**
 * SRD 5.2.1 background table (hand-encoded; cross-checked in `test/species-backgrounds-feats.test.ts`
 * against the vendored BackgroundBenefit `desc` text). The fixture ships a single `magic-initiate`
 * Feat with no Cleric/Wizard variant, so both acolyte and sage point `originFeat` at it (R10) — the
 * upstream benefit desc names "Magic Initiate (Cleric)"/"Magic Initiate (Wizard)" respectively, but
 * only one Feat record exists to reference. `toolProficiency` slugs verified against the benefit
 * text: acolyte/sage -> "Calligrapher's Supplies", criminal -> "Thieves' Tools", soldier -> "Choose
 * one kind of Gaming Set".
 */
const BACKGROUND_TABLE: Record<string, BackgroundRow> = {
  acolyte: {
    abilityScores: ['int', 'wis', 'cha'],
    skillProficiencies: ['insight', 'religion'],
    toolProficiency: 'calligraphers-supplies',
    originFeat: 'magic-initiate',
  },
  criminal: {
    abilityScores: ['dex', 'con', 'int'],
    skillProficiencies: ['sleight-of-hand', 'stealth'],
    toolProficiency: 'thieves-tools',
    originFeat: 'alert',
  },
  sage: {
    abilityScores: ['con', 'int', 'wis'],
    skillProficiencies: ['arcana', 'history'],
    toolProficiency: 'calligraphers-supplies',
    originFeat: 'magic-initiate',
  },
  soldier: {
    abilityScores: ['str', 'dex', 'con'],
    skillProficiencies: ['athletics', 'intimidation'],
    toolProficiency: 'gaming-set',
    originFeat: 'savage-attacker',
  },
};

/** Groups `BackgroundBenefit` records by their `parent` Background pk, preserving fixture order. */
function loadBenefitsByParent(): Map<string, FixtureRecord[]> {
  const byParent = new Map<string, FixtureRecord[]>();
  for (const rec of readFixture('BackgroundBenefit')) {
    const parent = fieldStr(rec.fields, 'parent', rec.pk);
    const list = byParent.get(parent) ?? [];
    list.push(rec);
    byParent.set(parent, list);
  }
  return byParent;
}

/**
 * The 4 `Background.json` records as `background` entities. The structured fields
 * (`abilityScores`/`originFeat`/`skillProficiencies`/`toolProficiency`) come from `BACKGROUND_TABLE`
 * above; the upstream `desc` is empty (like Species), so the entity `description` is instead
 * composed from the benefit descs as `**<benefit name>.** <desc>` blocks, in the benefits' fixture
 * order (ability scores, skill proficiencies, tool proficiency, equipment, feat).
 */
export function transformBackgrounds(): Entity[] {
  const benefitsByParent = loadBenefitsByParent();

  return readFixture('Background').map((rec): Entity => {
    const pk = pkStr(rec.pk);
    const slug = pkSlug(pk);
    const row = BACKGROUND_TABLE[slug];
    if (!row) {
      throw new Error(`backgrounds: "${pk}" has no entry in BACKGROUND_TABLE`);
    }
    const name = fieldStr(rec.fields, 'name', pk);
    const benefits = benefitsByParent.get(pk) ?? [];
    if (benefits.length === 0) {
      throw new Error(`backgrounds: "${pk}" has no BackgroundBenefit records`);
    }
    const description = benefits
      .map((b) => `**${fieldStr(b.fields, 'name', b.pk)}.** ${fieldStr(b.fields, 'desc', b.pk)}`)
      .join('\n\n');

    return {
      type: 'background',
      ...baseEntity(backgroundId(slug), name, description),
      abilityScores: row.abilityScores,
      originFeat: featId(row.originFeat),
      skillProficiencies: row.skillProficiencies,
      toolProficiency: row.toolProficiency,
    };
  });
}
