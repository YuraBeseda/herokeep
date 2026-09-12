import type { SystemEntity } from '@hk/protocol';
import type { ModifierTable } from './modifiers.ts';

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
