import { type FormulaContext, constantContext } from '../formula/evaluate.ts';

export type ArmorCategory = 'none' | 'light' | 'medium' | 'heavy';

export interface PredicateContext {
  level: number;
  abilityScore(ability: string): number;
  /** Accepts a class slug or a full entity id. */
  classLevel(ref: string): number;
  hasFeature(id: string): boolean;
  hasFeat(id: string): boolean;
  hasSpell(id: string): boolean;
  hasTag(tag: string): boolean;
  isProficient(kind: string, target: string): boolean;
  armorCategory(): ArmorCategory;
  hasShield(): boolean;
  speciesId(): string | undefined;
  classIds(): string[];
  subclassIds(): string[];
  hasCondition(id: string): boolean;
  isSpellcaster(): boolean;
  formula: FormulaContext;
}

export function constantPredicateContext(): PredicateContext {
  return {
    level: 0,
    abilityScore: () => 0,
    classLevel: () => 0,
    hasFeature: () => false,
    hasFeat: () => false,
    hasSpell: () => false,
    hasTag: () => false,
    isProficient: () => false,
    armorCategory: () => 'none',
    hasShield: () => false,
    speciesId: () => undefined,
    classIds: () => [],
    subclassIds: () => [],
    hasCondition: () => false,
    isSpellcaster: () => false,
    formula: constantContext(),
  };
}
