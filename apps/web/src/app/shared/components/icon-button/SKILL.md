# hk-icon-button

Native `<button>` with `hk-icon-button` attribute selector; square, touch-target-sized.
`label` is required and becomes the button's `aria-label` since the button carries no
visible text.

## Usage

```html
<button hk-icon-button icon="gi:crossed-swords" [label]="t('actions.attack')" variant="ghost" (click)="onAttack()"></button>
```

Until Task 7's `hk-icon` exists, nothing renders inside the button — `icon` is stored
and exposed as a `data-icon` attribute so the icon component can pick it up later
without a contract change.

## Inputs

| Input      | Type                                | Default     | Notes                                            |
| ---------- | ------------------------------------ | ----------- | -------------------------------------------------- |
| `icon`     | `string` (required)                  | —           | A `gi:<slug>` id; exposed as `[attr.data-icon]`. |
| `label`    | `string` (required)                  | —           | Bound to `aria-label`; MUST be a translated string, never a literal. |
| `variant`  | `'primary' \| 'ghost' \| 'danger'`  | `'primary'` | Reflected as a `hk-icon-button--<variant>` host class. |

No outputs — bind the native `(click)` event directly.

## Do / Don't

Do always pass a translated `label` — omitting it is a compile error (`input.required`)
by design, since this button has no visible text to fall back on. Don't reuse `icon`'s
value as the accessible name; `icon` is a rendering hint only, `label` is the a11y
contract.
