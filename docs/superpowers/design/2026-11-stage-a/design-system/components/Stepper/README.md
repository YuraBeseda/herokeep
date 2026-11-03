# Stepper

The wizard's step list: on desktop and tablet a vertical parchment stepper in the left column where done steps carry a wax seal, the current step is raised, and undiscovered class choices sit as one locked group; on phones a compact leather strip "Step 4 of 9 · Ability scores" that opens the full list in a sheet.

## Anatomy

- Desktop `hk-stepper` in a `Leaf`: `<ol>` of `hk-step` links (grid 28px marker · name · hint, min-height 36px). Marker `hk-step__n`: a `WaxSeal` s with the `check-mark` glyph when done (hint "Done"), a brass numeral disc when current, an outlined numeral when to do, a `padlock` for the locked "Class choices" group that expands into real steps once the class is chosen. `hk-step__hint` shows the step's answer ("Human", "Soldier").
- `hk-step--current`: `leaf-sunken` fill, `leaf-edge` inset, a small paper shadow; `aria-current="step"`.
- Phone `hk-stepstrip`: leather strip with the "All steps" `IconButton`, "Крок 4 з 9" in `text-on-leather-2` over the step name in Forum 17px, and a thin brass progress gauge. No chips row.
- Review step: a `Leaf` listing every decision by step with an `Edit` link (`hk-link`) that jumps to that step and returns on Next.

## Rules

Next is the next unanswered step and never skips one; on the last step the same slot reads "Create hero" / "Finish level up". Back is history-aware; Cancel asks only if something changed. Deep links restore the exact step; the stepper reflects the URL. Done steps keep their place.

## States

Done, current, to do, locked group, invalid (an ember hint "needs 2 skills" under the name).

## Accessibility

`<nav aria-label="Steps">` with an ordered list; links are real `<a>`; the phone strip is a labelled group with a `progressbar`. Ink 11.6:1; `text-2` hints 6.2:1.

## Tokens

`leaf`, `leaf-sunken`, `leaf-edge`, `text-1`, `text-2`, `accent-strong`, `brass-top`, `brass`, `brass-mid`, `text-on-brass`, `link`, `leather-highlight`, `leather-dark`, `text-on-leather`, `text-on-leather-2`, the WaxSeal tokens.
