import type { Diagnostic } from '@hk/engine';

/**
 * Override hooks `hk-choice-step` (and the `abilityGeneration`/`abilities` children it delegates
 * to, `hk-ability-scores-step`/`hk-abilities-improve-step`) accept as optional inputs
 * (task-11-brief.md): let a consumer OTHER than the creation wizard — the sheet's build tab
 * (outstanding-choice re-entry against the LIVE character), and, per that task's own forward note,
 * a future level-up flow (task-13, the ASI case) — drive validate/commit against ITS OWN data
 * source instead of `CreateWizardState`. When a caller omits them, every one of these components
 * falls back to its own injected `CreateWizardState` — the wizard's own usage never passes these,
 * so nothing changes for it.
 *
 * Pulled into their own module (rather than declared alongside `ChoiceStepComponent`) so
 * `ability-scores-step.component.ts`/`abilities-improve-step.component.ts` can import the TYPES
 * without a runtime import cycle back through `choice-step.component.ts`, which itself imports
 * both of them to render as its `abilityGeneration`/`abilities` cases.
 */
export type ChoiceValidateFn = (choiceId: string, selection: string[]) => Diagnostic[];
export type ChoiceCommitFn = (
  choiceId: string,
  selection: string[],
  context?: Record<string, unknown>,
) => void;
