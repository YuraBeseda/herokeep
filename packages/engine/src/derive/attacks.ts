import { type Choice, type Effect, type Entity, type ItemEntity, parseChoiceId, parseEntityId } from '@hk/protocol';
import { findChoice } from '../content/choices.ts';
import type { ContentIndex } from '../content/index.ts';
import type { Diagnostic } from '../diagnostics.ts';
import { type FormulaContext, evalFormulaString } from '../formula/evaluate.ts';
import type { Facts } from '../reduce/facts.ts';
import type { AbilitiesResult } from './abilities.ts';
import { resolveChoiceCount } from './choice-count.ts';
import { type ActiveEffect, type Composition, occurrenceKey } from './composition.ts';
import { baseParts, type Derived, ModifierTable } from './modifiers.ts';
import { offeredRowChoices } from './choices.ts';
import { classProficiencyGrants, proficiencyBonus } from './proficiency.ts';
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

/** One weapon-mastery choice and, when a class (or its subclass) declares it, that class's position
 * in `facts.classes` (0 = the initial class); `undefined` for any other owner (a feat, a species…). */
interface MasteryChoice {
  id: string;
  classIndex: number | undefined;
}

/**
 * EVERY weapon-mastery choice the character's entities declare, in class order (plan 14 task 4,
 * ruling 7 — the order selections fill `masteryCount`'s slots): searched by choice-id SLUG
 * (`weapon-masteries`, matching the SRD pack's own `<classId>@1/weapon-masteries`), not by
 * reconstructing the id from a hardcoded class/level, since a future class or subclass could
 * declare its own mastery choice at a different level. Each `facts.classes[]` entry (order gained)
 * contributes its class's top-level and per-level-row choices, then its subclass's; row choices go
 * through `offeredRowChoices`' scope filter (plan 14 task 1) — WITHOUT its count hook, so granting
 * never depends on what is offered — and a `later`-scoped choice is never honored for the initial
 * class. Any other active entity (a feat, a species, …) follows, in composition order, with its
 * top-level choices. Each id once, at its first position.
 */
function masteryChoices(facts: Facts, comp: Composition, index: ContentIndex): MasteryChoice[] {
  const found: MasteryChoice[] = [];
  const seen = new Set<string>();
  const push = (id: string, classIndex: number | undefined) => {
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ id, classIndex });
  };
  const fromEntity = (entity: Entity, classIndex: number | undefined) => {
    for (const c of entity.choices) if (isMasteryChoice(c)) push(c.id, classIndex);
    if (entity.type === 'class' || entity.type === 'subclass') {
      for (const row of entity.levels) {
        for (const c of offeredRowChoices(row.choices, classIndex === 0, facts.decisions)) {
          if (isMasteryChoice(c)) push(c.id, classIndex);
        }
      }
    }
  };
  facts.classes.forEach((entry, i) => {
    const classEntity = index.get(index.resolveClassRef(entry.classId) ?? entry.classId);
    if (classEntity?.type === 'class') fromEntity(classEntity, i);
    const subclassEntity = entry.subclassId !== undefined ? index.get(entry.subclassId) : undefined;
    if (subclassEntity?.type === 'subclass') fromEntity(subclassEntity, i);
  });
  for (const id of comp.entities) {
    const entity = index.get(id);
    if (entity && entity.type !== 'class' && entity.type !== 'subclass') fromEntity(entity, undefined);
  }
  return found;
}

/**
 * Plan 14 task 4 (ruling 7): the mastery choices' selections, in `choiceIds` order (each decision
 * in its recorded order; a weapon chosen twice counts once), that fill at most `cap` slots. Only
 * item entities fill a slot — which is why an old character's plan-5 literal-text decision (e.g. a
 * recorded mastery-property name like "sap") is inert rather than crashing (backward tolerance,
 * phase 4 plan 11 task 6: events are immutable, so this fallback-by-construction is what makes an
 * old decision safe to replay forever without a reducer/schema migration).
 */
