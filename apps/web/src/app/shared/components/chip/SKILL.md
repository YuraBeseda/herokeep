# hk-chip

Element selector `hk-chip` (contract allowed either `hk-chip` or `button[hk-chip]`;
this component picked the element form — see "Why an element selector" below).
Keyboard-activatable filter/tag control: `role="button"`, `tabindex="0"`, and Enter/Space
handling are built in.

## Usage

```html
<hk-chip [selected]="isActive(type)" [removable]="true" (click)="toggle(type)" (remove)="onRemove(type)">
  {{ t('library.type.' + type) }}
  <span hk-chip-remove class="visually-hidden">{{ t('actions.remove') }}</span>
</hk-chip>
```

- Main content (the chip's label) is default-projected.
- The remove affordance renders only when `removable` is `true`. Project its accessible
  content into the `[hk-chip-remove]` slot (an icon, or at minimum visually-hidden text)
  — the component itself has no text or icon of its own, by design.
- Bind `(click)` directly on `<hk-chip>` for the "select/activate" interaction. There is
  no dedicated output for it: native click bubbling (mouse) and a synthesized click
  (keyboard Enter/Space) both fire it, matching how `hk-button` works.

## Inputs / Outputs

| Name        | Kind   | Type      | Default | Notes                                                        |
| ----------- | ------ | --------- | ------- | ---------------------------------------------------------------- |
| `selected`  | input  | `boolean` | `false` | Reflected as `hk-chip--selected` host class and `aria-pressed`. |
| `removable` | input  | `boolean` | `false` | Shows/hides the remove affordance.                              |
| `remove`    | output | `void`    | —       | Emits when the remove affordance is activated; never fires the chip's own `(click)`. |

## Why an element selector

`button[hk-button]`-style attribute selectors put the component ON a native `<button>`.
A chip needs a nested remove control too, and HTML forbids nesting `<button>` inside
`<button>`. `hk-chip` is therefore a plain element with ARIA `role="button"` +
`tabindex` + manual Enter/Space handling, so a real `<button class="hk-chip__remove">`
can live inside it without invalid markup.

## Do / Don't

Do stop propagation on any custom content projected into `[hk-chip-remove]` if it adds
its own click handling — the built-in remove button already does this for you. Don't
forget to project accessible content into `[hk-chip-remove]`; an empty remove button has
no accessible name.
