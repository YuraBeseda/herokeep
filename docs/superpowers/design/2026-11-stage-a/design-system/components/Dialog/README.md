# Dialog

A parchment dialog on the table: a wax title seal with the action's glyph, the title in Forum, a short body or form, and a leather strap of actions at the foot; destructive confirms keep their verb in text ("Delete hero"), never an icon alone.

## Anatomy

`hk-dialog` (`role="dialog"` or `alertdialog`, `aria-modal`, 420px max) over `hk-overlay`: paper gradient, `radius-frame`, `shadow-raised` + `shadow-leaf`, padding 18px 20px 16px. `hk-dialog__head`: a `WaxSeal` m (34px) with the glyph, `display-m` title, optional close `IconButton`. Body: 15/1.4 paragraphs or fields (`NumberField`, `hk-input`). `hk-dialog__strap`: a `hk-strap` bleeding to the dialog's edges with a ghost-leather Cancel on the left of the primary (brass or ember). Phone: the dialog becomes a bottom sheet (`hk-sheet`) with 44px controls.

## Rules

- One primary action, verb first ("Apply 7 damage", "Create hero"); Cancel always present and focus starts on the least destructive control.
- Confirm only when something changes or is lost; the body names what and where (devices, campaigns).
- Number dialogs preview the result in `hk-hint` ("31 → 29 HP").

## States

Open / closing (`duration-base`), busy (primary shows the spinner), invalid (field error in `hk-field__msg--error`, primary disabled with the reason).

## Accessibility

Labelled by the title, described by the body; Escape = Cancel; focus trapped and returned. Ink 11.6:1; strap buttons as in Button.

## Tokens

`overlay`, `leaf-glow`, `leaf`, `leaf-dark`, `text-1`, `text-2`, `leather-highlight`, `leather`, `leather-dark`, `stitch`, `border-brass`, `ember`, `ember-bottom`, `text-on-ember`, `brass-*`, `shadow-raised`, `shadow-leaf`, `radius-frame`, `duration-base`, the WaxSeal tokens.
