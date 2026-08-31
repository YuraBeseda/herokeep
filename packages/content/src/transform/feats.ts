import type { Entity } from '@hk/protocol';
import { featId } from '../ids.ts';
import { type FixtureRecord, pkSlug, readFixture } from '../upstream.ts';
import { baseEntity, fieldOptionalStr, fieldStr, pkStr } from './common.ts';

type FeatCategory = 'origin' | 'general' | 'fightingStyle' | 'epicBoon';

/**
 * Upstream `Feat.fields.type` values (verified over all 17 records: `'Origin' | 'General' |
 * 'Fighting Style' | 'Epic Boon'`, no other value occurs) mapped to our category enum. Unknown
 * values throw so a new upstream category surfaces loudly.
 */
const CATEGORY_MAP: Record<string, FeatCategory> = {
  Origin: 'origin',
  General: 'general',
  'Fighting Style': 'fightingStyle',
  'Epic Boon': 'epicBoon',
};

/** Groups `FeatBenefit` records by their `parent` Feat pk, preserving fixture (pk) order. */
function loadBenefitsByParent(): Map<string, FixtureRecord[]> {
  const byParent = new Map<string, FixtureRecord[]>();
  for (const rec of readFixture('FeatBenefit')) {
    const parent = fieldStr(rec.fields, 'parent', rec.pk);
    const list = byParent.get(parent) ?? [];
    list.push(rec);
    byParent.set(parent, list);
  }
  return byParent;
}

/**
 * Composes a feat's `description`: the feat's own `desc` (a "You gain the following benefits."
 * stub for most feats, empty for a few — omitted when empty), then each FeatBenefit as a
 * `**<benefit name>.** <desc>` block in pk order (a handful of benefits carry an empty `name`
 * upstream, e.g. `savage-attacker_1`; those contribute just their `desc`, with no empty `**.**`
 * prefix), then a `_Prerequisite: <text>_` tail when the feat has one.
 */
function composeDescription(featRec: FixtureRecord, benefits: FixtureRecord[]): string {
  const parts: string[] = [];
  const intro = fieldStr(featRec.fields, 'desc', featRec.pk).trim();
  if (intro) parts.push(intro);
  for (const b of benefits) {
    const name = fieldStr(b.fields, 'name', b.pk).trim();
    const desc = fieldStr(b.fields, 'desc', b.pk).trim();
    parts.push(name ? `**${name}.** ${desc}` : desc);
  }
  const prerequisite = fieldOptionalStr(featRec.fields, 'prerequisite', featRec.pk);
  if (prerequisite) parts.push(`_Prerequisite: ${prerequisite}_`);
  return parts.join('\n\n');
}

/**
 * The 17 `Feat.json` records as `feat` entities. `category` comes from `CATEGORY_MAP`; the
 * description is composed per `composeDescription` above. Structured predicates for feat
 * prerequisites/effects are Phase 4 (out of scope here — the prerequisite text is kept verbatim in
 * the description tail).
 */
export function transformFeats(): Entity[] {
  const benefitsByParent = loadBenefitsByParent();

  return readFixture('Feat').map((rec): Entity => {
    const pk = pkStr(rec.pk);
    const slug = pkSlug(pk);
    const name = fieldStr(rec.fields, 'name', pk);
    const rawType = fieldStr(rec.fields, 'type', pk);
    const category = CATEGORY_MAP[rawType];
    if (!category) {
      throw new Error(`feats: "${pk}" has unknown type "${rawType}"`);
    }
    const benefits = benefitsByParent.get(pk) ?? [];
    if (benefits.length === 0) {
      throw new Error(`feats: "${pk}" has no FeatBenefit records`);
    }

    return {
      type: 'feat',
      ...baseEntity(featId(slug), name, composeDescription(rec, benefits)),
      category,
      repeatable: false,
    };
  });
}
