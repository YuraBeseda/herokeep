# hk-skeleton

Element selector `hk-skeleton`. Pure-CSS shimmer placeholder for loading content;
always `aria-hidden="true"` and disables its animation under `prefers-reduced-motion`.

## Usage

```html
@if (isLoading()) {
<hk-skeleton [lines]="3" width="80%" />
} @else { ... }
```

## Inputs

| Input   | Type                  | Default | Notes                                                     |
| ------- | --------------------- | ------- | --------------------------------------------------------- |
| `lines` | `number`              | `1`     | Number of shimmer bars rendered.                          |
| `width` | `string \| undefined` | —       | CSS width applied to every bar (e.g. `'60%'`, `'12rem'`). |

No outputs.

## Do / Don't

Do treat `hk-skeleton` as decorative only — it is always hidden from assistive tech, so
pair it with a loading announcement elsewhere if one is needed. Don't rely on it to
match the exact height/shape of the content it replaces; it renders generic bars, not a
content-shaped placeholder.
