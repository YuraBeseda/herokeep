import type { Advancement, ContentIndex, Localizer, Sheet } from '@hk/engine';
import { makeEntityId, parseChoiceId, parseEntityId } from '@hk/protocol';

const ABILITY_VALUE_RE = /^([a-z]+):([+-]?\d+)$/i;

/** The choices whose selection is bare skill slugs (`athletics`) instead of entity ids. */
const SKILL_SLUG_SUFFIXES = ['/skills', '/multiclass-skills'] as const;

/** An ability token (`str`) as the ability's own short name, or the key upper-cased when the pack has none. */
function abilityLabel(key: string, index: ContentIndex, localizer: Localizer): string {
  const entity = index
    .byType('ability')
    .find((e) => e.type === 'ability' && e.abbreviation === key);
  return entity ? localizer.name(entity.id) : key.toUpperCase();
}

/**
 * One decision's selection as short plain text for the stepper and the review ("Defense",
 * "Handaxe, Longsword", "Strength +2"). Pure presentation of pack data: an entity id is its
 * localized name, an ability token (`str:+2`) the ability's name and the signed number, a bare skill
 * slug its skill's name, anything else (a free-text entry) as it is.
 */
export function selectionText(
  choiceId: string,
  selection: readonly string[],
  index: ContentIndex,
  localizer: Localizer,
): string {
  const skillPack = SKILL_SLUG_SUFFIXES.some((suffix) => choiceId.endsWith(suffix))
    ? skillPackOf(choiceId, index)
    : undefined;
  return selection
    .map((value) => {
      if (index.has(value)) return localizer.name(value);
      const ability = ABILITY_VALUE_RE.exec(value);
      if (ability) return `${abilityLabel(ability[1], index, localizer)} ${ability[2]}`;
      const skillId = skillPack ? makeEntityId(skillPack, 'skill', value) : undefined;
      return skillId && index.has(skillId) ? localizer.name(skillId) : value;
    })
    .join(', ');
}

function skillPackOf(choiceId: string, index: ContentIndex): string | undefined {
  const parsed = parseChoiceId(choiceId);
  if (!parsed) return undefined;
  const classId = index.resolveClassRef(parsed.entityId) ?? parsed.entityId;
  return parseEntityId(classId)?.packId;
}

// --- What the level up changes on the sheet ----------------------------------------------------------

export type SheetChangeField = 'hitDice' | 'currentHp' | 'spellSlots' | 'pactSlots' | 'proficiency';

/** One line of "what changes": the value now, the value after, and whether they differ. Values are
 * language-neutral text ("2d10", "+3", "3 · 2"); the label is the field's own i18n key. */
export interface SheetChange {
  readonly field: SheetChangeField;
  readonly before: string;
  readonly after: string;
  readonly changed: boolean;
}

const hitDiceText = (sheet: Sheet): string =>
  Object.values(sheet.hp.hitDice)
    .sort((a, b) => a.die - b.die)
    .map((d) => `${d.total}d${d.die}`)
    .join(' + ');

/** The most slots of each level across the sheet's casters, as "4 · 2" (level 1, level 2, …). */
const slotsText = (sheet: Sheet): string => {
  const perLevel = new Map<number, number>();
  for (const block of sheet.spellcasting) {
    for (const slot of block.slots) {
      if (slot.max > 0) perLevel.set(slot.level, Math.max(perLevel.get(slot.level) ?? 0, slot.max));
    }
  }
  return [...perLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, max]) => String(max))
    .join(' · ');
};

const pactText = (sheet: Sheet): string =>
  sheet.spellcasting
    .flatMap((block) => (block.pact ? [`${block.pact.count} × ${block.pact.level}`] : []))
    .join(' + ');

/**
 * What the draft sheet changes against the live one, for the hit point step and the review: hit
 * dice, current hit points, spell slots (and pact slots) when either sheet has any, and the
 * proficiency bonus. A pure comparison of two derived sheets; nothing is computed here.
 */
export function sheetChanges(before: Sheet, after: Sheet): SheetChange[] {
  const row = (field: SheetChangeField, b: string, a: string): SheetChange => ({
    field,
    before: b,
    after: a,
    changed: b !== a,
  });
  const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));
  const rows: SheetChange[] = [
    row('hitDice', hitDiceText(before), hitDiceText(after)),
    row('currentHp', String(before.hp.current), String(after.hp.current)),
  ];
  const slotsBefore = slotsText(before);
  const slotsAfter = slotsText(after);
  if (slotsBefore || slotsAfter) rows.push(row('spellSlots', slotsBefore, slotsAfter));
  const pactBefore = pactText(before);
  const pactAfter = pactText(after);
  if (pactBefore || pactAfter) rows.push(row('pactSlots', pactBefore, pactAfter));
  rows.push(row('proficiency', signed(before.prof), signed(after.prof)));
  return rows;
}

// --- The review's lists ------------------------------------------------------------------------------

/** A line of the review: what changes, with the step to jump to for changing it. */
export interface ReviewRow {
  readonly stepId: string;
  readonly prompt: string;
  readonly text: string;
}

/** The features the class row for the new level grants outright (a grant with a condition is left to
 * the sheet to evaluate), by name, once each. Pack data only; no rule is decided here. */
export function newFeatureNames(
  advancement: Advancement | undefined,
  index: ContentIndex,
  localizer: Localizer,
): string[] {
  if (!advancement) return [];
  const entity = index.get(advancement.classId);
  if (entity?.type !== 'class') return [];
  const row = entity.levels.find((r) => r.level === advancement.toLevel);
  const names = (row?.grants ?? [])
    .filter((grant) => grant.when === undefined && index.has(grant.feature))
    .map((grant) => localizer.name(grant.feature));
  return [...new Set(names)];
}

/** The choices made this session, in step order, each with the step that edits it. `labelOf` names a
 * step whose choice has no prompt of its own. */
export function choiceReviewRows(
  steps: readonly { id: string; kind: string; choiceId?: string }[],
  texts: ReadonlyMap<string, string>,
  localizer: Localizer,
  labelOf: (step: { id: string; kind: string; choiceId?: string }) => string,
): ReviewRow[] {
  return steps.flatMap((step) => {
    const text = step.choiceId ? texts.get(step.choiceId) : undefined;
    if (step.kind !== 'choice' || !step.choiceId || !text) return [];
    return [
      {
        stepId: step.id,
        prompt: localizer.choicePrompt(step.choiceId).text || labelOf(step),
        text,
      },
    ];
  });
}

/** The spells learned or prepared this session, by name, one row for each kind that has any. */
export function spellReviewRows(
  drafts: readonly { type: string; payload: unknown }[],
  localizer: Localizer,
  labels: { learned: string; prepared: string },
): ReviewRow[] {
  const names = (type: string): string =>
    drafts
      .filter((draft) => draft.type === type)
      .map((draft) => localizer.name((draft.payload as { spellId: string }).spellId))
      .join(', ');
  const rows: ReviewRow[] = [];
  const learned = names('spell.learned');
  const prepared = names('spell.prepared');
  if (learned) rows.push({ stepId: 'spells', prompt: labels.learned, text: learned });
  if (prepared) rows.push({ stepId: 'spells', prompt: labels.prepared, text: prepared });
  return rows;
}
