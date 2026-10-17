import type { SystemEntity } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import type { Facts } from '../reduce/facts.ts';
import type { ModifierTable } from './modifiers.ts';

/** One class's effective armor/weapon/tool proficiency contribution (see `classProficiencyGrants`). */
export interface ClassProficiencyGrant {
  classId: string;
  armorTraining: string[];
  weaponProficiencies: string[];
  toolProficiencies: string[];
}

/**
 * The single source of truth (plan 13 ruling 8) for what each of the character's classes
 * contributes to armor/weapon/tool proficiency — consumed by `derive/index.ts`'s
 * `sheet.proficiencies` AND `derive/attacks.ts`'s weapon proficiency for attack math, so the two can
 * never disagree. Ruling 7 (phase 4, plan 11 task 2): `facts.classes[]` order (order gained) decides
 * which entry is "first" — the FIRST class always contributes its full lists; any LATER class
 * (index > 0) contributes only its `multiclass.gains` lists (the pack's multiclass table data).
 * `multiclass.gains` carries no tool list, so a later class with gains contributes no class tools
 * (plan 13 task 2). Compat: a later class with no `multiclass`/`gains` data at all (old/fixture
 * packs that predate ruling 7) keeps its FULL lists, so untouched content grants what it always did.
 * A `facts.classes` entry that does not resolve to a class entity contributes nothing.
 */
export function classProficiencyGrants(facts: Facts, index: ContentIndex): ClassProficiencyGrant[] {
  const grants: ClassProficiencyGrant[] = [];
  facts.classes.forEach((c, i) => {
    const classId = index.resolveClassRef(c.classId) ?? c.classId;
    const classEntity = index.get(classId);
    if (classEntity?.type !== 'class') return;
    const gains = i > 0 ? classEntity.multiclass?.gains : undefined;
    grants.push({
      classId,
      armorTraining: gains ? gains.armorTraining : classEntity.armorTraining,
      weaponProficiencies: gains ? gains.weaponProficiencies : classEntity.weaponProficiencies,
      toolProficiencies: gains ? [] : classEntity.toolProficiencies,
    });
  });
  return grants;
}

/** A resolved proficiency level for one target (skill, save, …), 'none' meaning "not proficient". */
export type ProficiencyLevel = 'none' | 'proficient' | 'expertise' | 'half';

/**
 * `proficiency[totalLevel - 1]` from the system's table, clamped to the table's bounds so an
 * out-of-range level (0, or beyond the table's last entry) never throws — derivation must never
 * fail (docs/02-architecture/05-rules-engine.md).
 */
export function proficiencyBonus(system: SystemEntity, totalLevel: number): number {
  const table = system.tables.proficiency;
  const idx = Math.max(0, Math.min(totalLevel, table.length) - 1);
  return table[idx] ?? 0;
}

/**
 * Resolves a `union`-policy proficiency target to its effective level. `ModifierTable.resolveSet`
 * already merges `expertise`/`proficient` (expertise absorbs proficient's sources); this adds
 * `half` beneath both, matching doc-05: full proficiency always beats "half proficiency".
 */
export function proficiencyLevel(table: ModifierTable, target: string): ProficiencyLevel {
  const values = new Set(table.resolveSet(target).values);
  if (values.has('expertise')) return 'expertise';
  if (values.has('proficient')) return 'proficient';
  if (values.has('half')) return 'half';
  return 'none';
}

/** True for a FULL proficiency rank (`proficient` or `expertise`) — `half` and `none` are not. */
export function isProficientRank(level: ProficiencyLevel | undefined): boolean {
  return level === 'proficient' || level === 'expertise';
}

/** `prof × the level's multiplier` (doc-05: expertise x2, proficient x1, half floors 0.5x, none 0). */
export function proficiencyAmount(level: ProficiencyLevel, prof: number): number {
  switch (level) {
    case 'expertise':
      return prof * 2;
    case 'proficient':
      return prof;
    case 'half':
      return Math.floor(prof * 0.5);
    case 'none':
      return 0;
  }
}
