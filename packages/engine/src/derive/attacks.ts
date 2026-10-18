import { type Choice, type Effect, type Entity, type ItemEntity, parseChoiceId, parseEntityId } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import type { Diagnostic } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import type { AbilitiesResult } from './abilities.ts';
import { type ActiveEffect, type Composition, occurrenceKey } from './composition.ts';
import { type Derived, ModifierTable } from './modifiers.ts';
import { offeredRowChoices } from './choices.ts';
import { classProficiencyGrants } from './proficiency.ts';
import { bestRowExtra } from './spellcasting.ts';

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

/**
 * Ruling 6 (phase 4 plan 11 task 7): `weapon.damage` is now `DiceOrFlat` (`ItemEntitySchema`
 * widened from `DiceSchema`), but `AttackRow.damage.dice` stays `string` on purpose — it's consumed
 * as a plain dice-notation string by apps/web (`play-tab.component.ts`'s `parseRollSpec(attack.
 * damage.dice)` and template interpolation; `entity-facts.formatters.ts`'s `formatWeaponDamage`),
 * none of which is touched by this task. A `Dice` string passes through unchanged; a `FlatDice`
 * normalizes to its bare integer (e.g. `"1"`), which `@hk/engine`'s own `parseRollSpec` (`dice/
 * parse.ts`) parses correctly as a flat MODIFIER term with zero dice — unlike the retired `"0d4+1"`
 * zero-count-die hack it replaces, which `parseRollSpec` actually REJECTS (`DICE_RE` matches `0d4`,
 * then `n <= 0` throws `DiceFormulaError`): rolling Blowgun damage in the app would have crashed.
 */
const weaponDamageDice = (damage: Weapon['damage']): string =>
  typeof damage === 'string' ? damage : String(damage.flat);

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
 * The union of "what weapon categories/kinds the character is proficient with" for attack math,
 * from the same two sources `sheet.proficiencies`' weapon rows come from (plan 13 ruling 8 — one
 * source of truth, so the attack line and the proficiency list never disagree): each class's
 * `classProficiencyGrants` weapon list (first class full, later class only its `multiclass.gains`,
 * gains-less later class full — e.g. a Wizard → Rogue gets no Rogue weapons, so no Rapier) and any
 * `proficiency.grant { kind: 'weapon' }` effect (feats/features granting a specific weapon or
 * category). Entries are category slugs like `simple`/`martial`, or a specific weapon slug/tag for
 * a narrower grant. A weapon item is proficient when its `weapon.category` is in this set, OR its
 * own entity slug is, OR any of its `tags` is.
 */
