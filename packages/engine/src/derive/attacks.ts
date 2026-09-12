import { type Effect, type ItemEntity, parseChoiceId, parseEntityId } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import type { Diagnostic } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import type { AbilitiesResult } from './abilities.ts';
import type { ActiveEffect, Composition } from './composition.ts';
import { type Derived, ModifierTable } from './modifiers.ts';

export interface AttackRow {
  instanceId: string;
  itemId: string;
  /** = the item entity id, for the UI localizer to resolve (custom weapons are out of this task's scope). */
  name: string;
  toHit: Derived<number>;
  damage: { dice: string; bonus: Derived<number>; type: string };
  properties: string[];
  /** The weapon's mastery property, surfaced only while its mastery.grant + choice conditions both hold. */
  mastery?: string;
  /** Which ability priced this row ('str' or 'dex'). */
  ability: string;
}

type Weapon = NonNullable<ItemEntity['weapon']>;
type AttackFilter = Extract<Effect, { type: 'attack.bonus' }>['filter'];

/** `{amount}` for a plain int, `{formula}` for a formula string — both legal for `ValueSchema` effects. */
const amountOrFormula = (v: number | string): { amount?: number; formula?: string } =>
  typeof v === 'number' ? { amount: v } : { formula: v };

/**
 * `attack.bonus` / `damage.bonus`'s optional `filter` gates which weapon rows a contribution applies
 * to. `filter.spell` (when `true`) marks a spell-attack-only bonus, which never applies to a weapon
 * row; every other field narrows by the weapon's own kind/category/property and is satisfied by
 * default (no `filter` at all = applies to everything, weapon and spell attacks alike).
 */
function matchesFilter(filter: AttackFilter, weapon: Weapon): boolean {
  if (!filter) return true;
  if (filter.spell) return false;
  if (filter.weapon && filter.weapon !== 'any' && filter.weapon !== weapon.kind) return false;
  if (filter.category && filter.category !== weapon.category) return false;
  if (filter.property && !weapon.properties.includes(filter.property)) return false;
  return true;
}

/**
 * Weapon proficiency isn't assembled anywhere upstream: task-9's `deriveAbilities` deliberately
 * ignores `proficiency.grant` effects whose `kind` isn't `save`/`skill` (see that file's save/skill
 * proficiency section), so the union of "what weapon categories/kinds the character is proficient
 * with" is assembled HERE, from two sources — a class's own `weaponProficiencies` (category slugs
 * like `simple`/`martial`, or a specific weapon slug/tag for a narrower grant) and any
 * `proficiency.grant { kind: 'weapon' }` effect (feats/features granting a specific weapon or
 * category). A weapon item is proficient when its `weapon.category` is in this set, OR its own
 * entity slug is, OR any of its `tags` is — the last two cover a future narrower ("proficient with
 * rapier specifically") grant that this 1b content scope doesn't exercise.
 */
function weaponProficiencySlugs(facts: Facts, index: ContentIndex, resolvedEffects: ActiveEffect[]): Set<string> {
  const slugs = new Set<string>();
  for (const c of facts.classes) {
    const classId = index.resolveClassRef(c.classId) ?? c.classId;
    const classEntity = index.get(classId);
    if (classEntity?.type === 'class') for (const s of classEntity.weaponProficiencies) slugs.add(s);
  }
  for (const ae of resolvedEffects) {
    const eff = ae.effect;
    if (eff.type === 'proficiency.grant' && eff.kind === 'weapon') slugs.add(eff.target);
  }
  return slugs;
}

function isProficientWithWeapon(item: ItemEntity, weapon: Weapon, slugs: Set<string>): boolean {
  if (slugs.has(weapon.category)) return true;
  const slug = parseEntityId(item.id)?.slug;
  if (slug !== undefined && slugs.has(slug)) return true;
  return item.tags.some((t) => slugs.has(t));
}

/** str default; dex when `finesse` and mod(dex) > mod(str); dex for ranged weapons. */
function pickAbility(weapon: Weapon, mod: (ability: string) => number): string {
  if (weapon.kind === 'ranged') return 'dex';
  if (weapon.properties.includes('finesse') && mod('dex') > mod('str')) return 'dex';
  return 'str';
}

/**
 * Finds the real id of the character's weapon-mastery choice, if any of their active entities
 * declares one — searched by choice-id SLUG (`weapon-masteries`, matching the SRD pack's own
 * `<classId>@1/weapon-masteries`), not by reconstructing the id from a hardcoded class/level, since
 * a future class or subclass could declare its own mastery choice at a different level. Mirrors
 * `content/choices.ts`'s `findChoice` traversal (top-level `choices` + per-level-row `choices` for
 * class/subclass entities), but scans every active entity instead of resolving one known id.
 */