function honoredMasteries(choiceIds: readonly string[], facts: Facts, index: ContentIndex, cap: number): Set<string> {
  const honored = new Set<string>();
  for (const choiceId of choiceIds) {
    if (honored.size >= cap) break;
    for (const sel of facts.decisions[choiceId] ?? []) {
      if (honored.size >= cap) break;
      if (index.get(sel)?.type === 'item') honored.add(sel);
    }
  }
  return honored;
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
 * The character's weapon-mastery cap: every active `mastery.grant` effect's resolved count
 * (`resolveMasteryCount`), combined by the system's `multiclass.masteryCount` rule — pack DATA
 * (plan 16 ruling 9), `'max'` when absent: `'max'` = the highest count, `'sum'` = all counts added.
 * One cap is shared by every `weapon-masteries` choice. A single mastery class has one grant, so
 * its count is the same under either rule. `undefined` (not `0`) when no grant is active at all.
 */
function masteryCap(
  effects: readonly ActiveEffect[],
  comp: Composition,
  index: ContentIndex,
  evalFormula: (f: string) => number,
): number | undefined {
  const rule = index.system().multiclass?.masteryCount ?? 'max';
  let cap: number | undefined;
  for (const ae of effects) {
    if (ae.effect.type !== 'mastery.grant') continue;
    const contribution = resolveMasteryCount(ae.effect.count, ae.source, comp, index, evalFormula);
    cap = cap === undefined ? contribution : rule === 'sum' ? cap + contribution : Math.max(cap, contribution);
  }
  return cap;
}

/** `owner`'s position in `facts.classes` (a class, or the subclass chosen on an entry); `-1` if none. */
function classPosition(owner: Entity, facts: Facts, index: ContentIndex): number {
  if (owner.type === 'class') {
    return facts.classes.findIndex((e) => (index.resolveClassRef(e.classId) ?? e.classId) === owner.id);
  }
  return owner.type === 'subclass' ? facts.classes.findIndex((e) => e.subclassId === owner.id) : -1;
}

/**
 * Plan 16 Task 6 (ruling 10) — the shared-cap-aware OFFERED count of a later class's weapon-mastery
 * choice: `max(0, cap − the masteries the EARLIER classes' choices already honor)`, never more than
 * the choice's own resolved count (a shared cap only ever shrinks an offer: under `'sum'` a later
 * class keeps its own count, and an earlier class's unanswered pick does not inflate a later one).
 * `0` means the choice is not offered at all (nor asked at level-up). `undefined` — no override, the
 * choice's own count stands — for a choice that is not a `weapon-masteries` choice, that is the
 * initial class's or a non-class owner's, or while no `mastery.grant` is active. Consulted through
 * `choiceCountOverride` (derive/choice-count.ts) for offers and `validateSelection`; GRANTING never
 * reads it — recorded decisions keep filling the cap in class order exactly as before.
 *
 * Offers are built before ability derivation, so the cap's formula context is the composition's:
 * `level`, `classLevel`, `hitDie` and `prof` are live; `mod`/`score`/`resource` evaluate to 0 (the
 * same narrow posture as `resolveChoiceCount`) — mastery counts are constants or class row extras.
 * Deferred (score-gated) effects are left out for the same reason.
 */
export function masteryOfferCount(
  choiceId: string,
  facts: Facts,
  comp: Composition,
  index: ContentIndex,
): number | undefined {
  // Cheap exits first — this runs for every offered row choice: only a weapon-mastery choice owned
  // by a LATER class (or its subclass) is ever overridden.
  if (!choiceId.endsWith(`/${MASTERY_SLUG}`)) return undefined;
  const found = findChoice(index, choiceId);
  if (!found || !isMasteryChoice(found.choice) || classPosition(found.owner, facts, index) < 1) return undefined;
  const choices = masteryChoices(facts, comp, index);
  const own = choices.find((c) => c.id === choiceId);
  if (own?.classIndex === undefined || own.classIndex === 0) return undefined;
  const ownIndex = own.classIndex;

  const formulaCtx: FormulaContext = {
    level: comp.totalLevel,
    prof: proficiencyBonus(index.system(), comp.totalLevel),
    classLevel: (ref) => comp.classLevels[index.resolveClassRef(ref) ?? ref] ?? 0,
    mod: () => 0,
    score: () => 0,
    hitDie: (slug) => {
      const entity = index.get(index.resolveClassRef(slug) ?? slug);
      return entity?.type === 'class' ? entity.hitDie : 0;
    },
    resource: () => 0,
  };
  const evalFormula = (f: string) => evalFormulaString(f, formulaCtx);
  const cap = masteryCap(
    comp.effects.filter((ae) => !ae.deferred),
    comp,
    index,
    evalFormula,
  );
  if (cap === undefined) return undefined;

  const earlier = choices.filter((c) => c.classIndex !== undefined && c.classIndex < ownIndex).map((c) => c.id);
  const remaining = Math.max(0, cap - honoredMasteries(earlier, facts, index, cap).size);
  return Math.min(resolveChoiceCount(found.choice, facts, index), remaining);
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
  // presence gate stay identical. How several classes' counts combine is the system's
  // `multiclass.masteryCount` (plan 16 ruling 9, data — see `masteryCap`; the SRD pack's 'max' and
  // its owner-flag citation live in packages/content/src/static/system.ts).
  const masteryCount = masteryCap(abilities.effects, comp, index, evalFormula);
  const hasMasteryGrant = masteryCount !== undefined;

  // Selections are always compared as opaque strings against real entity ids (never re-derived from
  // the choice's `pick` shape) — this is why consumption here needs zero change whether the choice
  // is a `literal: 'text'` placeholder or a `query` pick (see `honoredMasteries`).
  // Plan 14 task 4 (ruling 7): every mastery choice's selections, in class order, fill at most
  // `masteryCount` slots. A selection beyond the cap is silently not applied — no diagnostic. Plan 16
  // ruling 10 shrinks what a later class is OFFERED (`masteryOfferCount`); a recorded decision keeps
  // filling the cap here exactly as before.
  const masteryChoiceIds = masteryChoices(facts, comp, index).map((c) => c.id);
  const masterySelections = honoredMasteries(masteryChoiceIds, facts, index, masteryCount ?? 0);

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

    const toHit = table.resolve(
      toHitTarget,
      mod(ability) + (proficient ? abilities.prof : 0),
      evalFormula,
      baseParts(ability, mod(ability), proficient ? 'proficient' : undefined, abilities.prof),
    );
    const damageBonus = table.resolve(damageTarget, mod(ability), evalFormula, baseParts(ability, mod(ability)));
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
