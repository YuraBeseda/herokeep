import { type Choice, type Entity, parseChoiceId } from '@hk/protocol';
import type { ContentIndex } from './index.ts';

/**
 * Occurrence scoping (plan 11 final wave F1). A feat/feature selected by MORE THAN ONE decision
 * (a repeatable feat — e.g. the SRD's Ability Score Improvement — taken at two class levels, or via
 * two classes' advancements) carries the SAME pack-authored nested `Choice.id` each time. Its
 * nested choice is asked once PER acquisition: occurrence #1 uses the authored id verbatim — so
 * every pre-existing event log keeps resolving exactly as before — and occurrence #n (n ≥ 2) uses
 * `<authored id>--<n>`. The suffix stays inside the choice-id grammar (`CHOICE_ID_RE`'s slug is
 * `[a-z0-9][a-z0-9-]*`), so `decision.made`'s `ChoiceIdSchema` accepts it with no protocol change
 * and older clients parse such events unchanged (they merely see an unknown choice).
 */
const OCCURRENCE_SEP = '--';
const OCCURRENCE_RE = /^(.*)--([1-9]\d*)$/;

/** The effective choice id for the `occurrence`-th (1-based) acquisition of `baseId`'s owner. */
export function occurrenceChoiceId(baseId: string, occurrence: number): string {
  return occurrence <= 1 ? baseId : `${baseId}${OCCURRENCE_SEP}${occurrence}`;
}

/** Splits an occurrence-scoped id back into its authored base id and ordinal (1 when unscoped). */
export function splitOccurrence(choiceId: string): { baseId: string; occurrence: number } {
  const m = OCCURRENCE_RE.exec(choiceId);
  if (!m) return { baseId: choiceId, occurrence: 1 };
  const occurrence = Number(m[2]);
  return occurrence >= 2 ? { baseId: m[1]!, occurrence } : { baseId: choiceId, occurrence: 1 };
}

/**
 * Synthetic class skill picks (no backing `Choice` entity). Two shapes, both at class level 1:
 * - `<classId>@1/skills` (R5) — the INITIAL class's starting skill pick, `skillChoice.count` of
 *   `skillChoice.from`;
 * - `<classId>@1/multiclass-skills` (plan 12 final wave W1) — the bonus pick a LATER class grants on
 *   multiclass entry, `multiclass.gains.skillChoiceCount` of the SAME `skillChoice.from` list (the
 *   vendored rule: on multiclassing "you gain only some of the new class's starting proficiencies").
 */
export const SKILLS_CHOICE_SLUG = 'skills';
export const MULTICLASS_SKILLS_CHOICE_SLUG = 'multiclass-skills';

/** The synthetic id for a later class's multiclass-entry bonus skill pick (see above). */
export const multiclassSkillsChoiceId = (classId: string): string => `${classId}@1/${MULTICLASS_SKILLS_CHOICE_SLUG}`;

export interface ClassSkillPick {
  classId: string;
  from: string[];
  count: number;
  multiclass: boolean;
}

/** Resolves either synthetic class skill-pick id to its class, option list and count (else undefined). */
export function classSkillPick(choiceId: string, index: ContentIndex): ClassSkillPick | undefined {
  const parsed = parseChoiceId(choiceId);
  if (!parsed || parsed.level !== 1) return undefined;
  const multiclass = parsed.slug === MULTICLASS_SKILLS_CHOICE_SLUG;
  if (!multiclass && parsed.slug !== SKILLS_CHOICE_SLUG) return undefined;
  const classId = index.resolveClassRef(parsed.entityId) ?? parsed.entityId;
  const classEntity = index.get(classId);
  if (classEntity?.type !== 'class') return undefined;
  const count = multiclass ? (classEntity.multiclass?.gains.skillChoiceCount ?? 0) : classEntity.skillChoice.count;
  return { classId, from: classEntity.skillChoice.from, count, multiclass };
}

function findAuthoredChoice(index: ContentIndex, choiceId: string): { owner: Entity; choice: Choice } | undefined {
  const parsed = parseChoiceId(choiceId);
  if (!parsed) return undefined;
  const owner = index.get(parsed.entityId);
  if (!owner) return undefined;
  const direct = owner.choices.find((c) => c.id === choiceId);
  if (direct) return { owner, choice: direct };
  if (owner.type === 'class' || owner.type === 'subclass') {
    for (const row of owner.levels) {
      const found = row.choices.find((c) => c.id === choiceId);
      if (found) return { owner, choice: found };
    }
  }
  return undefined;
}

/**
 * Resolves a choice id to its owner + authored `Choice`. An occurrence-scoped id (see
 * `occurrenceChoiceId`) resolves to its base choice — an exact authored match always wins first, so
 * a pack that happens to author a slug ending in `--<n>` still resolves to its own choice.
 */
export function findChoice(index: ContentIndex, choiceId: string): { owner: Entity; choice: Choice } | undefined {
  const exact = findAuthoredChoice(index, choiceId);
  if (exact) return exact;
  const { baseId, occurrence } = splitOccurrence(choiceId);
  if (occurrence < 2) return undefined;
  const base = findAuthoredChoice(index, baseId);
  // Only a decision-selected feat/feature is ever acquired more than once (`selectedEntityChoices`).
  return base && (base.owner.type === 'feat' || base.owner.type === 'feature') ? base : undefined;
}
