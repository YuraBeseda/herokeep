import type { ContentIndex } from '../content/index.ts';
import type { Facts } from '../reduce/facts.ts';
import type { ChoiceRequest, Sheet } from './sheet.ts';

export interface Advancement {
  classId: string;
  toLevel: number;
  steps: ChoiceRequest[];
  hpChoice: boolean;
}

const byClassId = (a: Advancement, b: Advancement) => (a.classId < b.classId ? -1 : a.classId > b.classId ? 1 : 0);

/**
 * Levels the character may take right now. 1b is XP-mode only (task-13-brief.md): for each class
 * already on the sheet, `toLevel = classLevels[classId] + 1` becomes available once
 * `facts.xp >= system.tables.xp[totalLevel]` (`xp[i]` = XP needed to BE level `i+1`). Multiclassing
 * into a class the character doesn't already have is out of 1b's scope — only classes already on
 * `sheet.classes` are listed. At creation (`sheet.level === 0`) there is nothing to advance yet.
 *
 * `steps` = the `ChoiceRequest`s the row at exactly `toLevel` asks (a class's subclass choice
 * "materializes at subclassLevel" simply because the pack places that `Choice` inside the row at
 * `level: subclassLevel` — no separate handling needed here). `hpChoice` is true whenever
 * `toLevel >= 2` (always true here, since `toLevel` is never less than 2).
 */
export function pendingAdvancements(sheet: Sheet, facts: Facts, index: ContentIndex): Advancement[] {
  if (sheet.level === 0) return [];
  const xpTable = index.system().tables.xp;
  const threshold = xpTable[sheet.level];
  if (threshold === undefined || facts.xp < threshold) return [];

  const advancements: Advancement[] = [];
  for (const entry of sheet.classes) {
    const classEntity = index.get(entry.classId);
    if (classEntity?.type !== 'class') continue;
    const toLevel = entry.level + 1;
    const row = classEntity.levels.find((r) => r.level === toLevel);
    const steps: ChoiceRequest[] = (row?.choices ?? []).map((c) => ({
      choiceId: c.id,
      ownerId: entry.classId,
      count: c.count,
    }));
    advancements.push({ classId: entry.classId, toLevel, steps, hpChoice: toLevel >= 2 });
  }
  return advancements.sort(byClassId);
}
