import type { Entity } from '@hk/protocol';
import { abilityId, conditionId, ruleId, skillId } from '../ids.ts';
import { systemEntity } from '../static/system.ts';
import { type FixtureRecord, pkSlug, readFixture } from '../upstream.ts';
import { baseEntity } from './common.ts';

/** Splits a slug on `-` and capitalizes each word, e.g. `blinded` -> `Blinded`. */
function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** All five glossary fixtures use string pks; this narrows the shared `string | number` pk type. */
function pkStr(pk: FixtureRecord['pk']): string {
  if (typeof pk !== 'string') {
    throw new Error(`glossary: expected a string pk, got ${typeof pk} (${String(pk)})`);
  }
  return pk;
}

function fieldStr(fields: Record<string, unknown>, key: string, pk: FixtureRecord['pk']): string {
  const value = fields[key];
  if (typeof value !== 'string') {
    throw new Error(`glossary: fixture "${String(pk)}" is missing a string field "${key}"`);
  }
  return value;
}

function fieldNum(fields: Record<string, unknown>, key: string, pk: FixtureRecord['pk']): number {
  const value = fields[key];
  if (typeof value !== 'number') {
    throw new Error(`glossary: fixture "${String(pk)}" is missing a numeric field "${key}"`);
  }
  return value;
}

/**
 * The 6 core abilities as `ability` entities. Name and abbreviation come from `systemEntity()`'s
 * `abilities` table (the source of truth); the slug is the full lowercase name (e.g. `charisma`).
 */
export function transformAbilities(): Entity[] {
  const sys = systemEntity();
  if (sys.type !== 'system') throw new Error('systemEntity() did not return a system entity');
  const namesByKey = new Map(sys.abilities.map((a) => [a.id, a.name]));
  return readFixture('AbilityDescription').map((rec): Entity => {
    const abbreviation = pkSlug(pkStr(rec.pk));
    const describes = fieldStr(rec.fields, 'describes', rec.pk);
    if (describes !== abbreviation) {
      throw new Error(
        `transformAbilities: fixture "${rec.pk}" describes "${describes}" but its pk implies "${abbreviation}"`,
      );
    }
    const name = namesByKey.get(abbreviation);
    if (!name) {
      throw new Error(
        `transformAbilities: ability key "${abbreviation}" (pk ${rec.pk}) is not in systemEntity().abilities`,
      );
    }
    return {
      type: 'ability',
      ...baseEntity(abilityId(name.toLowerCase()), name, fieldStr(rec.fields, 'desc', rec.pk)),
      abbreviation,
    };
  });
}

/**
 * The 18 core skills as `skill` entities. Name and ability come from `systemEntity()`'s `skills`
 * table (the source of truth); throws if a fixture skill is missing from that table or vice versa.
 */
export function transformSkills(): Entity[] {
  const sys = systemEntity();
  if (sys.type !== 'system') throw new Error('systemEntity() did not return a system entity');
  const bySlug = new Map(sys.skills.map((s) => [s.id, s]));
  const fixtures = readFixture('SkillDescription');
  const fixtureSlugs = new Set(fixtures.map((rec) => pkSlug(pkStr(rec.pk))));
  for (const skill of sys.skills) {
    if (!fixtureSlugs.has(skill.id)) {
      throw new Error(
        `transformSkills: systemEntity().skills has "${skill.id}" but no matching SkillDescription fixture`,
      );
    }
  }
  return fixtures.map((rec): Entity => {
    const slug = pkSlug(pkStr(rec.pk));
    const describes = fieldStr(rec.fields, 'describes', rec.pk);
    if (describes !== slug) {
      throw new Error(
        `transformSkills: fixture "${rec.pk}" describes "${describes}" but its pk implies slug "${slug}"`,
      );
    }
    const row = bySlug.get(slug);
    if (!row) {
      throw new Error(`transformSkills: fixture skill "${slug}" (pk ${rec.pk}) is not in systemEntity().skills`);
    }
    return {
      type: 'skill',
      ...baseEntity(skillId(slug), row.name, fieldStr(rec.fields, 'desc', rec.pk)),
      ability: row.ability,
    };
  });
}

