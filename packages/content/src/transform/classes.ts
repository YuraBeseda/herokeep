import { DiceSchema, ExtraTextSchema, type ClassLevelRow, type Entity } from '@hk/protocol';
import { classId, featureId, subclassId } from '../ids.ts';
import { MULTICLASS_PREREQUISITES, systemEntity } from '../static/system.ts';
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
 * Ruling 5's per-class multiclass proficiency GAINS — phase 4 plan 11 task 7 (T2 carry #3). ⚠️
 * OWNER-FLAG, 2024-SRD-silent: `Rule.json`'s own `srd-2024_multiclassing_proficiencies` entry is
 * prose only ("you gain only some of the new class's starting proficiencies, as detailed in each
 * class's description") — the per-class breakdown table itself isn't vendored anywhere in this
 * snapshot (verified: no `ClassFeature` entry mentions "multiclass" at all). Authored from public SRD
 * 5.2.1 knowledge (the 2014→2024-unchanged multiclass proficiencies table), for the five slice-1
 * classes only (Fighter, Wizard, Barbarian, Cleric, Warlock) — `gains` is always a SUBSET-OR-EQUAL of
 * that class's own full `armorTraining`/`weaponProficiencies` (the engine APPLIES it as a restriction,
 * not a union, for any class beyond the character's first — `packages/engine/src/derive/index.ts`'s
 * `deriveProficiencies`). None of the five grants a bonus skill choice when multiclassed in (the 2024
 * table reserves that for Bard/Rogue, neither in this slice — confirmed absent from the vendored
 * prose too), so every entry's `skillChoiceCount` is `0`.
 */
const MULTICLASS_GAINS: Record<
  string,
  { armorTraining: string[]; weaponProficiencies: string[]; skillChoiceCount?: number }
> = {
  fighter: { armorTraining: ['light', 'medium', 'shields'], weaponProficiencies: ['simple', 'martial'] },
  wizard: { armorTraining: [], weaponProficiencies: [] },
  barbarian: { armorTraining: ['shields'], weaponProficiencies: ['simple', 'martial'] },
  cleric: { armorTraining: ['light', 'medium', 'shields'], weaponProficiencies: [] },
  warlock: { armorTraining: ['light'], weaponProficiencies: ['simple'] },
  // Plan 12 task 7. OWNER-FLAG, 2024-SRD-silent (same as every entry above): the vendored multiclassing
  // Rule `srd-2024_multiclassing_proficiencies` is prose only ("you gain only some of the new class's
  // starting proficiencies"); the per-class table is authored from public SRD 5.2.1 knowledge: Rogue
  // gains Light armor, Thieves' Tools, and ONE skill from the Rogue list (the table reserves a bonus
  // skill for Bard/Rogue) -- no weapons. Thieves' Tools has no `gains` field (schema carries armor,
  // weapons, skill count only), so it is not representable here; flagged.
  rogue: { armorTraining: ['light'], weaponProficiencies: [], skillChoiceCount: 1 },
};

/**
 * Ruling 7 (phase 4 plan 11 task 7): classifies a raw `column_value`/`detail` string into the
 * `ExtraValue` shape it should land as — a plain integer (existing behavior, unchanged), dice
 * notation (e.g. Sneak Attack's "1d6"..."10d6", `DiceSchema`), or short plain text (e.g. an ordinal
 * column like "1st"/"5th", `ExtraTextSchema`) — or `undefined` when it matches none of the three
 * (still dropped, same as before this task). Order matters: integer-shaped strings are ALWAYS
 * numbers (checked first, matching the pre-existing behavior byte-for-byte — a bare digit string like
 * "5" would also satisfy `ExtraTextSchema`'s charset, so this ordering is what keeps every existing
 * numeric row extra, e.g. `wizard-prepared-spells`, unchanged).
 */
function classifyExtraValue(raw: string): number | string | undefined {
  if (NUMERIC_EXTRA_RE.test(raw)) return Number(raw);
  if (DiceSchema.safeParse(raw).success) return raw;
  if (ExtraTextSchema.safeParse(raw).success) return raw;
  return undefined;
}

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
  extra: Record<string, number | string>;
}

/**
 * Assembles the `levels[]` progression rows for one class/subclass pk: groups its `ClassFeature`s'
 * `ClassFeatureItem`s by level, deduping repeat grants of the same feature at the same level (R12's
 * fighter weapon-mastery-count and monk unarmored-movement duplicates) and keeping a typed
 * `column_value`/`detail` (falls back to `detail` when `column_value` is null) as an `extra` entry —
 * ruling 7 (phase 4 plan 11 task 7): a plain integer, dice notation (e.g. Sneak Attack's "1d6"), or
 * short plain text (e.g. an ordinal column, "1st") are ALL kept now (`classifyExtraValue`), landing
 * as `ExtraValue` extras for every class/subclass (harmless for ones nothing yet mechanizes); only a
 * value matching none of those three shapes (a longer free-text detail, an out-of-range dice term,
 * etc.) is still dropped.
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
        const value = raw === undefined ? undefined : classifyExtraValue(raw);
        if (value !== undefined) {
          row.extra[featureSlug] = value;
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
        // Ruling 2/T2 carry (phase 4 plan 11 task 7): the five slice-1 classes' own `multiclass`
        // field. `prerequisites` reuses the SAME predicate `system.multiclass.prerequisites` carries
        // for this class (single source of truth, `MULTICLASS_PREREQUISITES` in `static/system.ts`) —
        // required alongside `gains` by `ClassEntitySchema.multiclass`'s shape; the SYSTEM map is the
        // gating authority `advancement.ts` actually reads, this field is validation/reference-
        // collection only (`content/refs.ts`) — see doc-04's "system map vs class-entity field" split.
        ...(MULTICLASS_GAINS[slug]
          ? {
              multiclass: {
                prerequisites: MULTICLASS_PREREQUISITES[slug]!,
                gains: {
                  armorTraining: MULTICLASS_GAINS[slug].armorTraining,
                  weaponProficiencies: MULTICLASS_GAINS[slug].weaponProficiencies,
                  skillChoiceCount: MULTICLASS_GAINS[slug].skillChoiceCount ?? 0,
                },
              },
            }
          : {}),
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
