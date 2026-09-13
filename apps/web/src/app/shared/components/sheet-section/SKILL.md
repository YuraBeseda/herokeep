# hk-sheet-section

Element selector `hk-sheet-section`. A titled card section for the character sheet, with
an optional collapse toggle (`collapsible`). `collapsible` is a plain per-section flag —
sections marked `collapsible` are simply always-collapsible (at any viewport width); the
consumer decides which sections opt in. There is no built-in breakpoint/media-query
wiring, and none is required.

## Usage

```html
<hk-sheet-section [titleKey]="'sheet.sections.equipment'">
  <app-equipment-list [items]="sheet().equipment" />
</hk-sheet-section>

<!-- Always-collapsible section: the consumer opts this one in outright -->
<hk-sheet-section [titleKey]="'sheet.sections.features'" [collapsible]="true">
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
and `aria-controls` (pointing at the body region's generated id) on that button — plus a
CSS-only rotating chevron keyed off `aria-expanded` — convey the state; the body is
hidden via the native `hidden` attribute (removed from the accessibility tree and layout,
not just visually) when collapsed.

## Do / Don't

Do treat `collapsible` as a static per-section choice the consumer makes (e.g. "this
section is always collapsible, that one never is") — don't build a breakpoint/viewport
service just to drive it; nothing in this component expects one. Don't expect
`collapsible` to change whether content is projected — the body is always projected;
only its `hidden` state (and the header's button-vs-span rendering) changes.
