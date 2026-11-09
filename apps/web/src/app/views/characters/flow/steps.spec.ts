import { isRequiredLevelUpStep, levelUpComparator, levelUpSteps, type LevelUpStep } from './steps';

const ids = (steps: readonly LevelUpStep[]): string[] => steps.map((step) => step.id);

describe('levelUpSteps', () => {
  it('is only the which-class step until a class is known', () => {
    const steps = levelUpSteps({
      hasAdvancement: false,
      hpChoice: true,
      choiceIds: ['x'],
      hasSpellcasting: true,
    });
    expect(ids(steps)).toEqual(['class']);
    expect(steps[0].kind).toBe('class');
  });

  it('orders hit points, the choices as given, spells and the review', () => {
    expect(
      ids(
        levelUpSteps({
          hasAdvancement: true,
          hpChoice: true,
          choiceIds: ['b', 'a'],
          hasSpellcasting: true,
        }),
      ),
    ).toEqual(['hp', 'b', 'a', 'spells', 'review']);
  });

  it('leaves out hit points for a new class and spells for a non-caster', () => {
    expect(
      ids(
        levelUpSteps({
          hasAdvancement: true,
          hpChoice: false,
          choiceIds: [],
          hasSpellcasting: false,
        }),
      ),
    ).toEqual(['review']);
  });

  it('gives every choice step the choice id as its step id and the generic label', () => {
    const [, choice] = levelUpSteps({
      hasAdvancement: true,
      hpChoice: true,
      choiceIds: ['pack:class/x@3/subclass'],
      hasSpellcasting: false,
    });
    expect(choice).toEqual({
      id: 'pack:class/x@3/subclass',
      labelKey: 'characters.levelUp.steps.choice',
      choiceId: 'pack:class/x@3/subclass',
      kind: 'choice',
    });
  });
});

describe('levelUpComparator', () => {
  const step = (kind: LevelUpStep['kind'], id: string): LevelUpStep => ({
    id,
    labelKey: 'k',
    kind,
    ...(kind === 'choice' ? { choiceId: id } : {}),
  });

  it('ranks class < hp < choices (by the order they were first met) < spells < review', () => {
    const order = new Map([
      ['late', 1],
      ['early', 0],
    ]);
    const compare = levelUpComparator((id) => order.get(id) ?? 99);
    const sorted = [
      step('review', 'review'),
      step('spells', 'spells'),
      step('choice', 'late'),
      step('choice', 'early'),
      step('hp', 'hp'),
      step('class', 'class'),
    ].sort(compare);
    expect(ids(sorted)).toEqual(['class', 'hp', 'early', 'late', 'spells', 'review']);
  });

  it('requires hit points and choices before the level up can finish', () => {
    expect(isRequiredLevelUpStep(step('hp', 'hp'))).toBe(true);
    expect(isRequiredLevelUpStep(step('choice', 'c'))).toBe(true);
    expect(isRequiredLevelUpStep(step('spells', 'spells'))).toBe(false);
    expect(isRequiredLevelUpStep(step('review', 'review'))).toBe(false);
  });
});
