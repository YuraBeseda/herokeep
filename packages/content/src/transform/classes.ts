import type { ClassLevelRow, Entity } from '@hk/protocol';
import { classId, featureId, subclassId } from '../ids.ts';
import { systemEntity } from '../static/system.ts';
import { type FixtureRecord, pkSlug, readFixture } from '../upstream.ts';
import { baseEntity, fieldNum, fieldOptionalStr, fieldStr, fieldStrArray, pkStr } from './common.ts';

type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** 2024 SRD subclasses are always available starting at 3rd level, for all 12 classes. */
const SUBCLASS_LEVEL = 3;

/** `hit_dice` values that occur on the 12 top-level classes; anything else is a new upstream shape. */
const HIT_DIE_RE = /^D(6|8|10|12)$/;

/** A `column_value`/`detail` string that is a plain (optionally signed) integer, e.g. `"+2"`, `"15"`. */
const NUMERIC_EXTRA_RE = /^[+-]?\d+$/;

/**
 * SRD 5.2.1 Core Traits "Primary Ability" table, hand-encoded because upstream's
 * `CharacterClass.primary_abilities` is empty for all 24 records (12 classes + 12 subclasses).
 * Verified during planning against every class's `<class>_core-traits` ClassFeature `desc`
 * ("Primary Ability" line) — every row below matched the vendored SRD text exactly.
 */
const PRIMARY_ABILITY: Record<string, AbilityKey[]> = {
  barbarian: ['str'],
  bard: ['cha'],
  cleric: ['wis'],
  druid: ['wis'],
  fighter: ['str', 'dex'],
  monk: ['dex', 'wis'],
  paladin: ['str', 'cha'],
  ranger: ['dex', 'wis'],
  rogue: ['dex'],
  sorcerer: ['cha'],
  warlock: ['cha'],
  wizard: ['int'],
};

/** Strips the leading `D` from `hit_dice` (e.g. `"D10"`) and validates it against the schema's die set. */
function parseHitDie(raw: string, pk: FixtureRecord['pk']): 6 | 8 | 10 | 12 {
  const match = HIT_DIE_RE.exec(raw);
  if (!match) {
    throw new Error(`classes: "${String(pk)}" has hit_dice "${raw}" — expected D6, D8, D10 or D12`);
  }
  return Number(match[1]) as 6 | 8 | 10 | 12;
}

/** `desc` is present (and required) on subclasses, absent entirely on top-level classes. */
function optionalDesc(fields: Record<string, unknown>): string | undefined {
  const value = fields['desc'];
  return typeof value === 'string' ? value : undefined;
}

/** The 18 core skill slugs from `systemEntity()`, used as the safe "choose nothing" `skillChoice` default. */
function allSkillSlugs(): string[] {
  const sys = systemEntity();
  if (sys.type !== 'system') throw new Error('classes: systemEntity() did not return a system entity');
  return sys.skills.map((s) => s.id);
}

interface RowBuilder {
  grants: string[];
  grantSet: Set<string>;
  extra: Record<string, number>;
}

/**
 * Assembles the `levels[]` progression rows for one class/subclass pk: groups its `ClassFeature`s'
 * `ClassFeatureItem`s by level, deduping repeat grants of the same feature at the same level (R12's
 * fighter weapon-mastery-count and monk unarmored-movement duplicates) and keeping only a numeric
 * `column_value`/`detail` (falls back to `detail` when `column_value` is null) as an `extra` entry —
 * dice notation, ordinal levels, distances and free-text details are dropped (grant-only).
 */
function buildLevels(
  classPk: string,
  featuresByParent: Map<string, FixtureRecord[]>,
  itemsByFeature: Map<string, FixtureRecord[]>,
  featureIdByPk: Map<string, string>,
): ClassLevelRow[] {
  const rowsByLevel = new Map<number, RowBuilder>();
  const classFeatures = featuresByParent.get(classPk) ?? [];

  for (const featRec of classFeatures) {
    const featPk = pkStr(featRec.pk);
    const fId = featureIdByPk.get(featPk);
    if (!fId) throw new Error(`classes: no feature entity built for "${featPk}"`);
    const featureSlug = pkSlug(featPk);

    const itemsByLevel = new Map<number, FixtureRecord[]>();
    for (const item of itemsByFeature.get(featPk) ?? []) {
      const level = fieldNum(item.fields, 'level', item.pk);
      const list = itemsByLevel.get(level) ?? [];
      list.push(item);
      itemsByLevel.set(level, list);
    }

    for (const [level, items] of itemsByLevel) {
      let row = rowsByLevel.get(level);
      if (!row) {
        row = { grants: [], grantSet: new Set(), extra: {} };
        rowsByLevel.set(level, row);
      }
      if (!row.grantSet.has(fId)) {
        row.grantSet.add(fId);
        row.grants.push(fId);
      }
      for (const item of items) {
        const raw =
          fieldOptionalStr(item.fields, 'column_value', item.pk) ?? fieldOptionalStr(item.fields, 'detail', item.pk);
        if (raw !== undefined && NUMERIC_EXTRA_RE.test(raw)) {
          row.extra[featureSlug] = Number(raw);
          break;
        }
      }
    }
  }

  return [...rowsByLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, row]): ClassLevelRow => ({
      level,
      grants: row.grants.map((feature) => ({ feature })),
      choices: [],
      ...(Object.keys(row.extra).length > 0 ? { extra: row.extra } : {}),
    }));
}

