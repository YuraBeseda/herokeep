/**
 * Maps a `Diagnostic.code` (engine `derive/validation.ts` selection checks, or a `propose.*`
 * refusal's `ProposeError.diagnostics`) to its scope-relative `validation.<code>` i18n key,
 * falling back to `validation.generic` when `code` isn't one `knownCodes` recognizes — a consumer
 * only ever wants a specific message for the codes ITS OWN operation can actually produce (see
 * each i18n file's `validation` block); anything else (a diagnostic bleeding through from an
 * unrelated pick form, or a future code this consumer didn't anticipate) gets the generic one
 * instead of silently resolving to a missing nested key.
 *
 * Extracted from `create-wizard/steps/choice-step.component.ts`'s own (until now duplicated
 * verbatim across `choice-step`/`ability-scores-step`/`abilities-improve-step.component.ts`)
 * `diagnosticKey` — task-2-brief.md's controller ruling R-pf1: reuse plan-5's mapping helper if
 * it's exported, else extract it and refactor one existing consumer to prove reuse (only
 * `choice-step.component.ts` was refactored here; the other two duplicates are unchanged — a
 * wider sweep is out of this task's scope).
 *
 * Scope-relative (no `'characters.'` prefix): an inline diagnostic renderer (the create-wizard/
 * level-up choice steps, each with their own scoped `*transloco="let t; read: 'characters'"`)
 * passes this straight to its own scoped `t()`. `ToastService.show()` resolves UNSCOPED, global
 * keys instead (see its SKILL.md) — a toast caller (e.g. `play-tab.component.ts`'s `propose.*` →
 * toast wiring) must prepend `'characters.'` itself: `` `characters.${diagnosticKey(code, known)}` ``.
 */
export function diagnosticKey(code: string, knownCodes: ReadonlySet<string>): string {
  return knownCodes.has(code) ? `validation.${code}` : 'validation.generic';
}
