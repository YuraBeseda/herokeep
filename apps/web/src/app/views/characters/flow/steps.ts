import { parseChoiceId } from '@hk/protocol';

/**
 * The step list of a character flow (creation today, level-up next), lifted out of
 * `CreateWizardState` so both flows build and order steps the same way. Everything here is a pure
 * function of ids: the wizard state feeds it the engine's outstanding / invalid / decided choice
 * ids and renders what comes back.
 */
export interface WizardStep {
  id: string;
  labelKey: string;
  choiceId?: string;
  kind: 'name' | 'choice' | 'spells' | 'equipment' | 'review';
}

/** Curated ordering (task-5-brief.md): only sorts these known creation-choice slugs to the
 * front, in this order — everything else `outstandingChoices` surfaces (a pack choice this task
 * doesn't special-case, e.g. a class's own level-1 feature choices) still gets a step, just
 * appended after, in the engine's own sorted order. Adding a pack choice therefore needs zero UI
 * changes (rules-are-data) — it simply shows up, uncurated, at the tail of the list. */
export type KnownStepId =
  'species' | 'background' | 'background-abilities' | 'class' | 'ability-scores' | 'class-skills';

export const KNOWN_STEP_ORDER: readonly KnownStepId[] = [
  'species',
  'background',
  'background-abilities',
  'class',
  'ability-scores',
  'class-skills',
];

export function labelKeyFor(id: KnownStepId | 'choice'): string {
  const camel: Record<KnownStepId | 'choice', string> = {
    species: 'species',
    background: 'background',
    'background-abilities': 'backgroundAbilities',
    class: 'class',
    'ability-scores': 'abilityScores',
    'class-skills': 'classSkills',
    choice: 'choice',
  };
  return `characters.wizard.steps.${camel[id]}`;
}

/**
 * One step per choice id, in the curated order (species, background, background-abilities, class,
 * ability-scores, class-skills), then every other choice sorted by choice id (the same plain
 * code-unit order `outstandingChoices` already emits). A decided-but-invalid choice — e.g. a
 * count-2 pick after its first toggle, which the choice step commits immediately — must keep the
 * slot it had while outstanding, so the caller passes every id in ONE list and the order is decided
 * here, not by the order the ids arrive in.
 */
export function curatedChoiceSteps(
  choiceIds: readonly string[],
  systemId: string | undefined,
): WizardStep[] {
  if (choiceIds.length === 0) return [];

  const knownKind = (choiceId: string): KnownStepId | undefined => {
    const parsed = parseChoiceId(choiceId);
    if (!parsed) return undefined;
    if (parsed.entityId === systemId) {
      if (parsed.slug === 'species') return 'species';
      if (parsed.slug === 'background') return 'background';
      if (parsed.slug === 'class') return 'class';
      if (parsed.slug === 'ability-scores') return 'ability-scores';
      return undefined;
    }
    if (parsed.slug === 'ability-scores') return 'background-abilities';
    if (parsed.slug === 'skills' && parsed.level === 1) return 'class-skills';
    return undefined;
  };

  const byKnownId = new Map<KnownStepId, string>();
  const rest: string[] = [];
  for (const choiceId of choiceIds) {
    const kind = knownKind(choiceId);
    if (kind && !byKnownId.has(kind)) byKnownId.set(kind, choiceId);
    else rest.push(choiceId);
  }

  const steps: WizardStep[] = [];
  for (const knownId of KNOWN_STEP_ORDER) {
    const choiceId = byKnownId.get(knownId);
    if (choiceId)
      steps.push({ id: knownId, labelKey: labelKeyFor(knownId), choiceId, kind: 'choice' });
  }
  rest.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const choiceId of rest) {
    steps.push({ id: choiceId, labelKey: labelKeyFor('choice'), choiceId, kind: 'choice' });
  }
  return steps;
}

export interface WizardStepInput {
  /** Whether a draft sheet exists yet (a name is set and a core pack is loaded). Before that
   * there is nothing to decide, equip or review beyond the name. */
  readonly hasSheet: boolean;
  readonly hasSpellcasting: boolean;
  /** Every choice id that should get a step (see `curatedChoiceSteps`). */
  readonly choiceIds: readonly string[];
  readonly systemId: string | undefined;
}

/** ORDER: 'name' → one step per choice id (curated order) → 'spells' (only when the draft has a
 * spellcasting block) → 'equipment' → 'review'. Everything between 'name' and 'review' only
 * appears once the draft sheet exists. */
export function wizardSteps(input: WizardStepInput): WizardStep[] {
  const steps: WizardStep[] = [
    { id: 'name', labelKey: 'characters.wizard.steps.name', kind: 'name' },
  ];
  if (input.hasSheet) {
    steps.push(...curatedChoiceSteps(input.choiceIds, input.systemId));
    if (input.hasSpellcasting) {
      steps.push({ id: 'spells', labelKey: 'characters.wizard.steps.spells', kind: 'spells' });
    }
    steps.push({
      id: 'equipment',
      labelKey: 'characters.wizard.steps.equipment',
      kind: 'equipment',
    });
  }
  steps.push({ id: 'review', labelKey: 'characters.wizard.steps.review', kind: 'review' });
  return steps;
}

const KIND_RANK: Record<WizardStep['kind'], number> = {
  name: 0,
  choice: 100,
  spells: 200,
  equipment: 300,
  review: 400,
};

function rankOf(step: WizardStep): number {
  if (step.kind !== 'choice') return KIND_RANK[step.kind];
  const known = KNOWN_STEP_ORDER.indexOf(step.id as KnownStepId);
  return known === -1 ? KIND_RANK.choice + KNOWN_STEP_ORDER.length : KIND_RANK.choice + known;
}

/** The canonical order `wizardSteps` produces, as a comparator — so a step that has just left the
 * list (answered) can still be placed against the ones that remain. */
export function compareWizardSteps(a: WizardStep, b: WizardStep): number {
  const byRank = rankOf(a) - rankOf(b);
  if (byRank !== 0) return byRank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Steps whose answer is built over several edits (the ability scores: a standard array is only
 * valid once all six are assigned, a point buy while it stays within budget). Such a step stays
 * open when it becomes valid — the user decides when to move on — instead of the flow advancing
 * mid-edit. */
export function holdsWhenAnswered(step: WizardStep): boolean {
  return step.id === 'ability-scores';
}

/** A choice step must be answered before the hero can be created; the free-form steps (spells,
 * equipment) and the name are not "unanswered choices". */
export function isRequiredStep(step: WizardStep): boolean {
  return step.kind === 'choice';
}
