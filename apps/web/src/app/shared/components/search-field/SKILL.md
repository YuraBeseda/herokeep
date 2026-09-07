# hk-search-field

Element selector `hk-search-field`. A native `<input type="search">` wrapped with a
150ms-debounced `value` model and a text-free clear button, so callers get a
filter-style search box without wiring up `debounceTime` themselves.

## Usage

```html
<hk-search-field
  [(value)]="query"
  [placeholderKey]="'library.search.placeholder'"
  [clearLabelKey]="'library.search.clear'"
  (cleared)="onCleared()"
/>
```

Note the square-bracket bindings even for these string-literal keys: a plain
`placeholderKey="…"` attribute is flagged by `@angular-eslint/template/i18n`
(`checkAttributes: true` checks essentially every literal attribute, not just
`title`/`placeholder`/`aria-label`/`alt`) since it can't tell it apart from
untranslated user-facing text. Binding it — even to a literal — sidesteps that.

## Inputs / Model / Outputs

| I/O              | Type                       | Notes                                                                                                                                          |
| ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`          | `model<string>()`          | Two-way. Written **150ms after the user stops typing** — read it in a `computed`/`effect` to react to committed searches, not every keystroke. |
| `placeholderKey` | `input.required<string>()` | A **full, global** Transloco key, e.g. `'library.search.placeholder'` (not scope-relative).                                                    |
| `clearLabelKey`  | `input.required<string>()` | Same global-key shape; used as the clear button's `aria-label`.                                                                                |
| `cleared`        | `output<void>()`           | Fires when the clear button is pressed. `value` is reset to `''` in the same tick — not debounced.                                             |

## Why global (unscoped) keys

`hk-search-field` renders `*transloco="let t"` with **no `read:` scope of its own** and
calls `t(placeholderKey())` / `t(clearLabelKey())`. Transloco resolves a key with dots in
it against the currently-loaded translation file(s) regardless of scope, so as long as the
_consumer's_ view has loaded whatever scope owns `library.search.placeholder`, passing that
full key straight through resolves correctly — this component never needs to know or
declare a scope itself. This is also why the key inputs must be the full dotted path, not a
scope-relative suffix.

## Do / Don't

Do treat `value` as "committed search text", not "live keystrokes" — there is no output for
raw input. Don't pass a scope-relative key (e.g. `'search.placeholder'`) expecting this
component to resolve it against some implicit scope; it has none, so pass the full key.