/**
 * The 12 `class`/12 `subclass` entities from `CharacterClass.json`, one `feature` entity per
 * `ClassFeature.json` record (352 total — including the 24 that grant no `ClassFeatureItem` and so
 * appear in no progression row, e.g. `core-traits`), and per-class/subclass `levels[]` progression
 * rows built from `ClassFeatureItem.json`.
 *
 * Structural fields upstream doesn't carry (`armorTraining`, `weaponProficiencies`,
 * `toolProficiencies`, real `skillChoice`) get schema-valid placeholder defaults here; Task 11/12's
 * corrections and class-detail overlays fill in the real SRD values (Fighter and Wizard first).
 * `saves` is passed through verbatim from `saving_throws`, including the fighter/monk defects Task
 * 11's overlay fixes — this transform does not correct upstream facts.
 */
export function transformClasses(): { classes: Entity[]; subclasses: Entity[]; features: Entity[] } {
  const classRecords = readFixture('CharacterClass');
  const featureRecords = readFixture('ClassFeature');
  const itemRecords = readFixture('ClassFeatureItem');

  const featuresByParent = new Map<string, FixtureRecord[]>();
  const featureIdByPk = new Map<string, string>();
  const features: Entity[] = featureRecords.map((rec): Entity => {
    const pk = pkStr(rec.pk);
    const slug = pkSlug(pk);
    const id = featureId(slug);
    featureIdByPk.set(pk, id);
    const parent = fieldStr(rec.fields, 'parent', pk);
    const list = featuresByParent.get(parent) ?? [];
    list.push(rec);
    featuresByParent.set(parent, list);
    return {
      type: 'feature',
      ...baseEntity(id, fieldStr(rec.fields, 'name', pk), fieldStr(rec.fields, 'desc', pk)),
    };
  });

  const itemsByFeature = new Map<string, FixtureRecord[]>();
  for (const rec of itemRecords) {
    const parent = fieldStr(rec.fields, 'parent', rec.pk);
    const list = itemsByFeature.get(parent) ?? [];
    list.push(rec);
    itemsByFeature.set(parent, list);
  }

  const skillChoiceFrom = allSkillSlugs();

  const classes: Entity[] = [];
  const subclasses: Entity[] = [];

  for (const rec of classRecords) {
    const pk = pkStr(rec.pk);
    const slug = pkSlug(pk);
    const name = fieldStr(rec.fields, 'name', pk);
    const desc = optionalDesc(rec.fields);
    const subclassOf = fieldOptionalStr(rec.fields, 'subclass_of', pk);
    const levels = buildLevels(pk, featuresByParent, itemsByFeature, featureIdByPk);

    if (subclassOf === undefined) {
      const primaryAbility = PRIMARY_ABILITY[slug];
      if (!primaryAbility) {
        throw new Error(`classes: no PRIMARY_ABILITY table entry for class "${slug}"`);
      }
      classes.push({
        type: 'class',
        ...baseEntity(classId(slug), name, desc),
        hitDie: parseHitDie(fieldStr(rec.fields, 'hit_dice', pk), pk),
        primaryAbility,
        // R18c: pass upstream `saving_throws` through verbatim, defects and all — Task 11's
        // corrections overlay fixes fighter/monk, cited against the SRD.
        saves: fieldStrArray(rec.fields, 'saving_throws', pk),
        armorTraining: [],
        weaponProficiencies: [],
        toolProficiencies: [],
        skillChoice: { from: skillChoiceFrom, count: 0 },
        subclassLevel: SUBCLASS_LEVEL,
        levels,
      });
    } else {
      subclasses.push({
        type: 'subclass',
        ...baseEntity(subclassId(slug), name, desc),
        class: classId(pkSlug(subclassOf)),
        levels,
      });
    }
  }

  return { classes, subclasses, features };
}
