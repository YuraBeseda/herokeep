# hk-number-field

Element selector `hk-number-field`. A labeled `<input type="number">` implementing
`ControlValueAccessor`, so it works with `[formControl]` / `formControlName` /
`[(ngModel)]` exactly like a native form element — no adapter needed.

## Usage

```html
<hk-number-field
  [labelKey]="'characters.abilities.str'"
  [min]="8"
  [max]="20"
  [step]="1"
  [formControl]="strengthControl"
/>
```

```ts
readonly strengthControl = new FormControl<number | null>(10);
```

## Inputs

| Input      | Type                  | Default     | Notes                                                                            |
| ---------- | --------------------- | ----------- | -------------------------------------------------------------------------------- |
| `labelKey` | `string` (required)   | —           | A full Transloco key; wraps the `<input>` in a `<label>` (implicit association). |
| `min`      | `number \| undefined` | `undefined` | Forwarded to the native `min` attribute.                                         |
| `max`      | `number \| undefined` | `undefined` | Forwarded to the native `max` attribute.                                         |
| `step`     | `number \| undefined` | `undefined` | Forwarded to the native `step` attribute.                                        |

No outputs — bind a `FormControl`/`formControlName` (or `[(ngModel)]`) to read/write the
value; blur marks the control touched, matching native form-control behavior.

## ControlValueAccessor contract

- `writeValue(value)` — accepts `number | null`; renders `''` for `null` on the native
  input.
- `registerOnChange` / `registerOnTouched` — standard CVA wiring, called by
  `NgControl`/`FormControlDirective`.
- `setDisabledState(isDisabled)` — disables the native `<input>`.
- Typing parses the raw string via `Number(...)`; an empty input commits `null`, not
  `NaN` or `0`.

## Touch target and focus

The input carries `@include u.touch-target` (44px min height/width per the design-system
touch-target token) and no `:focus-visible` override of its own — the app-wide focus ring
rule (`src/styles/base.scss`) applies unchanged.

## Do / Don't

Do bind this through Reactive Forms (`[formControl]`/`formControlName`) — that's the
whole point of implementing CVA. Don't pass `value`/`(valueChange)` directly; there is no
such input/output, only the CVA contract.
