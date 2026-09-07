# hk-tabs

Element selector `hk-tabs`. An ARIA tablist with roving-tabindex keyboard navigation
(`@angular/cdk/a11y` `FocusKeyManager`). Renders `role="tablist"` and one `role="tab"`
button per entry; arrow keys, Home and End both move focus **and** selection
(single-activation tabs, per the WAI-ARIA APG tabs pattern) — there is no separate
"focused but not yet activated" state.

## Usage

```html
<hk-tabs [tabs]="tabs()" [(selected)]="activeTabId" />
```

```ts
readonly tabs = signal([
  { id: 'species', label: this.t('library.tabs.species') },
  { id: 'classes', label: this.t('library.tabs.classes') },
]);
readonly activeTabId = signal('species');
```

## Inputs / Model

| Input      | Type                              | Notes                                                                                              |
| ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tabs`     | `{ id: string; label: string }[]` | Required. Labels arrive **already translated** — this component never renders literal text.        |
| `selected` | `model<string \| undefined>()`    | Two-way. `undefined` until a tab is chosen; the first tab is the roving-tabindex stop while unset. |

No outputs — use the `selected` model's `(selectedChange)` if you need a one-way signal instead of `[(selected)]`.

## Keyboard

- `ArrowRight` / `ArrowLeft` — move to the next/previous tab (wraps at the ends).
- `Home` / `End` — jump to the first/last tab.
- Every move both focuses the tab button and updates `selected`.

## Do / Don't

Do pass already-translated `label`s — `hk-tabs` has no Transloco scope of its own and
renders labels verbatim. Don't rely on `selected` having an initial value: bind `selected`
to a signal that starts at your default tab id if you need one selected on first render.
