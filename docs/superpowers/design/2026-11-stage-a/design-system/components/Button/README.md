# Button

A pill-shaped text button in six finishes: brass (primary), parchment (secondary on leather), leather (secondary on parchment or straps), ghost (tertiary), ember (destructive, text always kept) and moss (heal); icon + verb, sentence case, designed at the Ukrainian length.

## Anatomy

`hk-btn` (30px `control-desktop`, padding 0 12px, Alegreya 600 15px = `button`, radius `radius-seal`), a leading 14-18px glyph, the label. `hk-btn--l` 40px (action strap), `hk-btn--phone` 44px 16px (`control-phone`). A `::before` inset of -4px makes the desktop hit area 36px+.

## Variants

- `hk-btn--brass`: gradient `brass-top` / `brass` / `brass-mid` / `brass-bottom`, `text-on-brass`, bevel `shadow-brass`. The primary action of a screen or leaf; one per zone.
- `hk-btn--parchment`: `leaf-glow` fill, `accent-strong` hairline, `text-1`. A secondary action that sits on leather.
- `hk-btn--leather`: `leather-highlight` to `leather-dark`, `text-on-leather`, brass hairline; glyph `brass-top`. Secondary on parchment and on straps (Short rest, Long rest).
- `hk-btn--ghost` (+ `hk-btn--dashed`): transparent with an `accent-strong` hairline (dashed for "add"), `text-2`. Tertiary.
- `hk-btn--ghost-leather`: the ghost on leather (`text-on-leather-2`, `border-brass`).
- `hk-btn--ember`: `ember` body, `ember-bottom` base, `ember-top` 1px bevel, `text-on-ember`. Damage and destructive actions keep their text; never icon-only.
- `hk-btn--moss`: `moss-mid` body, `moss-bottom` base, `moss-top` bevel, `text-on-moss`. Heal.

## States

Hover (brightness), active, focus-visible (two-tone `shadow-focus`), loading (`hk-btn--loading` + `aria-busy`: spinner replaces the glyph, label at 55%, pointer events off), disabled (`disabled`, grey 60%): the reason is written next to it in `hk-hint` and linked with `aria-describedby`, and repeated in `title` for hover.

## Density

Heights are fixed per surface (30 desktop / 40 strap / 44 phone); density changes only the gaps around buttons.

## Accessibility

Real `<button type="button">` (or `<a>` for navigation). Label contrast: `text-on-brass` on `brass` 6.6:1, `text-on-ember` on `ember` 5.6:1, `text-on-moss` on `moss-mid` 5.7:1, `text-on-leather` on leather 9+:1. No ALL-CAPS; truncate with an ellipsis plus a tooltip, never clip.

## Tokens

`brass-top`, `brass`, `brass-mid`, `brass-bottom`, `text-on-brass`, `leaf-glow`, `accent-strong`, `text-1`, `text-2`, `leather-highlight`, `leather-dark`, `text-on-leather`, `text-on-leather-2`, `border-brass`, `ember`, `ember-top`, `ember-bottom`, `text-on-ember`, `moss-top`, `moss-mid`, `moss-bottom`, `text-on-moss`, `shadow-brass`, `shadow-focus`, `radius-seal`, `control-desktop`, `control-phone`, `duration-fast`.
