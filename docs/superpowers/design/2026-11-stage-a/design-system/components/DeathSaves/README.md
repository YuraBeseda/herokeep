# DeathSaves

The death-save tracker shown when HP is 0: two labelled rows of three ring buttons, successes ringed in moss and failures in ember, each filling when marked; a Roll button rolls the save and marks the result.

## Anatomy

`hk-ring` (36px hit area, 44px on phone) around `hk-ring__i`, an 18px disc on `leaf-glow` with a 2px inset ring: `moss` for successes, `ember` (`hk-ring__i--f`) for failures; `hk-ring__i--marked` fills the disc with the same hue and darkens the ring. Rows "Successes" / "Failures" in 15px `text-1`; the rings are toggle buttons (`aria-pressed`) with hints "Mark success" / "Success, marked".

## States

Empty, partly marked, stable (three successes → `hk-chip--moss` "stable", rings reset on the next heal), dead (three failures → the sheet asks for confirmation before marking the third; then `hk-chip--ember` "dead"). A natural 20 heals 1 HP and closes the tracker; a natural 1 marks two failures.

## Accessibility

Success and failure differ in hue, lightness (moss L 0.18 vs ember L 0.14 are close, so) and position and label: the row word is always present and the ring's hint names the result. Rings 3:1+ on `leaf-glow`.

## Tokens

`leaf-glow`, `moss`, `success-strong`, `ember`, `ember-bottom`, `text-1`, `success-soft`, `danger-soft`, `brass-*` (Roll).
