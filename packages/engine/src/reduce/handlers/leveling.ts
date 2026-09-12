import { type DecisionMade, type LevelGained, type XpAwarded } from '@hk/protocol';
import { type ClassEntry, requireCreated } from '../facts.ts';
import type { Handler } from '../reducer.ts';

export const HANDLERS: Record<string, Handler> = {
  'level.gained@1': (f, e) => {
    const p = e.payload as LevelGained;
    const skip = requireCreated(f);
    if (skip) return skip;

    const idx = f.classes.findIndex((c) => c.classId === p.classId);
    const previous = idx === -1 ? undefined : f.classes[idx];
    const currentLevel = previous?.level ?? 0;
    if (p.level !== currentLevel + 1) return 'level-not-next';

    const subclassId = p.subclassId ?? previous?.subclassId;
    const entry: ClassEntry = {
      classId: p.classId,
      level: p.level,
      ...(subclassId !== undefined ? { subclassId } : {}),
    };
    const classes = idx === -1 ? [...f.classes, entry] : f.classes.map((c, i) => (i === idx ? entry : c));

    // Level 1 has no HP roll (`hpRules.firstLevelMaxHitDie`) — only levels >= 2 are ledgered.
    const hpRolls =
      p.level >= 2 && p.hpRoll !== undefined
        ? { ...f.hpRolls, [p.classId]: [...(f.hpRolls[p.classId] ?? []), p.hpRoll] }
        : f.hpRolls;

    return { ...f, classes, hpRolls };
  },

  'xp.awarded@1': (f, e) => {
    const p = e.payload as XpAwarded;
    const skip = requireCreated(f);
    if (skip) return skip;
    return { ...f, xp: Math.max(0, f.xp + p.amount) };
  },

  // Relocated from handlers/identity.ts (final home, next to level.gained): stores the
  // selection as before AND the decision's context (when present), for the timeline.
  'decision.made@1': (f, e) => {
    const p = e.payload as DecisionMade;
    const skip = requireCreated(f);
    if (skip) return skip;
    return {
      ...f,
      decisions: { ...f.decisions, [p.choiceId]: [...p.selection] },
      decisionContexts:
        p.context !== undefined ? { ...f.decisionContexts, [p.choiceId]: p.context } : f.decisionContexts,
    };
  },
};
