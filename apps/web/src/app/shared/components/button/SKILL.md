# hk-button

Native `<button>` with `hk-button` attribute selector — consumers get real button
semantics (focus, keyboard activation, form behavior) for free.

## Usage

```html
<button hk-button variant="ghost" [disabled]="isBusy()" (click)="onSave()">
  {{ t('actions.save') }}
</button>
```

## Inputs

| Input      | Type                                | Default     | Notes                                   |
| ---------- | ------------------------------------ | ----------- | ---------------------------------------- |
| `variant`  | `'primary' \| 'ghost' \| 'danger'`  | `'primary'` | Reflected as a `hk-button--<variant>` host class. |
| `disabled` | `boolean`                            | `false`     | Sets `[disabled]` (blocks native click) and `aria-disabled`. |

No outputs — bind the native `(click)` event directly.

## Do / Don't

Do project the visible label as content (`<button hk-button>{{ t('...') }}</button>`) —
the component carries no text of its own. Don't wrap `hk-button` in another element to
listen for clicks; bind `(click)` straight on the `<button hk-button>` tag.
