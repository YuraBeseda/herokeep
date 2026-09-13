# hk-sheet-section

Element selector `hk-sheet-section`. A titled card section for the character sheet, with
an optional collapse toggle (`collapsible`) — meant primarily for narrow/phone layouts
where several sections need to fit above the fold, but the toggle works at any width.

## Usage

```html
<hk-sheet-section [titleKey]="'sheet.sections.equipment'">
  <app-equipment-list [items]="sheet().equipment" />
</hk-sheet-section>

<!-- Collapsible: bind from a breakpoint signal so it only collapses on phone -->
<hk-sheet-section [titleKey]="'sheet.sections.features'" [collapsible]="isPhone()">
  <app-feature-list [items]="sheet().features" />
</hk-sheet-section>
```

## Inputs

| Input         | Type      | Default | Notes                                                               |
| ------------- | --------- | ------- | ------------------------------------------------------------------- |
| `titleKey`    | `string`  | —       | Required. A full Transloco key.                                     |
| `collapsible` | `boolean` | `false` | When `true`, the header becomes a toggle button; body can collapse. |

No outputs — collapse state is internal (starts expanded) and has no external contract.

## Why the header IS the title

When `collapsible` is `true`, the entire header renders as a single `<button>` whose
visible text is the translated title itself — there's no separate "expand"/"collapse"
label, so this component never needs a second string beyond `titleKey`. `aria-expanded`
on that button (and a CSS-only rotating chevron keyed off it) conveys the state; the body
is hidden via the native `hidden` attribute (removed from the accessibility tree and
layout, not just visually) when collapsed.

## Do / Don't

Do bind `collapsible` from a viewport/breakpoint signal if you only want the collapse
behavior on phone — the component itself applies no media query, it just renders (or
doesn't render) the toggle based on the input. Don't expect `collapsible` to change
whether content is projected — the body is always projected; only its `hidden` state
changes.