function weaponProficiencySlugs(facts: Facts, index: ContentIndex, resolvedEffects: ActiveEffect[]): Set<string> {
  const slugs = new Set<string>();
  for (const grant of classProficiencyGrants(facts, index)) for (const s of grant.weaponProficiencies) slugs.add(s);
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

const MASTERY_SLUG = 'weapon-masteries';
const isMasteryChoice = (c: Choice): boolean => parseChoiceId(c.id)?.slug === MASTERY_SLUG;

/**
 * The real ids of EVERY weapon-mastery choice the character's entities declare, in class order
 * (plan 14 task 4, ruling 7 — the order selections fill `masteryCount`'s slots): searched by
 * choice-id SLUG (`weapon-masteries`, matching the SRD pack's own `<classId>@1/weapon-masteries`),
 * not by reconstructing the id from a hardcoded class/level, since a future class or subclass could
 * declare its own mastery choice at a different level. Each `facts.classes[]` entry (order gained)
 * contributes its class's top-level and per-level-row choices, then its subclass's; row choices go
 * through `offeredRowChoices`, the same scope-aware filter that offers them (plan 14 task 1), so a
 * `later`-scoped choice is never honored for the initial class. Any other active entity (a feat, a
 * species, …) follows, in composition order, with its top-level choices.
 */
function masteryChoiceIds(facts: Facts, comp: Composition, index: ContentIndex): string[] {
  const ids: string[] = [];
  const fromEntity = (entity: Entity, initialClass: boolean) => {
    for (const c of entity.choices) if (isMasteryChoice(c)) ids.push(c.id);
    if (entity.type === 'class' || entity.type === 'subclass') {
      for (const row of entity.levels) {
        for (const c of offeredRowChoices(row.choices, initialClass, facts.decisions)) {
          if (isMasteryChoice(c)) ids.push(c.id);
        }
      }
    }
  };
  facts.classes.forEach((entry, i) => {
    const classEntity = index.get(index.resolveClassRef(entry.classId) ?? entry.classId);
    if (classEntity?.type === 'class') fromEntity(classEntity, i === 0);
    const subclassEntity = entry.subclassId !== undefined ? index.get(entry.subclassId) : undefined;
    if (subclassEntity?.type === 'subclass') fromEntity(subclassEntity, i === 0);
  });
  for (const id of comp.entities) {
    const entity = index.get(id);
    if (entity && entity.type !== 'class' && entity.type !== 'subclass') fromEntity(entity, false);
  }
  return [...new Set(ids)];
}

/**
 * Row-extra key convention (phase 4 plan 11 task 6, mirroring `spellcasting.ts`'s
 * `cantripsKnownKey`/`preparedSpellsKey` exactly): the per-level weapon-mastery COUNT a class's own
 * `ClassLevelRow.extra` may supply (SRD fighter: 3 at levels 1-3, 4 at levels 4+), preferred over
 * `mastery.grant`'s flat `count` formula when present — see `resolveMasteryCount` below.
 */
const masteryCountKey = (classSlug: string): string => `${classSlug}-weapon-mastery-count`;

/**
 * `mastery.grant.count`'s resolved numeric value for ONE active effect: `bestRowExtra` (T3's
 * row-extra-wins-over-formula pattern) on the granting entity's own row-extra table wins when the
 * granting entity is a `class` and actually supplies one at-or-below the character's level in it;
 * every other case (a non-class source — e.g. a subclass or feat, out of this task's authored
 * scope — or no row-extra yet at the current level) falls back to evaluating `count` as a formula
 * directly, which is byte-identical to today's fixed `"3"`/`"2"` behavior for every pack that never
 * authors the row extra (T8's job, not this task's).
 */
function resolveMasteryCount(
  count: string,
  source: string,
  comp: Composition,
  index: ContentIndex,
  evalFormula: (f: string) => number,
): number {
  const entity = index.get(source);
  if (entity?.type === 'class') {
    const slug = parseEntityId(source)?.slug;
    if (slug !== undefined) {
      const classLevel = comp.classLevels[source] ?? 0;
      const rowExtra = bestRowExtra(entity, classLevel, masteryCountKey(slug), evalFormula);
      if (rowExtra !== undefined) return rowExtra;
    }
  }
  return evalFormula(count);
}

/**
 * Derives one `AttackRow` per equipped weapon (inventory entries with no `itemId` — custom items —
 * contribute no row, even if `custom` happens to carry weapon-shaped data: out of this task's
 * scope, per task-11-brief.md) plus the character's `attacksPerAction` and `masteryCount` (phase 4
 * plan 11 task 6 — see `resolveMasteryCount`, undefined when no `mastery.grant` effect is active).
 * `toHit` = ability mod + proficiency bonus (when proficient) + matching `attack.bonus` effects;
 * `damage.bonus` = ability mod + matching `damage.bonus` effects. `attacksPerAction` is the max over
 * every `extraAttack.set` effect's `count`, default 1 (never itself gated per-weapon).
 */
export function deriveAttacks(
  abilities: AbilitiesResult,
  comp: Composition,
  facts: Facts,
  index: ContentIndex,
): { attacks: AttackRow[]; attacksPerAction: number; masteryCount?: number; issues: Diagnostic[] } {
  const issues: Diagnostic[] = [];
  const table = new ModifierTable();
  const mod = (ability: string) => abilities.abilities[ability]?.mod ?? 0;

  const profSlugs = weaponProficiencySlugs(facts, index, abilities.effects);

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

  // Count from the typed extra column (phase 4 plan 11 task 6). `undefined` (not `0`) when no
  // `mastery.grant` effect is active at all, so `hasMasteryGrant` below and `Sheet.masteryCount`'s
  // presence gate stay identical.
  // OWNER-FLAG (plan 14 task 4, ruling 7, PHB-sourced): the vendored multiclassing rules
  // (srd-2024_multiclassing_class-features) are SILENT on Weapon Mastery. Ruling: the count is the
  // MAX over the active `mastery.grant` effects' resolved counts — a Fighter 5 / Barbarian 3 knows 4
  // (max(4, 2)), not 6 — and it caps the selections of ALL `weapon-masteries` choices together,
  // honored in class order below. A single mastery class has one grant, so its count is unchanged.
  let masteryCount: number | undefined;
  for (const ae of abilities.effects) {
    if (ae.effect.type !== 'mastery.grant') continue;
    const contribution = resolveMasteryCount(ae.effect.count, ae.source, comp, index, evalFormula);
    masteryCount = Math.max(masteryCount ?? contribution, contribution);
  }
  const hasMasteryGrant = masteryCount !== undefined;

  // Selections are always compared as opaque strings against real entity ids (never re-derived from
  // the choice's `pick` shape) — this is why consumption here needs zero change whether the choice
  // is a `literal: 'text'` placeholder or a `query` pick, AND why an old character's plan-5
  // literal-text decision (e.g. a recorded mastery-property name like "sap") is automatically inert
  // rather than crashing (backward tolerance, phase 4 plan 11 task 6): a legacy literal never
  // resolves to an `item` entity, so it neither fills a slot nor matches a row's `entity.id` below.
  // Events are immutable, so this fallback-by-construction (not a special-cased branch) is what makes
  // an old decision safe to replay forever without a reducer/schema migration.
  // Plan 14 task 4 (ruling 7): every mastery choice's selections, in class order (each decision in
  // its recorded order; a weapon chosen twice counts once), fill at most `masteryCount` slots. A
  // selection beyond the cap is silently not applied — no diagnostic: each choice's decision is
  // individually valid against its own count (`validateSelection`).
  const masterySelections = new Set<string>();
  for (const choiceId of masteryChoiceIds(facts, comp, index)) {
    for (const sel of facts.decisions[choiceId] ?? []) {
      if (masterySelections.size >= (masteryCount ?? 0)) break;
      if (index.get(sel)?.type === 'item') masterySelections.add(sel);
    }
  }

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
          key: occurrenceKey(ae, eff.key),
          policy: 'sum-unique-key',
        });
      } else if (eff.type === 'damage.bonus' && matchesFilter(eff.filter, weapon)) {
        table.add(damageTarget, {
          source: ae.source,
          feature: ae.feature,
          kind: 'damage.bonus',
          ...amountOrFormula(eff.value),
          key: occurrenceKey(ae, eff.key),
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
      damage: { dice: weaponDamageDice(weapon.damage), bonus: damageBonus, type: weapon.damageType },
      properties: weapon.properties,
      mastery: masteryActive ? weapon.mastery : undefined,
      ability,
    });
  }

  attacks.sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));

  return { attacks, attacksPerAction, ...(masteryCount !== undefined ? { masteryCount } : {}), issues };
}
