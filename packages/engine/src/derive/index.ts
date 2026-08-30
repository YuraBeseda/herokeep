import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import type { Facts } from '../reduce/facts.ts';
import { creationChoices } from './choices.ts';
import { findChoice } from '../content/choices.ts';
import type { Sheet } from './sheet.ts';

export * from './sheet.ts';

export function outstandingChoices(facts: Facts, index: ContentIndex) {
  return creationChoices(facts, index).requests;
}

export function derive(facts: Facts, index: ContentIndex): Sheet {
  const issues: Diagnostic[] = [];
  for (const choiceId of Object.keys(facts.decisions).sort()) {
    if (!findChoice(index, choiceId))
      issues.push(warning('decision.unknownChoice', `Decision for unknown choice "${choiceId}"`));
  }
  const creation = creationChoices(facts, index);
  issues.push(...creation.issues);
  return {
    name: facts.name,
    system: facts.system,
    level: 0,
    classes: [],
    pins: { ...facts.pins },
    outstandingChoices: creation.requests,
    issues,
  };
}
