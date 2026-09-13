# hk-stat-tile

Element selector `hk-stat-tile`. A labeled number: a translated label, a value
(`number | string`, so it can show a raw number or an already-formatted string like
`'+2'`), and an optional `sub` line for extra context (already-translated text, e.g. "of
6 slots").

## Usage

```html
<hk-stat-tile [labelKey]="'sheet.stats.hp'" [value]="sheet().hp.current" />

<hk-stat-tile
  [labelKey]="'sheet.stats.ac'"
  [value]="sheet().ac"
  [emphasized]="true"
  hkDerived
  [hkDerivedBreakdown]="sheet().acBreakdown"
/>
```

## Inputs

| Input        | Type                  | Default     | Notes                                                                             |
| ------------ | --------------------- | ----------- | --------------------------------------------------------------------------------- |
| `labelKey`   | `string` (required)   | —           | A full Transloco key.                                                             |
| `value`      | `number \| string`    | —           | Required. Rendered verbatim — pass a pre-formatted string for signed/unit values. |
| `sub`        | `string \| undefined` | `undefined` | Already-translated. Rendered only when present.                                   |
| `emphasized` | `boolean`             | `false`     | Reflected as the `hk-stat-tile--emphasized` host class.                           |

No outputs, no content projection slot — the "content" hook for this component is the
host element itself: the character sheet attaches the `hkDerived` provenance attribute
directive (task T10) directly to `<hk-stat-tile>` (see the AC example above) to add a
"why" popover. `hk-stat-tile` has no knowledge of that directive and needs no changes for
it to work — any attribute directive can attach to its host tag like any other element.

## Do / Don't

Do pass a formatted string (`'+2'`, `'—'`) to `value` for anything that isn't a plain
count — the component never adds a sign or unit itself. Don't rely on this component for
interactivity; it has no `role`/`tabindex` — wrap it or add directives (like `hkDerived`)
for that.
