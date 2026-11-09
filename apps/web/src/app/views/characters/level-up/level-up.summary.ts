import type { ContentIndex, Localizer } from '@hk/engine';
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