function findMasteryChoiceId(comp: Composition, index: ContentIndex): string | undefined {
  for (const id of comp.entities) {
    const entity = index.get(id);
    if (!entity) continue;
    const direct = entity.choices.find((c) => parseChoiceId(c.id)?.slug === 'weapon-masteries');
    if (direct) return direct.id;
    if (entity.type === 'class' || entity.type === 'subclass') {
      for (const row of entity.levels) {
        const found = row.choices.find((c) => parseChoiceId(c.id)?.slug === 'weapon-masteries');
        if (found) return found.id;
      }
    }
  }
  return undefined;
}

/**
 * Derives one `AttackRow` per equipped weapon (inventory entries with no `itemId` — custom items —
 * contribute no row, even if `custom` happens to carry weapon-shaped data: out of this task's
 * scope, per task-11-brief.md) plus the character's `attacksPerAction`. `toHit` = ability mod +
 * proficiency bonus (when proficient) + matching `attack.bonus` effects; `damage.bonus` = ability
 * mod + matching `damage.bonus` effects. `attacksPerAction` is the max over every `extraAttack.set`
 * effect's `count`, default 1 (never itself gated per-weapon).
 */
export function deriveAttacks(
  abilities: AbilitiesResult,
  comp: Composition,
  facts: Facts,
  index: ContentIndex,
): { attacks: AttackRow[]; attacksPerAction: number; issues: Diagnostic[] } {
  const issues: Diagnostic[] = [];
  const table = new ModifierTable();
  const mod = (ability: string) => abilities.abilities[ability]?.mod ?? 0;

  const profSlugs = weaponProficiencySlugs(facts, index, abilities.effects);
  const masteryChoiceId = findMasteryChoiceId(comp, index);
  const masterySelections = new Set(masteryChoiceId ? (facts.decisions[masteryChoiceId] ?? []) : []);
  const hasMasteryGrant = abilities.effects.some((ae) => ae.effect.type === 'mastery.grant');

  let attacksPerAction = 1;
  for (const ae of abilities.effects) {
    if (ae.effect.type === 'extraAttack.set') attacksPerAction = Math.max(attacksPerAction, ae.effect.count);
  }

  const formulaCtx: FormulaContext = {
    level: comp.totalLevel,
    prof: abilities.prof,
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    mod,
    score: (ability) => abilities.abilities[ability]?.score.value ?? 0,
    hitDie: (slug) => {
      const classId = index.resolveClassRef(slug) ?? slug;
      const entity = index.get(classId);
      return entity?.type === 'class' ? entity.hitDie : 0;
    },
    resource: () => 0,
  };
  const evalFormula = (f: string) => evalFormulaString(f, formulaCtx);

  const attacks: AttackRow[] = [];
  for (const inv of facts.inventory) {
    if (!inv.equipped || inv.itemId === undefined) continue;
    const entity = index.get(inv.itemId);
    if (entity?.type !== 'item' || !entity.weapon) continue;
    const weapon = entity.weapon;

    const ability = pickAbility(weapon, mod);
    const proficient = isProficientWithWeapon(entity, weapon, profSlugs);

    const toHitTarget = `toHit:${inv.instanceId}`;
    const damageTarget = `damage:${inv.instanceId}`;
    for (const ae of abilities.effects) {
      const eff = ae.effect;
      if (eff.type === 'attack.bonus' && matchesFilter(eff.filter, weapon)) {
        table.add(toHitTarget, {
          source: ae.source,
          feature: ae.feature,
          kind: 'attack.bonus',
          ...amountOrFormula(eff.value),
          key: eff.key,
          policy: 'sum-unique-key',
        });
      } else if (eff.type === 'damage.bonus' && matchesFilter(eff.filter, weapon)) {
        table.add(damageTarget, {
          source: ae.source,
          feature: ae.feature,
          kind: 'damage.bonus',
          ...amountOrFormula(eff.value),
          key: eff.key,
          policy: 'sum-unique-key',
        });
      }
    }

    const toHit = table.resolve(toHitTarget, mod(ability) + (proficient ? abilities.prof : 0), evalFormula);
    const damageBonus = table.resolve(damageTarget, mod(ability), evalFormula);
    const masteryActive = hasMasteryGrant && masterySelections.has(entity.id);

    attacks.push({
      instanceId: inv.instanceId,
      itemId: entity.id,
      name: entity.id,
      toHit,
      damage: { dice: weapon.damage, bonus: damageBonus, type: weapon.damageType },
      properties: weapon.properties,
      mastery: masteryActive ? weapon.mastery : undefined,
      ability,
    });
  }

  attacks.sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));

  return { attacks, attacksPerAction, issues };
}