/**
 * The 15 core conditions as `condition` entities, Title-Cased from the slug; `exhaustion` gets
 * `levels: 6`. Asserts the emitted id set matches `systemEntity().conditions` exactly.
 */
export function transformConditions(): Entity[] {
  const sys = systemEntity();
  if (sys.type !== 'system') throw new Error('systemEntity() did not return a system entity');
  const entities = readFixture('ConditionDescription').map((rec): Entity => {
    const slug = pkSlug(pkStr(rec.pk));
    const describes = fieldStr(rec.fields, 'describes', rec.pk);
    if (describes !== slug) {
      throw new Error(
        `transformConditions: fixture "${rec.pk}" describes "${describes}" but its pk implies slug "${slug}"`,
      );
    }
    return {
      type: 'condition',
      ...baseEntity(conditionId(slug), titleCase(slug), fieldStr(rec.fields, 'desc', rec.pk)),
      ...(slug === 'exhaustion' ? { levels: 6 } : {}),
    };
  });
  const emittedIds = new Set(entities.map((e) => e.id));
  for (const id of sys.conditions) {
    if (!emittedIds.has(id)) {
      throw new Error(
        `transformConditions: systemEntity().conditions expects "${id}" but no ConditionDescription fixture produced it`,
      );
    }
  }
  if (emittedIds.size !== sys.conditions.length) {
    throw new Error(
      `transformConditions: produced ${emittedIds.size} conditions but systemEntity().conditions lists ${sys.conditions.length}`,
    );
  }
  return entities;
}

/**
 * Damage types have no schema entity type of their own (R3): they are glossary text, so this
 * emits them as `rule` entities named `Damage type: <Name>` with ids `rule/damage-type-<slug>`
 * (namespaced so they cannot collide with Rule.json's own rule slugs) and `tags: ['damage-type']`.
 */
export function transformDamageTypes(): Entity[] {
  const sys = systemEntity();
  if (sys.type !== 'system') throw new Error('systemEntity() did not return a system entity');
  const knownSlugs = new Set(sys.damageTypes);
  return readFixture('DamageTypeDescription').map((rec): Entity => {
    const slug = pkSlug(pkStr(rec.pk));
    const describes = fieldStr(rec.fields, 'describes', rec.pk);
    if (describes !== slug) {
      throw new Error(
        `transformDamageTypes: fixture "${rec.pk}" describes "${describes}" but its pk implies slug "${slug}"`,
      );
    }
    if (!knownSlugs.has(slug)) {
      throw new Error(
        `transformDamageTypes: damage type "${slug}" (pk ${rec.pk}) is not in systemEntity().damageTypes`,
      );
    }
    return {
      type: 'rule',
      ...baseEntity(
        ruleId(`damage-type-${slug}`),
        `Damage type: ${titleCase(slug)}`,
        fieldStr(rec.fields, 'desc', rec.pk),
        ['damage-type'],
      ),
    };
  });
}

/**
 * The 56 `Rule.json` entries as `rule` entities, tagged `ruleset:<slug>` by their RuleSet grouping
 * and emitted sorted by ruleset slug then upstream `index` for stable output.
 */
export function transformRules(): Entity[] {
  const records = readFixture('Rule').map((rec) => ({
    rec,
    rulesetSlug: pkSlug(fieldStr(rec.fields, 'ruleset', rec.pk)),
    index: fieldNum(rec.fields, 'index', rec.pk),
  }));
  records.sort((a, b) =>
    a.rulesetSlug === b.rulesetSlug ? a.index - b.index : a.rulesetSlug < b.rulesetSlug ? -1 : 1,
  );
  return records.map(({ rec, rulesetSlug }): Entity => {
    const slug = pkSlug(pkStr(rec.pk));
    const name = fieldStr(rec.fields, 'name', rec.pk);
    return {
      type: 'rule',
      ...baseEntity(ruleId(slug), name, fieldStr(rec.fields, 'desc', rec.pk), [`ruleset:${rulesetSlug}`]),
    };
  });
}
